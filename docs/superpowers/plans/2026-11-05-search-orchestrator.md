# Search Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Splunk app that runs chained, dependent searches as one tracked unit, with triggers, actions, audit and a Splunk UI Toolkit interface.

**Architecture:** A persistent Python modular input is the only component that advances state, and its decisions come from a pure state module that can be tested without Splunk. A persistent REST handler is the only write path for users and enforces permissions. React pages built on `@splunk/react-ui` talk only to that handler. All state lives in KV Store, and audit events go to an index.

**Tech Stack:** Python 3.9-compatible (stdlib plus vendored `splunk-sdk` 2.1.1 in `lib/`), pytest; React 18, TypeScript, `@splunk/react-ui` ^5.17, `@splunk/themes` ^1.13, `@splunk/react-page` ^8.3 (`/18` entry), `@splunk/splunk-utils` ^4.1, `@splunk/react-icons`, `styled-components` ^5.3, `@dagrejs/dagre` ^3.1, webpack via `@splunk/webpack-configs` ^7; Jest and React Testing Library; `splunk-appinspect` 4.x.

**Spec:** `docs/superpowers/specs/2026-11-05-search-orchestrator-design.md`. Every task implements the spec sections it names, so read them. The spec's §5 rules and edge table are normative.

## Global Constraints

- App ID `search_orchestrator`, label "Search Orchestrator", packaged as `dist/search_orchestrator-<version>.tgz`.
- Targets Splunk Enterprise 9.4+ and Splunk Cloud Victoria Experience. Classic is unsupported, and the docs say so.
- Python: `python.version = python3`. No compiled dependencies, `eval`, `exec` or subprocess. TLS verification always on for outbound calls.
- `splunk-appinspect inspect <tgz> --mode precert --included-tags cloud` must report 0 failures on every packaged build. Warnings get listed for the owner.
- UI imports components individually (`@splunk/react-ui/Button`). All colour and type come from theme tokens. Status is plain text with an icon, with **no filled pills or badges**. Screens load only local assets.
- Times in KV Store are integer epoch seconds. User-facing copy uses "run" and "step".
- Defaults: tick 5s; `delayed_after` 1h; `give_up_after` 24h; `max_runtime` 4h; `retries` 0; dispatch-error retries 3; action retries 3; global searches 10; per-job searches 4; queue cap 20; result retention after a run 24h; run-record retention 90 days; lease 30s; catch-up `all` capped at 7; `after_give_up` `hold`.
- Local Python tests use `/usr/bin/python3` (3.9) in `.venv`, matching the oldest supported interpreter.
- Do not commit credentials. The builder's server access is read-only searches through MCP. The owner installs each build.

## Review Focus

The inputs and failures most likely to bite a real user, each pinned by a test in its owning task:

1. **Literal `$` in SPL**, as in `rex "foo$"` or `$unknown$`: must pass through untouched. Only `run.*` and known-step tokens compile (Tasks 2, 3).
2. **Crash between dispatch and saving the search ID**: on restart the engine adopts the running search rather than launching a duplicate that double-writes a summary (Task 6).
3. **Daylight-saving changes**: a cron slot in a skipped hour fires once at the next valid time, and a repeated hour fires once (Task 3).
4. **Zero-row results**: a `resultCount` of 0 is a success, and `$s.first.host$` on zero rows fails only the step that uses it, with a clear error (Tasks 3, 5).
5. **Things removed under a run**: a job deleted with active runs is refused, while a hidden search deleted or a search reaped or finalized externally counts as a clear failed attempt (Tasks 6, 8).

---

## Phase 1: Prove the risk

### Task 1: Repository, app shell and AppInspect gate

**Files:**
- Create: `app/search_orchestrator/{app.manifest,README.md}`, `app/search_orchestrator/default/{app.conf,authorize.conf,collections.conf,indexes.conf,macros.conf,props.conf,inputs.conf}`, `app/search_orchestrator/README/inputs.conf.spec`, `app/search_orchestrator/metadata/default.meta`, `app/search_orchestrator/lib/splunklib/` (vendored), `scripts/package.sh`, `scripts/appinspect.sh`, `requirements-dev.txt`, `pytest.ini`
- Test: `tests/test_package.py`

**Interfaces:**
- Produces: `scripts/package.sh [version]` writes the `.tgz` and prints its path, merging `ui/stage/` when it exists. `scripts/appinspect.sh <tgz>` exits non-zero on any failure.
- Produces confs:
  - Collections `so_jobs`, `so_runs`, `so_step_runs`, `so_action_runs`, `so_commands`, `so_locks`, `so_settings`, with `default.meta` granting `read : [ admin ], write : [ admin ]` on each.
  - Capabilities `orchestrator_admin`, `orchestrator_build`, `orchestrator_run`, with roles `orchestrator_admin_role`, `orchestrator_builder_role`, `orchestrator_user_role`. `admin` and `sc_admin` inherit `orchestrator_admin`.
  - Index `orchestrator`, macro `orchestrator_index` = `index=orchestrator`, sourcetype `orchestrator:audit` (`KV_MODE = json`).

- [ ] **Step 1:** Run `git init`, create `.venv` with `/usr/bin/python3`, and install `pytest`, `splunk-appinspect` and `splunk-sdk==2.1.1`. Copy `splunklib` into `lib/`.
- [ ] **Step 2: Write failing tests** `test_package_contains_required_files`, `test_no_pyc_or_dotfiles_in_package`, `test_all_collections_declared`, `test_every_collection_restricted_in_meta`.
- [ ] **Step 3:** Run `.venv/bin/pytest tests/test_package.py -v`. Expected: FAIL.
- [ ] **Step 4:** Write the confs and the scripts. `package.sh` excludes `__pycache__`, sets directory and file modes as AppInspect expects, and uses a deterministic top folder `search_orchestrator/`.
- [ ] **Step 5:** Run the tests, then `scripts/package.sh 0.0.1 && scripts/appinspect.sh dist/search_orchestrator-0.0.1.tgz`. Expected: PASS, 0 failures. If AppInspect's checks conflict with a Global Constraint, stop and report.
- [ ] **Step 6:** Commit: `feat: app shell with packaging and AppInspect gate`.

### Task 2: Identity spike (GATE)

Implements spec §9's Milestone 1. **Execution stops at this task until the results are reviewed with the owner.** The spike code is removed in Task 6.

**Files:**
- Create: `app/search_orchestrator/bin/orchestrator_engine.py` (spike mode), `scripts/m1_setup.sh`, `docs/m1-procedure.md`, `app/search_orchestrator/default/transforms.conf` (temporary lookup `so_spike_results` on the `so_spike` collection)

**Interfaces:**
- `m1_setup.sh --host <url>`, prompting for an admin password and never storing it, creates:
  - role `so_m1_role`, with no access to index `so_m1_secret`, and a user `so_m1_user`;
  - index `so_m1_secret`, seeded with one event;
  - private saved searches owned by `so_m1_user`, created with that user's session.
- Saved searches created by the script:
  - `_so_spike_identity`: `| rest /services/authentication/current-context splunk_server=local | fields username roles`
  - `_so_spike_secret`: `search index=so_m1_secret | stats count`
  - `_so_spike_args`: `| makeresults | eval v="$args.v$", literal="foo$", other="$unknown$"`
  - `_so_spike_now`: `| makeresults | addinfo | table info_min_time`, with `dispatch.earliest_time = -1d@d`
  - `_so_spike_loadjob`: `| loadjob $args.sid$ | stats count`
  - a second user's shared `dispatchAs=owner` saved search, used for the wrapper-mode check.
- The spike engine, with the modular input's system session, dispatches each search with `/servicesNS/so_m1_user/search_orchestrator/saved/searches/<name>/dispatch`, passing `dispatch.now`, `args.*`, `force_dispatch=1` and `trigger_actions=0`. It then polls, reads results, attempts `touch` and `setttl`, cancels a long-running search, and tries `workload_pool` at dispatch. Every outcome becomes a row in `so_spike`.

- [ ] **Step 1:** Implement the script and spike engine, and document the procedure in `docs/m1-procedure.md`.
- [ ] **Step 2:** Package, run AppInspect, and ask the owner to install, run the script and restart.
- [ ] **Step 3: Verify over MCP** with `| inputlookup so_spike_results`, against these pass criteria:

| Check | Pass means |
|---|---|
| Identity | `username=so_m1_user`, not `splunk-system-user`, and roles match `so_m1_role` |
| Index access | `_so_spike_secret` count is 0 |
| Args | `v` substituted; `literal="foo$"` and `other="$unknown$"` unchanged, or a documented alternative chosen |
| Scheduled time | `info_min_time` is computed from the supplied `dispatch.now` |
| Job control | System session can read status and results, `touch`, `setttl` and `cancel` |
| `loadjob` | A search as `so_m1_user` reads the earlier search ID |
| Wrapper mode | A hidden `\| savedsearch` wrapper reaches the shared search as `so_m1_user` |
| Workload pool | Recorded either way; a failure drops `workload_pool` from the first version |

- [ ] **Step 4:** Report the results to the owner. **On any identity or index-access failure, stop**, since spec §9's fallback is their decision. Otherwise record the findings in `docs/m1-procedure.md`, adjust Task 3's token compile if args behaviour differs, and continue.
- [ ] **Step 5:** Commit: `spike: prove owner identity and dispatch behaviour`.

---

## Phase 2: Pure core

Everything in `app/search_orchestrator/bin/so/`, with no Splunk imports.

### Task 3: Job model, cron, expressions and tokens

**Files:**
- Create: `bin/so/model.py`, `bin/so/cron.py`, `bin/so/expr.py`, `bin/so/tokens.py`
- Test: `tests/test_model.py`, `tests/test_cron.py`, `tests/test_expr.py`, `tests/test_tokens.py`

**Interfaces (produces):**
- Job JSON:
```json
{"id":"rollups","name":"Summary rollups","description":"","owner":"alice","enabled":true,"version":3,
 "timezone":"Europe/Oslo","catchup":"all","after_give_up":"hold","run_roles":["ops"],
 "triggers":[{"type":"cron","cron":"0 1 * * *"},{"type":"completion","job":"x","on":"success"}],
 "params":[{"name":"region","type":"enum","values":["eu","us"],"default":"eu","regex":null}],
 "defaults":{"delayed_after":3600,"give_up_after":86400,"max_runtime":14400,"retries":0},
 "steps":[{"id":"daily","name":"Daily summary","type":"inline","spl":"...","saved_search_ref":null,
   "earliest":"-1d@d","latest":"@d","run_when":{"kind":"cron","value":"0 1 * * 1"},
   "delayed_after":null,"give_up_after":null,"max_runtime":null,"retries":null,"workload_pool":null,
   "actions":[],"x":0,"y":0}],
 "edges":[{"from":"daily","to":"weekly","condition":"on_success","expression":null}],
 "actions":[{"hook":"on_failure","type":"webhook","destination":"ops-slack","preset":"slack","body":null}]}
```
- `model.validate_job(job: dict, known_saved_searches: set|None=None) -> list[Issue]`, where `Issue = {"level":"error"|"warning","code":str,"message":str,"step":str|None}`. Errors: `cycle`, `duplicate_step`, `unknown_edge_step`, `bad_step_id` (must match `^[a-z][a-z0-9_]{0,39}$`), `reserved_step_id` (`run`), `unknown_token`, `bad_cron`, `bad_expression`, `bad_param`. Warnings: `token_from_skippable_step`, `retries_duplicate_risk`, `no_failure_notification`.
- `model.topo_order(job) -> list[str]`; `model.resolve_step(job, step) -> dict` applies defaults.
- `cron.parse(expr: str) -> CronSpec` (5 fields, names, ranges, steps, lists; raises `CronError`); `cron.matches(spec, epoch, tz) -> bool`; `cron.slots_between(spec, start, end, tz) -> list[int]`. Evaluates in `zoneinfo`, falling back to the server's local time with a warning if `tzdata` is missing.
- `expr.parse(text) -> Node` (raises `ExprError`); `expr.evaluate(node, lookup: Callable[[str], object|None]) -> bool`. Grammar: `or`, `and`, `not`, `== != > >= < <=`, parentheses, numbers, quoted strings, `$token$`. A missing token makes its comparison false.
- `tokens.find_tokens(spl, step_ids) -> set[str]`; `tokens.compile_spl(spl, step_ids) -> (compiled_spl, list[arg_name])`, turning `$daily.sid$` into `$args.daily__sid$` and `$a.sid|x$` into `$args.a__sid$`; `tokens.token_defaults(spl, step_ids) -> dict[arg_name, str]`; `tokens.render_args(names, ctx, defaults=None) -> dict`, raising `TokenError(token, reason)`; `tokens.escape_spl_string(value) -> str`; `tokens.validate_param(decl, value) -> str`, raising `TokenError`.

- [ ] **Step 1: Write failing tests**, including:

```python
def test_cycle_rejected(): assert codes(validate_job(job(edges=[("a","b"),("b","a")]))) >= {"cycle"}
def test_literal_dollar_untouched():
    assert compile_spl('| rex "foo$" | eval x="$unknown$"', {"daily"})[0] == '| rex "foo$" | eval x="$unknown$"'
def test_known_token_compiled():
    assert compile_spl('| loadjob $daily.sid$', {"daily"}) == ('| loadjob $args.daily__sid$', ["daily__sid"])
def test_token_default_used_when_missing():
    spl, names = compile_spl('$weekly.sid|none$', {"weekly"})
    assert render_args(names, ctx={}, defaults={"weekly__sid": "none"})["weekly__sid"] == "none"
def test_first_field_zero_rows_raises():
    with pytest.raises(TokenError, match="no result rows"): render_args(["s__first__host"], ctx=ctx_zero_rows("s"))
def test_string_param_escaped(): assert escape_spl_string('a"b\\c') == 'a\\"b\\\\c'
def test_enum_param_rejects_unknown():
    with pytest.raises(TokenError): validate_param({"name":"r","type":"enum","values":["eu"]}, "us")
def test_cron_monday(): assert matches(parse("0 1 * * 1"), ts("2026-11-02 01:00", OSLO), OSLO)
def test_cron_dst_gap_fires_once_at_next_valid():
    # Europe/Oslo 2027-03-28 02:30 does not exist
    assert len(slots_between(parse("30 2 * * *"), ts_utc("2027-03-28 00:00"), ts_utc("2027-03-28 06:00"), OSLO)) == 1
def test_cron_dst_repeat_fires_once():
    assert len(slots_between(parse("30 2 * * *"), ts_utc("2027-10-30 22:00"), ts_utc("2027-10-31 06:00"), OSLO)) == 1
def test_expr_result_count(): assert evaluate(parse("$s1.resultCount$ > 0"), {"s1.resultCount": 3}.get)
def test_expr_missing_token_false(): assert not evaluate(parse("$s1.x$ == 'a'"), {}.get)
def test_expr_rejects_code(): 
    with pytest.raises(ExprError): parse("__import__('os')")
```
- [ ] **Step 2:** Run `.venv/bin/pytest tests/test_model.py tests/test_cron.py tests/test_expr.py tests/test_tokens.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement the four modules. `expr` is a hand-written recursive descent parser.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: job model, cron, expressions and tokens`.

### Task 4: State evaluator

Implements spec §5 exactly, including the edge table and both skip kinds.

**Files:**
- Create: `bin/so/state.py`
- Test: `tests/test_state.py`

**Interfaces:**
- Consumes: `cron`, `expr`, `model.resolve_step`.
- Produces: `state.evaluate(run: dict, now: int) -> list[Effect]`, pure with no I/O. It reads `run["definition"]`, `run["steps"][id]` (`state`, `skip_kind`, `attempt`, `sid`, `started_at`, `ended_at`, `next_attempt_at`, `delay_alerted`, `result_count`, `first`, `error`) and `run["state"]`, `run["scheduled_time"]`, `run["delay_base"]`, `run["giveup_base"]`, `run["paused_seconds"]`, `run["paused_at"]`.
- Effects are tuples:
  - `("set_step", step_id, fields)`, `("start_step", step_id)`, `("cancel_search", step_id, sid)`
  - `("set_run", fields)`, `("hook", scope, hook, step_id|None)`, where scope is `"step"` or `"job"`, and `("notify_fallback_check", hook, step_id|None)`
- Run base clocks are set at promotion by Task 6. Fields: `delay_base` (the scheduled time for on-time scheduled runs, otherwise promotion time) and `giveup_base` (promotion or re-run time).
- `state.reset_for_rerun(run, step_id, now, definition=None) -> run`; `state.downstream(definition, step_id) -> set[str]`.

- [ ] **Step 1: Write failing tests** covering each spec rule as a named case:
  - `test_serial_waits_for_dependency`
  - `test_run_when_evaluated_only_after_dependencies`
  - `test_run_when_skip_releases_downstream` (the 1st isn't a Monday: weekly skipped, monthly runs)
  - `test_unused_failure_branch_is_not_taken_and_stays_not_taken`
  - `test_always_edge_leaves_not_taken_step`
  - the edge table as a `pytest.mark.parametrize` over all 16 cells
  - `test_expression_with_missing_failed_token_is_false`
  - `test_unhandled_leaf_failure_blocks_run`
  - `test_handled_failure_ends_failed_not_blocked`
  - `test_blocked_only_after_nothing_else_can_progress` (a parallel branch finishes first)
  - `test_delay_fires_once_and_keeps_waiting`
  - `test_delay_not_fired_while_paused`
  - `test_give_up_cancels_all_running_and_abandons_rest`
  - `test_pause_stops_starts_not_running_searches`
  - `test_pause_stops_give_up_clock`
  - `test_max_runtime_counts_as_failed_attempt`
  - `test_retry_backoff_schedule`
  - `test_dispatch_error_retries_without_consuming_retries`
  - `test_rerun_resets_step_and_downstream_keeps_upstream`
  - `test_rerun_delay_alert_can_fire_once_more`
  - `test_job_hooks_fire_once_on_terminal_state`
- [ ] **Step 2:** Run `.venv/bin/pytest tests/test_state.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement `evaluate` as a fixed-point loop over `topo_order`. Backoff is `min(30 * 2**(attempt-1), 900)` seconds **(builder call)**.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: run state evaluator`.

---

## Phase 3: Engine and server side

### Task 5: Splunk gateway, KV store, lease, fake

**Files:**
- Create: `bin/so/gateway.py` (Protocol and real implementation over `splunklib`), `bin/so/store.py`, `bin/so/lease.py`, `tests/fakes.py`
- Test: `tests/test_store.py`, `tests/test_lease.py`, `tests/test_gateway_parsing.py`

**Interfaces (produces):**
- `Gateway` methods:
  - `dispatch(owner, name, now_epoch, args, earliest=None, latest=None, workload_pool=None, trigger_actions=False) -> sid`, raising `DispatchError(transient: bool, message)`
  - `job_status(sid) -> {"state": "running"|"done"|"failed"|"missing", "result_count": int, "error": str|None, "finalized": bool, "zombie": bool}`
  - `first_row(sid) -> dict|None`; `control(sid, action, **kw) -> None`
  - `history(owner, name, since_epoch) -> list[sid]`
  - `kv_*`, `upsert_saved_search`, `delete_saved_search`, `read_secret`, `write_secret`, `post_webhook(url, headers, body)`
- `Store` over `so_*` collections: `get_job`, `save_job`, `delete_job`, `list_jobs`, `create_run(run) -> bool` (False on a duplicate `_key`), `save_run`, `get_run`, `list_runs(filters)`, `list_active_runs()`, `enqueue_command`, `take_commands`, `get_settings`, `save_settings`, `prune_runs(before)`. `so_step_runs` keeps one row per attempt. The current step state is embedded in the run document.
- `FakeGateway` in `tests/fakes.py` implements all of it in memory, with `script_job(name, [states...], result_count, first)`, `crash_after_dispatch` and `kv_down` switches, and a dispatch log.
- `Lease.acquire(holder, now) -> bool`: insert with `_key="engine"`, renew if held, and take over only after expiry using delete then insert, where a duplicate-key error means it lost.

- [ ] **Step 1: Write failing tests:** `test_duplicate_run_key_returns_false`, `test_lease_single_holder`, `test_lease_takeover_after_30s`, `test_lease_race_only_one_wins`, `test_status_parses_done_zero_results_as_success`, `test_status_parses_failed_with_message`, `test_status_404_is_missing`, `test_status_zombie_is_failed`, `test_first_row_none_on_zero_rows`, `test_dispatch_503_transient_400_not`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. The real `Gateway` is thin, and parsing helpers are separate pure functions so they can be tested with captured JSON fixtures.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: Splunk gateway, store and lease`.

### Task 6: Engine tick, scheduling and queue

**Files:**
- Create: `bin/so/engine.py`, `bin/so/scheduler.py`, `bin/so/audit.py`
- Modify: `bin/orchestrator_engine.py` (replace the spike with the real modular input)
- Delete: `default/transforms.conf` (spike lookup). `scripts/m1_setup.sh` stays for reference.
- Test: `tests/test_engine.py`, `tests/test_scheduler.py`

**Interfaces:**
- Consumes: `state.evaluate`, `Gateway`, `Store`, `Lease`, `FakeGateway`, `actions.ActionRunner` (a stub until Task 7: `submit(run, hook, scope, step_id)`, `pump(now)`).
- Produces:
  - `Engine(gateway, store, audit, actions, clock, holder).tick() -> None`, doing spec §8's steps in order and never raising on a KV outage (logs, skips the tick, retains state).
  - `scheduler.due_runs(job, last_checked, now) -> list[int]`, honouring `catchup` and the cap of 7.
  - `create_run(store, job, trigger, scheduled_time, params, upstream=None) -> run_id|None`, with run key `job:scheduled_time` for cron and `job:upstream_run_id:trigger` for chained runs.
  - `audit.emit(event: dict)`, writing a modular-input XML event with sourcetype `orchestrator:audit` to the configured index.
- Step-start ordering, an algorithm no signature determines:
  1. Save `step.state="starting"`, `intent_at=now`.
  2. Render args.
  3. Dispatch.
  4. Save the search ID.
  5. On startup or any tick, a `starting` step without a search ID calls `gateway.history(owner, name, intent_at)`: adopt the newest match, otherwise dispatch.
- Queue rules: one active run per job, oldest `scheduled_time` first. `after_give_up=hold`: a `failed` run from give-up with `held=true` blocks promotion until a re-run or dismiss. Re-runs go first. Results of steps in non-terminal runs are touched each 5 minutes; on run end `setttl` to the retention setting.

- [ ] **Step 1: Write failing tests**, end to end through `tick()` with `FakeGateway`:
  - `test_rollup_serial_happy_path`
  - `test_parallel_branches_then_merge_respects_limits`
  - `test_late_daily_weekly_waits_delay_hook_once_then_starts`
  - `test_failed_daily_blocks_then_rerun_recovers`
  - `test_runs_queue_in_order_never_overlap`
  - `test_scheduled_time_passed_as_dispatch_now_on_late_start`
  - `test_catchup_all_capped_at_7_oldest_first`
  - `test_catchup_latest_and_none`
  - `test_restart_mid_run_resumes_by_sid`
  - `test_crash_after_dispatch_adopts_not_duplicates`
  - `test_kv_outage_tick_is_harmless_and_recovers`
  - `test_missing_search_counts_as_failed_attempt`
  - `test_finalized_search_is_failed_with_clear_error`
  - `test_deleted_hidden_search_fails_with_clear_error`
  - `test_zero_results_step_succeeds`
  - `test_hold_blocks_later_runs_until_dismiss`
  - `test_continue_lets_later_runs_proceed`
  - `test_hold_repeats_alert_daily`
  - `test_queue_cap_rejects_audits_and_notifies`
  - `test_only_lease_holder_acts`
  - `test_edit_does_not_change_active_run`
  - `test_every_state_change_is_audited`
  - `test_orphaned_owner_fails_with_clear_error`
  - `test_old_runs_pruned_after_retention`
- [ ] **Step 2:** Run `.venv/bin/pytest tests/test_engine.py tests/test_scheduler.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement the engine and scheduler, then the modular input (`supports_multiple_instances=false`, one default stanza `orchestrator_engine://main` in `inputs.conf` with `interval = 0`, `python.version = python3`). Read the session key from the input definition and refresh on auth failure.
- [ ] **Step 4:** Run the tests and AppInspect. Expected: PASS, 0 failures.
- [ ] **Step 5:** Commit: `feat: orchestration engine with scheduling and queue`.

### Task 7: Actions and fallback notification

**Files:**
- Create: `bin/so/actions.py`, `bin/so/presets.py`, `bin/so/hidden.py` (naming only; Task 8 adds the rest)
- Test: `tests/test_actions.py`

**Interfaces:**
- Consumes: `Gateway.post_webhook`, `Gateway.dispatch`.
- Produces: `hidden.action_search_name(job_id, action_index) -> str`, returning `_so_<job>_action_<index>`.
- Produces: `ActionRunner(gateway, store, audit, clock)` with `submit(run, hook, scope, step_id)` and `pump(now)`. Action types: `webhook`, `email`, `event`, `start_job`, `alert_action`. Each row in `so_action_runs` tracks `attempts`, `state`, `error`. Retry 3 times with the Task 4 backoff, and never touch run state. `presets.render(preset, ctx) -> dict` provides `slack` and `generic` JSON bodies, and default messages include links to the run page and failed searches.
- Fallback: when `notify_fallback_check` fires and there's no matching action, or a matching action exhausts retries, send to `settings.fallback`. Email fallback uses a system-owned `_so_fallback_email` hidden search. Message content is limited to job, run and step names, status and links.

- [ ] **Step 1: Write failing tests:** `test_webhook_retries_3_then_failed_without_changing_run`, `test_webhook_https_only_rejected_at_runtime`, `test_slack_preset_body`, `test_email_runs_as_owner`, `test_alert_action_search_uses_sendalert_as_owner`, `test_event_action_uses_collect_as_owner`, `test_start_job_requires_owner_permission`, `test_start_job_inherits_scheduled_time`, `test_fallback_when_no_action`, `test_fallback_when_action_exhausted`, `test_fallback_content_has_no_results_data`, `test_action_failure_audited`, `test_action_secret_not_in_audit`.
- [ ] **Step 2:** Run `.venv/bin/pytest tests/test_actions.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement, and wire into the engine, replacing the stub.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: action runner with fallback notifications`.

### Task 8: REST API, permissions and hidden searches

**Files:**
- Create: `bin/orchestrator_rest.py`, `bin/so/api.py`, `bin/so/authz.py`, `bin/so/hidden.py`
- Modify: `default/restmap.conf`, `default/web.conf`, `default/app.conf`
- Test: `tests/test_api.py`, `tests/test_authz.py`, `tests/test_hidden.py`

**Interfaces:**
- `restmap.conf`: `[script:orchestrator_api]`, `match=/orchestrator`, `scripttype=persist`, `handler=orchestrator_rest.Handler`, `passSession=true`, `passSystemAuth=true`, `requireAuthentication=true`, `python.version=python3`. `web.conf` exposes `orchestrator/*`. **If AppInspect flags `passSystemAuth`, stop and report.**
- Routes, returning JSON with `{"error":{"code","message","issues"}}` on failure:

| Method and path | Purpose |
|---|---|
| `GET,POST /orchestrator/jobs`, `GET,PUT,DELETE /orchestrator/jobs/{id}` | CRUD. PUT and POST return issues and refuse on any `error` issue |
| `POST /orchestrator/jobs/validate` | Validate without saving |
| `POST /orchestrator/jobs/{id}/runs` | Body `{params, scheduled_time?}` |
| `GET /orchestrator/runs`, `GET /orchestrator/runs/{id}` | List and detail |
| `POST /orchestrator/runs/{id}/{pause,resume,cancel,dismiss}` | Controls, as commands for the engine |
| `POST /orchestrator/runs/{id}/rerun` | Body `{step, definition:"latest"|"original", restart_downstream_jobs:bool}`. `definition` is **required** with 409 `definition_choice_required` if the job changed, and rejected as unavailable if the latest removed a needed step |
| `GET,PUT /orchestrator/settings`, `GET,POST,DELETE /orchestrator/destinations[/{name}]` | Admin |
| `GET /orchestrator/health` | Index present, engine heartbeat, fallback set |
| `GET /orchestrator/me` | Capabilities, for screens |

- `authz.can_view(user, job)`, `can_edit`, `can_run`, `can_admin`, implementing spec §9's "who may see/run". A listed role also requires `orchestrator_run`.
- `hidden.sync(gateway_as_user, job, previous) -> job`, using the **user's** session: hidden search names `_so_<job>_<step>_<8-hex-hash-of-compiled-spl-and-times>`, `is_scheduled=0`, `dispatchAs=owner`, private. It also creates the hidden searches for `email`, `event` and `alert_action` actions, using `action_search_name`. `saved_search` steps use the §9 two-mode rule, checked with the user's session. `hidden.gc(job, active_runs)`.
- An admin saving another's job becomes owner, with an audit event. Deleting a job with an active or queued run returns 409 `job_has_active_runs`. Disabling stops triggers while allowing queued runs to finish.
- Secrets: destination URL and headers via `storage/passwords` under realm `search_orchestrator`, never returned by GET.

- [ ] **Step 1: Write failing tests:** `test_run_only_user_cannot_edit`, `test_build_user_cannot_see_others`, `test_listed_role_needs_capability`, `test_admin_edit_takes_ownership_and_audits`, `test_delete_with_active_run_409`, `test_rerun_requires_definition_choice_when_changed`, `test_rerun_latest_unavailable_if_step_removed`, `test_rerun_original_uses_snapshot`, `test_rerun_latest_updates_owner`, `test_param_validated_on_start`, `test_saved_step_owned_direct_else_wrapped`, `test_hidden_name_changes_with_spl`, `test_gc_keeps_versions_for_active_runs`, `test_destination_secret_not_returned`, `test_non_https_destination_rejected`, `test_only_admin_manages_destinations`, `test_job_validation_errors_block_save`.
- [ ] **Step 2:** Run `.venv/bin/pytest tests/test_api.py tests/test_authz.py tests/test_hidden.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement `api.py` as pure route functions taking `(user, method, path, body, deps)`, with `orchestrator_rest.py` a thin adapter.
- [ ] **Step 4:** Run the tests and AppInspect. Expected: PASS, 0 failures.
- [ ] **Step 5:** Commit: `feat: REST API, permissions and hidden searches`.

### Task 9: Search command, alert action, chaining, selftest, and server check

**Files:**
- Create: `bin/orchestrate.py`, `bin/start_orchestrator_job.py`, `bin/so/selftest.py`
- Modify: `default/commands.conf`, `default/searchbnf.conf`, `default/alert_actions.conf`, `README/alert_actions.conf.spec`, `default/data/ui/alerts/start_orchestrator_job.html`, `bin/so/engine.py` (completion triggers)
- Test: `tests/test_orchestrate.py`, `tests/test_chaining.py`, `tests/test_selftest.py`

**Interfaces:**
- `| orchestrate start job=X param.foo=bar [scheduled_time=<epoch>]`, `| orchestrate status [run=ID] [job=X]`, `| orchestrate cancel run=ID`, `| orchestrate rerun run=ID step=S [definition=latest|original]`, `| orchestrate selftest [scenario=basic|rollup_late|rollup_fail]`. Generating command (`splunklib.searchcommands`, `chunked = true`), which goes through `api.py` with the caller's session and capabilities. `status` returns a row per step: `run_id, job, step, state, skip_kind, delayed, attempts, sid, result_count, error, scheduled_time, started_at, ended_at`.
- Alert action calls the same API using the alert's session key, with a job dropdown and params.
- Completion: engine fires once per upstream run on the first matching outcome, inheriting `scheduled_time`. `restart_downstream_jobs` overrides.
- `selftest.definition()` returns a `makeresults` job: `a` → (`b`, `c` parallel, using `loadjob $a.sid$`) → `d`, plus `skip_me` with a never-matching `run_when`, and `flaky` that fails the first attempt with `retries=1`. `selftest.rollup_definition(fail_first: bool)` returns daily → weekly → monthly, with a slow daily (`| makeresults count=<n> | stats count`, with `n` calibrated on the server to take over 30 seconds) and `delayed_after` of 10 seconds. Webhook-free: `on_delayed` uses an `event` action writing to the audit index. `| orchestrate selftest` is admin-only, and returns the run ID.

- [ ] **Step 1: Write failing tests:** `test_start_parses_params`, `test_command_denied_without_capability`, `test_status_row_shape`, `test_alert_action_uses_alert_session`, `test_completion_fires_once_per_upstream_run`, `test_failed_upstream_success_on_rerun_starts_downstream`, `test_rerun_of_succeeded_upstream_no_refire_unless_ticked`, `test_chained_run_inherits_scheduled_time`, `test_chain_key_no_duplicate_after_restart`, `test_selftest_definition_is_valid`, `test_selftest_completes_on_fake`, `test_selftest_admin_only`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep logic in `api.py`.
- [ ] **Step 4:** Run the tests and AppInspect. Expected: PASS, 0 failures.
- [ ] **Step 5: Server check.** Package `0.1.0`, and ask the owner to install it. Over MCP, run `| orchestrate selftest`, then poll `| orchestrate status run=<id>`. Expected: run `succeeded`, `skip_me` skipped, `flaky` 2 attempts, and audit events found by `` `orchestrator_index` run_id=<id> ``. Then run `scenario=rollup_late` and verify wait, delay action, late start of the weekly, and that each step's `info_min_time` comes from the scheduled time. Run `scenario=rollup_fail` and verify blocked, then `| orchestrate rerun run=<id> step=daily definition=original` recovers. Report any failure rather than continuing past it.
- [ ] **Step 6:** Commit: `feat: orchestrate command, alert action, chaining and selftest`.

---

## Phase 4: Screens

Pages live in `ui/src/pages/*/index.tsx`, each with a matching `ui/resources/default/data/ui/views/*.xml` and `ui/resources/appserver/templates/*.html`, following the `@splunk/create` template: `<view template="search_orchestrator:/templates/<page>.html" type="html">`, and the HTML template's `make_url`-based loader. `scripts/package.sh` merges `ui/stage/`.

### Task 10: UI foundation, Jobs and Runs

**Files:**
- Create: `ui/package.json`, `ui/webpack.config.js`, `ui/tsconfig.json`, `ui/babel.config.js`, `ui/jest.config.js`, `ui/src/api/client.ts`, `ui/src/api/types.ts`, `ui/src/hooks/usePoll.ts`, `ui/src/components/{PageShell,StatusText,RunBanner}.tsx`, `ui/src/pages/{jobs,runs}/index.tsx`, `ui/src/features/jobs/{JobsTable,RunNowDialog}.tsx`, `ui/src/features/runs/RunsTable.tsx`, the views and templates for `jobs`, `runs`, `run`, `builder`, `settings`, `default/data/ui/nav/default.xml`
- Test: `ui/src/__tests__/{StatusText,JobsTable,RunsTable,client}.test.tsx`

**Interfaces:**
- `client.ts`: typed functions mirroring Task 8's routes, built on `createRESTURL` and `getCSRFToken`-based fetch from `@splunk/splunk-utils`. All throw `ApiError {code, message, issues}`.
- `usePoll<T>(fn, intervalMs=5000, active: boolean)`, pausing on a hidden tab.
- `StatusText({state, delayed})`: plain text with a `@splunk/react-icons` icon. Colour only for delayed (`statusColorMedium` or nearest current token) and failed (`statusColorHigh`). **No background fill.** `RunBanner(run)`: `@splunk/react-ui/Message` with exact sentence patterns, such as "Daily summary is delayed. It passed its 60 minute threshold 42 minutes ago. Weekly rollup will start when it finishes."
- Page wrapper uses `layout` from `@splunk/react-page/18` with `getUserTheme()`.

- [ ] **Step 1:** Set up the toolchain with npm, not yarn, as it's what's installed. Node 25 is here while the template asks `>=22`; if a build tool fails on 25, report and use a pinned 22.
- [ ] **Step 2: Write failing tests:** `StatusText renders no filled background`, `delayed banner text matches pattern`, `blocked banner names failed step`, `JobsTable shows next run and last outcome`, `RunNowDialog builds a form from declared params and shows validation errors`, `RunsTable filters by state`, `client includes CSRF and surfaces issues`.
- [ ] **Step 3:** Run `cd ui && npm test`. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run `npm test && npm run build`, then package and run AppInspect. Expected: PASS, 0 failures. Check that no HTML template trips Cloud checks; if `type="html"` views do, stop and report.
- [ ] **Step 6:** Commit: `feat: UI foundation, jobs and runs pages`.

### Task 11: Run detail

**Files:**
- Create: `ui/src/pages/run/index.tsx`, `ui/src/features/run/{RunHeader,Timeline,RunGraph,StepDrawer,RerunDialog,LogsTab,ActionsTab,ParamsTab}.tsx`, `ui/src/features/run/timeline.ts`
- Test: `ui/src/__tests__/{timeline,Timeline,RerunDialog,RunHeader}.test.tsx`

**Interfaces:**
- Consumes: Task 10's client, `usePoll`, `StatusText`, `RunBanner`, shared `GraphView` from Task 12 (build `RunGraph` on a minimal read-only SVG here and swap in `GraphView` during Task 12).
- Produces: `timeline.bars(run, now) -> [{stepId, label, kind: "running"|"waiting"|"done"|"failed"|"skipped", startPct, widthPct, statusText}]`. Reference mockup: `.superpowers/brainstorm/*/content/run-view-v2.html`.
- `RerunDialog`: step select; when the definition changed, a required `RadioList` for latest or original, **with nothing preselected** and submit disabled until chosen, with the latest option disabled and explained if unavailable; duplicate-write warning; "Start downstream jobs again" checkbox.
- Dismiss appears only on held runs. Step drawer links to search job (`/app/search/search?sid=`) and Job Inspector.

- [ ] **Step 1: Write failing tests:** `running bar solid and waiting bar hatched`, `skipped has no bar`, `rerun submit disabled until definition chosen when changed`, `no definition choice shown when unchanged`, `latest option disabled with reason`, `duplicate warning shown`, `dismiss only on held run`, `pause toggles to resume`, `step click opens drawer with sid link`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement with theme tokens via `styled-components` `variables` from `@splunk/themes`.
- [ ] **Step 4:** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: run detail with timeline and re-run`.

### Task 12: Graph-canvas builder

**Files:**
- Create: `ui/src/pages/builder/index.tsx`, `ui/src/features/builder/{BuilderPage,reducer,graphLogic,Canvas,GraphView,StepPanel,EdgePanel,JobTabs,TriggersTab,ParamsTab,ActionsEditor,AccessTab}.ts(x)`
- Modify: `ui/src/features/run/RunGraph.tsx`
- Test: `ui/src/__tests__/{graphLogic,reducer,StepPanel,Canvas}.test.tsx`

**Interfaces:**
- `graphLogic.wouldCycle(edges, from, to) -> boolean`; `graphLogic.autoLayout(steps, edges) -> positions` (dagre, top to bottom); `graphLogic.findIssues(job)`, a light client-side check, with server validation authoritative through `POST /orchestrator/jobs/validate`.
- `reducer(job, action)` actions: `addStep`, `removeStep` (removes edges), `moveStep`, `updateStep`, `connect`, `disconnect`, `updateEdge`, `setJobField`, `undo`, `redo`.
- `Canvas`: SVG with pan, zoom and node drag, drawing an edge from an output handle to a node. Colours only from theme tokens. Run-when presets ("Mondays", "1st of month") map to cron. Keyboard: Tab through nodes, Enter selects, Delete removes with a confirm. `StepPanel` has a "Depends on" `Multiselect`, so dependencies can be made with no pointer.
- `GraphView({steps, edges, statusByStep?, onSelect?})` is read-only and is reused by `RunGraph`.

- [ ] **Step 1: Write failing tests:** `wouldCycle detects indirect cycle`, `removeStep removes its edges`, `undo restores`, `depends-on multiselect creates edge`, `depends-on excludes options that would cycle`, `Mondays preset sets cron 0 1 * * 1 hour from schedule`, `server issues appear on the named step`, `who-may-run shows owner access warning`, `canvas nodes are keyboard focusable`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement, swapping `RunGraph` onto `GraphView`.
- [ ] **Step 4:** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: graph canvas job builder`.

### Task 13: Settings, hardening, docs, release

**Files:**
- Create: `ui/src/pages/settings/index.tsx`, `ui/src/features/settings/*.tsx`, `docs/admin-guide.md`, `docs/user-guide.md`, `CHANGELOG.md`
- Modify: `app/search_orchestrator/README.md`, `default/app.conf`
- Test: `ui/src/__tests__/Settings.test.tsx`

**Interfaces:**
- Settings: destinations (admin), limits, retention, audit index, fallback, and health messages from `GET /orchestrator/health`.
- Docs must state: Victoria only; a search head cluster was unit-tested only; Cloud index may need creating; Cloud may restrict outbound webhooks; how to make steps safe to re-run; `| savedsearch` wrapper limits; orphaned-owner recovery.

- [ ] **Step 1: Write failing tests:** `settings hidden from non-admins`, `health warns when audit index missing`, `health warns when fallback unset`, `secret fields write-only`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement Settings and write the docs.
- [ ] **Step 4:** Run the full suite: `.venv/bin/pytest -q && (cd ui && npm test && npm run build) && scripts/package.sh 1.0.0 && scripts/appinspect.sh dist/search_orchestrator-1.0.0.tgz`. Expected: all pass, 0 AppInspect failures. List any warnings for the owner.
- [ ] **Step 5: Owner check.** The owner installs `1.0.0`. Over MCP, re-run the Task 9 verification. The owner clicks through build job → run → delayed view → re-run, in light and dark themes, against the mockups, including the example job from the original brief.
- [ ] **Step 6:** Commit: `feat: settings, docs and 1.0.0 release`.
