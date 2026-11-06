# Step Preview and "From previous steps" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let job authors preview any step in the Job editor, against live previews of earlier steps or a past run, and add a "From previous steps" step type that loads its dependencies' results automatically.

**Architecture:** The new type is compiled server-side. Its hidden saved search starts with an engine-built `$args.so_input$`, filled at dispatch with `| loadjob` of each succeeded dependency. Previews are ad-hoc searches run as the caller through new `/services/orchestrator/preview*` routes. They reuse the run's token, edge and run-when logic, and keep no server state. The React editor tracks live previews and staleness in the tab and shows results in the step panel.

**Tech Stack:** Python 3.9+ (splunklib, REST handler, pytest with the in-memory FakeGateway), React 18 + `@splunk/react-ui`, Jest.

**Spec:** `docs/superpowers/specs/2026-11-06-step-preview-design.md`, which extends `docs/superpowers/specs/2026-11-05-search-orchestrator-design.md`.

## Global Constraints

- Splunk Enterprise 9.4+ and Splunk Cloud Victoria; `scripts/appinspect.sh` must report 0 failures.
- Splunk UI Toolkit components only; statuses are plain text plus icon, never filled pills or badges.
- Previews run as the caller via the caller's session (`user_gateway`), never as the job owner or the system user.
- Every token value lands in SPL quoted and escaped by `tokens.compile_spl` / `render_args`; the only unquoted engine-built value is `so_input`, and it is built only from sids matching `^[A-Za-z0-9_.-]+$`.
- No new KV Store collection and no stored preview state on the server.
- Existing Search (`inline`) and Saved search step behaviour is unchanged, including how messages are judged: only the new type and previews fail on subsearch truncation.
- Copy: the type is labelled **From previous steps**, and its type value is `previous`.
- Run tests with `.venv/bin/pytest -q` (repo root) and `cd ui && npm test`; build with `scripts/package.sh <v>`, then `scripts/appinspect.sh dist/search_orchestrator-<v>.tgz`.
- Commit locally after each task; never push.

## Review Focus

1. **A dependency of a `previous` step that was skipped or failed.** Its rows must be left out and the step must still run. If every dependency is out, the input is the zero-row SPL. Covered in Task 1, `test_previous_input_skips_unsucceeded`.
2. **Subsearch truncation in a `previous` step with 2+ dependencies and over 50,000 rows.** On this server Splunk reports it only as an INFO message ("Subsearch produced 100000 results, truncating to maxout [subsearch_maxout] 50000."). The attempt must fail with that text. Covered in Task 1, `test_previous_step_fails_on_subsearch_truncation`.
3. **A preview sid sent by the browser that isn't the caller's own preview of this job.** It could be another user's sid, a run sid, or any string. It must be rejected before `loadjob` or a status read. Covered in Task 3, `test_preview_rejects_foreign_sids`.
4. **Editing a step while its preview, or an upstream preview, runs.** The result must be shown as out of date, never as current. Covered in Task 5, `test_edit_during_preview_marks_stale`.
5. **"As if scheduled at" for a job with no cron trigger, or a cron trigger that never fired in the last 400 days.** The default is now. Covered in Task 2, `test_default_preview_time`.

---

### Task 1: The `previous` step type in model, compile and engine; truncation; self-test

**Files:**
- Modify: `app/search_orchestrator/bin/so/tokens.py`
- Modify: `app/search_orchestrator/bin/so/model.py:217-345`
- Modify: `app/search_orchestrator/bin/so/hidden.py:150-211`
- Modify: `app/search_orchestrator/bin/so/engine.py:935-941` (`_render_args`), and the attempt-outcome path that reads `job_status`
- Modify: `app/search_orchestrator/bin/so/gateway.py:98-133` (`parse_job_status`)
- Modify: `app/search_orchestrator/bin/so/selftest.py:73-110` (`definition()`)
- Modify: `tests/fakes.py` (`script_job` accepts `truncated=`)
- Test: `tests/test_tokens.py`, `tests/test_model.py`, `tests/test_hidden.py`, `tests/test_engine.py`, `tests/test_gateway_parsing.py`, `tests/test_selftest.py`

**Interfaces:**
- Produces:
  - `tokens.INPUT_ARG = "so_input"`.
  - `tokens.EMPTY_INPUT = '| makeresults | where 1=0'`.
  - `tokens.input_spl(sids: list[str]) -> str`: `EMPTY_INPUT` for `[]`; `| loadjob "s1"` for one sid; `| loadjob "s1" | append [| loadjob "s2"]` and so on for more. Raises `TokenError("$so_input$", "bad search id")` for a sid not matching `^[A-Za-z0-9_.-]+$`.
  - `tokens.step_spl(step: dict, step_ids: list) -> tuple[str, list[str]]`: the compiled saved-search text and arg names for an `inline` or `previous` step. For `previous` it is `"$args.so_input$ " + compiled_tail`, with names excluding `so_input`.
  - `tokens.previous_inputs(definition: dict, step_id: str) -> list[str]`: the dependency step ids, in `definition["edges"]` order, deduplicated.
  - `tokens.fill(compiled: str, args: dict) -> str`: replaces each `$args.<name>$` with its value. Previews use it.
  - `gateway.parse_job_status(...)["truncated"]`: `None`, or the first message text containing `truncating to maxout`, or `Subsearch` together with `timed out` or `auto-finalized`, from any message type.
- Consumes: `tokens.compile_spl`, `tokens.render_args`, `tokens.run_context` (existing).

- [ ] **Step 1: Write the failing tests.**

```python
# tests/test_tokens.py
def test_input_spl_shapes():
    assert tk.input_spl([]) == tk.EMPTY_INPUT
    assert tk.input_spl(["1.2"]) == '| loadjob "1.2"'
    assert tk.input_spl(["a_1", "b.2"]) == '| loadjob "a_1" | append [| loadjob "b.2"]'
    with pytest.raises(tk.TokenError):
        tk.input_spl(['x" | delete'])

def test_step_spl_previous_prefixes_input():
    step = {"id": "w", "type": "previous", "spl": "| stats sum(count) by $run.param.f$"}
    spl, names = tk.step_spl(step, ["d", "w"])
    assert spl == '$args.so_input$ | stats sum(count) by "$args.run__param__f$"'
    assert names == ["run__param__f"]

def test_previous_inputs_follow_edge_order():
    job = {"steps": [{"id": x} for x in "abc"],
           "edges": [{"from": "b", "to": "c"}, {"from": "a", "to": "c"}, {"from": "b", "to": "c"}]}
    assert tk.previous_inputs(job, "c") == ["b", "a"]

def test_fill_replaces_args_only():
    assert tk.fill('$args.so_input$ | eval x="$args.a__sid$" | eval y="$keep$"',
                   {"so_input": '| loadjob "1"', "a__sid": "1"}) == \
        '| loadjob "1" | eval x="1" | eval y="$keep$"'

# tests/test_model.py
def test_previous_step_validation():
    base = {"id": "j", "owner": "o", "steps": [
        {"id": "a", "type": "inline", "spl": "| makeresults", "earliest": "-1d"},
        {"id": "b", "type": "previous", "spl": "stats count"}], "edges": []}
    codes = {i["code"] for i in model.validate_job(base) if i["level"] == "error"}
    assert {"previous_needs_pipe", "previous_needs_dependency"} <= codes
    base["steps"][1]["spl"] = "| stats count"
    base["edges"] = [{"from": "a", "to": "b"}]
    assert not [i for i in model.validate_job(base) if i["level"] == "error"]
    assert not [i for i in model.validate_job(base)
                if i["code"] == "all_time_search" and i["step"] == "b"]

# tests/test_engine.py
def test_previous_input_skips_unsucceeded():
    # Job: a (succeeds), s (run_when never), f (fails, with an on_failure edge to p), then
    # p (previous) with incoming edges a, s, f. Dispatch args for p: so_input is
    # '| loadjob "<a sid>"' only. A second job where every input was skipped gets EMPTY_INPUT.
    ...

def test_previous_step_fails_on_subsearch_truncation():
    # p (previous) scripted done with truncated="Subsearch produced 100000 results, truncating
    # to maxout [subsearch_maxout] 50000." -> p failed, error contains "truncating to maxout".
    # An inline step scripted with the same truncated text succeeds (unchanged behaviour).
    ...

# tests/test_gateway_parsing.py
def test_status_reports_subsearch_truncation_from_info_message():
    body = _status_body(dispatchState="DONE", isDone="1", messages=[{"type": "INFO",
        "text": "[subsearch]: Subsearch produced 100000 results, truncating to maxout "
                "[subsearch_maxout] 50000."}])
    st = g.parse_job_status(body)
    assert st["state"] == "done" and "truncating to maxout" in st["truncated"]
```

The two engine tests are given as outlines. Write them with the existing `World`/FakeGateway helpers in `tests/test_engine.py`, with the assertions stated in the comments.

- [ ] **Step 2: Run them to confirm they fail.** `.venv/bin/pytest -q tests/test_tokens.py tests/test_model.py tests/test_engine.py tests/test_gateway_parsing.py`. Expected: FAIL (missing functions and codes).

- [ ] **Step 3: Implement.**
  - `tokens`: add the functions above. `fill` replaces exactly `$args.<name>$` for names in `args`.
  - `model._validate`: add a `previous` branch beside `inline`. It runs the same `orchestrate_in_step` and `unsafe_token_position` checks. It adds an error `previous_needs_pipe` ("A From previous steps search must start with |") when `spl.lstrip()` doesn't start with `|`, and an error `previous_needs_dependency` ("A From previous steps step needs at least one step before it") when no edge ends at it. It does not add the `all_time_search` warning. The `unknown_token`, undeclared-param and skippable-token checks already loop over `s.get("spl")` and apply unchanged.
  - `hidden.plan`: `previous` steps compile with `tokens.step_spl` and are saved with `mode = "previous"`. Their earliest and latest are saved as given, and the UI never sets them.
  - `engine._render_args`: use `tokens.step_spl`. For `sdef["type"] == "previous"`, add `args[INPUT_ARG] = tokens.input_spl(...)`. Its sids are those of `previous_inputs(definition, sid)` whose run step state is `succeeded`, in that order. A `TokenError` fails the attempt like any other token error.
  - `gateway.parse_job_status`: add `truncated`. `FakeGateway.script_job(..., truncated=None)` returns it in `job_status`.
  - Engine attempt outcome: where a `done` status becomes `succeeded`, a `previous` step whose status has `truncated` instead fails, with error `"input was cut short: " + truncated`.
  - `selftest.definition()`: add step `merged` (`type: previous`, name "Merge inputs", `spl: '| stats dc(branch) AS branches | where branches=2'`, no earliest or latest). Add edges b→merged, c→merged and skip_me→merged, all `on_success`. A run then gives `merged` one row exactly when both branches were loaded and the skipped step added nothing.
  - `docs/user-guide.md`: add a "From previous steps" section with what it does, the pipe rule, skipped and failed inputs, and the 50,000-row subsearch limit for the second and later inputs.

- [ ] **Step 4: Update `test_selftest.py`.** It should expect `merged` with its three edges and `type == "previous"`. The fake run must give `merged` dispatch args where `so_input` loads b and c and not skip_me. Run `.venv/bin/pytest -q`. Expected: all pass.

- [ ] **Step 5: Commit.** `git commit -m "feat: From previous steps step type; fail it on subsearch truncation"`

---

### Task 2: Server checkpoint, `previous` on the real server (owner)

**Files:** `app/search_orchestrator/default/app.conf` (version `1.1.0b1`), `CHANGELOG.md`.

- [ ] **Step 1:** Bump the version, then run `scripts/package.sh 1.1.0b1` and `scripts/appinspect.sh dist/search_orchestrator-1.1.0b1.tgz`. Expected: 0 failures.
- [ ] **Step 2:** Ask the owner to install it, restart, and run `| orchestrate selftest` in Splunk Web, then send back the run id.
- [ ] **Step 3:** Verify over MCP. Run `index=orchestrator run_id="<id>" step_id=merged type=step_attempt` and expect `outcome=succeeded result_count=1`. Then run `| rest /services/search/jobs splunk_server=local count=0 | search label="_so_so_selftest_merged*" | table search eventSearch messages*` and expect the dispatched search to start with `| loadjob "` and contain one `append`. This proves that `args` substitution inserts raw SPL. **If it fails, stop and rule:** the fallback is one hidden search per dependency subset, `2^n`, capped at `n ≤ 4`. Record the ruling in the ledger before Task 3.
- [ ] **Step 4:** Commit the version bump and changelog.

---

### Task 3: Gateway preview calls and the pure preview decision

**Files:**
- Modify: `app/search_orchestrator/bin/so/gateway.py` (add the methods to `Gateway` and `SplunkGateway`)
- Modify: `tests/fakes.py`
- Modify: `app/search_orchestrator/bin/so/state.py` (add `preview_decision`)
- Modify: `app/search_orchestrator/bin/so/cron.py` (add `prev_slot`)
- Create: `app/search_orchestrator/bin/so/preview.py`
- Test: `tests/test_preview.py`, `tests/test_gateway_parsing.py`, `tests/test_state.py`, `tests/test_cron.py`

**Interfaces:**
- Produces:
  - Gateway methods:
    - `preview_dispatch(user, spl, earliest, latest, now_epoch, sid) -> str`: POST `servicesNS/<user>/search_orchestrator/search/jobs` with `search=spl`, `id=sid`, `now=now_epoch`, `earliest_time`, `latest_time` (omitted when empty), `auto_cancel=60`, `timeout=1800` and `exec_mode=normal`.
    - `preview_info(sid) -> dict`: `{"owner", "state", "result_count", "error", "truncated", "run_duration", "messages": [{"type","text"}]}`, built from `parse_job_status` plus `eai:acl.owner`, `runDuration` and the message list. Returns `MISSING_STATUS`-like `{"state": "missing"}` on 404.
    - `preview_results(sid, count) -> {"fields": [...], "rows": [...]}`: GET `search/jobs/<sid>/results` with `count`.
    - Cancel and touch reuse `control(sid, action)`.
  - `cron.prev_slot(spec, before, tz, max_days) -> int|None`: the last slot `< before`, the mirror of `next_slot`.
  - `state.preview_decision(definition, step_id, scheduled_time, params, upstream) -> tuple[str, str|None]`. `upstream` is `{step_id: {"state": "succeeded"|"failed"|"skipped", "skip_kind", "sid", "result_count", "first"}}`. It returns `("run", None)`, `("skipped", "run_when"|"not_taken")` or `("needs", "<comma-separated step ids>")` for incoming edges it can't resolve. It builds a synthetic run and uses `_Eval.edge` and `_Eval.run_when_applies`, never a copy of their logic.
  - `preview.PREFIX = "so_preview_"`.
  - `preview.make_sid(user, job_ref, step_id, rand) -> str`: `so_preview_<sha1(user)[:8]>_<job_ref>_<step_id>_<rand>`. `job_ref` is the job id, or `new` for an unsaved job.
  - `preview.own_preview(info, sid, user, job_ref) -> bool`: true when the sid has the prefix and the job and user parts for this caller, and `info["owner"] == user`.
  - `preview.MAX_RUNTIME = 600`, `preview.TABLE_ROWS = 100`, `preview.TTL = 1800`.
  - `preview.closure(definition, step_id) -> list[str]`: the upstream steps the step reads through edges or tokens, transitively, in topological order, excluding the step itself.
  - `preview.default_time(job, now) -> int`: the latest `prev_slot` over the job's enabled cron triggers, looking back at most 400 days, else `now`.
- Consumes: `state._Eval`, `cron.parse`, `parse_job_status` (with `truncated` from Task 1).

- [ ] **Step 1: Write the failing tests.**

```python
# tests/test_state.py
def test_preview_decision_mirrors_run_rules():
    job = {"steps": [{"id": "d", "type": "inline", "spl": "x"},
                     {"id": "w", "type": "previous", "spl": "| x",
                      "run_when": {"kind": "cron", "value": "0 1 * * 1"}}],
           "edges": [{"from": "d", "to": "w"}]}
    tue = 1794272400  # Tuesday 2026-11-10 01:00 UTC; +6 days is Monday 2026-11-16
    ok = {"d": {"state": "succeeded", "sid": "s1", "result_count": 3}}
    assert state.preview_decision(job, "w", tue, {}, ok) == ("skipped", "run_when")
    assert state.preview_decision(job, "w", tue + 6 * 86400, {}, ok) == ("run", None)
    assert state.preview_decision(job, "w", tue, {}, {}) == ("needs", "d")
    failed = {"d": {"state": "failed"}}
    assert state.preview_decision(job, "w", tue + 6 * 86400, {}, failed) == ("needs", "d")
```

Check the epochs against `cron.matches` before relying on them. The `failed` case resolves to `None` for an `on_success` edge, so it reports "needs". The API turns a failed upstream into its own error, in Task 4.

```python
# tests/test_cron.py
def test_prev_slot_is_mirror_of_next_slot(): ...  # daily 01:00: prev_slot(now) <= now < next_slot

# tests/test_preview.py
def test_default_preview_time():
    assert preview.default_time({"triggers": []}, 1_800_000_000) == 1_800_000_000
    job = {"triggers": [{"type": "cron", "cron": "0 1 * * *", "enabled": True}]}
    t = preview.default_time(job, 1_800_000_000)
    assert t < 1_800_000_000 and 1_800_000_000 - t <= 86400
    never = {"triggers": [{"type": "cron", "cron": "0 1 30 2 *", "enabled": True}]}
    assert preview.default_time(never, 1_800_000_000) == 1_800_000_000

def test_preview_sid_ownership():
    sid = preview.make_sid("alice", "j1", "daily", "abc")
    assert preview.own_preview({"owner": "alice"}, sid, "alice", "j1")
    assert not preview.own_preview({"owner": "bob"}, sid, "alice", "j1")
    assert not preview.own_preview({"owner": "alice"}, sid, "alice", "j2")
    assert not preview.own_preview({"owner": "alice"}, "scheduler__x", "alice", "j1")

def test_closure_includes_token_sources():
    job = {"steps": [{"id": i, "type": "inline", "spl": s} for i, s in
                     [("a", "x"), ("b", "| loadjob $a.sid$"), ("c", '| eval n="$b.resultCount$"'),
                      ("z", "y")]], "edges": [{"from": "a", "to": "b"}]}
    assert preview.closure(job, "c") == ["a", "b"]
```

Also add a parsing test for `preview_info` and `preview_results` from canned JSON, in the style of the existing ones.

- [ ] **Step 2: Run to confirm they fail.** `.venv/bin/pytest -q tests/test_preview.py tests/test_state.py tests/test_cron.py`
- [ ] **Step 3: Implement** the functions, the gateway methods and the FakeGateway versions. FakeGateway: `preview_dispatch` records a `preview_log` entry and creates a job the way `script_job` does, keyed by the given sid. `preview_info` adds `owner`. `preview_results` returns `script["rows"]`.
- [ ] **Step 4: Run** `.venv/bin/pytest -q`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "feat: preview gateway calls, preview decision and default time"`

---

### Task 4: Preview REST routes

**Files:**
- Modify: `app/search_orchestrator/bin/so/api.py` (`_routes`, new route functions, module docstring)
- Modify: `app/search_orchestrator/default/restmap.conf` and `web.conf`, only if the existing `orchestrator/*` match does not already cover `preview`; check first.
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: Task 3 (`preview.*`, gateway methods, `state.preview_decision`); Task 1 (`tokens.step_spl`, `input_spl`, `fill`, `previous_inputs`); `hidden` saved-search selection (extract `hidden.saved_search_spl(gw, owner, step) -> (spl, issues)` from `plan`, so both share it); `authz.can_edit`.
- Produces routes (all JSON, errors as `ApiError`):
  - `POST preview/defaults` with `{"job": <definition>}` returns `{"scheduled_time": int}`.
  - `POST preview` with `{"job", "step_id", "scheduled_time", "params", "input": {"mode": "live", "previews": {step_id: {"sid"?: str, "skipped"?: "run_when"|"not_taken"}}} | {"mode": "run", "run_id"}, "anyway": bool}`. It returns one of:
    - 201 `{"status": "started", "sid", "spl"}`, where `spl` is the exact search sent.
    - 200 `{"status": "skipped", "skip_kind", "reason"}`.
    - 409 `needs_preview` with `steps: [...]` (live inputs missing, or no longer existing).
    - 409 `upstream_failed` with `step`.
    - 410 `run_results_expired` with `step`.
    - 400 `invalid` with `issues` (errors in the step or its closure only).
    - 403, as for other denials.
  - `GET preview/<sid>` returns `{"state", "result_count", "error", "truncated", "run_duration", "messages"}`. It cancels the search and returns `state: "failed", error: "Preview stopped after N minutes"` when `run_duration` exceeds `min(step max_runtime, MAX_RUNTIME)`. The step's limit is passed as the query `limit` and capped at `MAX_RUNTIME` on the server. It also touches the job.
  - `GET preview/<sid>/results` returns `{"fields", "rows", "total"}` with at most `TABLE_ROWS` rows.
  - `POST preview/<sid>/cancel` returns `{"cancelled": true}`.
- Rules:
  - Access: the caller must pass `can_edit` for the stored job, if the id exists and is visible to them, or `can_edit(None)` for a new one. Every `preview/<sid>` route requires `own_preview(...)`; a failure is 404 `not_found`.
  - Live input: each given sid must pass `own_preview`. Its `preview_info` state maps `done` to succeeded (with `result_count` and `first_row` for referenced first fields), `failed` to failed, and `missing` to needs_preview. A `running` sid also gives needs_preview, so the UI waits.
  - Run input: `_visible_run` plus `can_edit` of its job. Upstream states, sids and first values come from the run. For each upstream sid the step reads, `preview_info` is checked: `missing` gives 410.
  - The SPL sent is built from `tokens.step_spl` (or the saved-search wrapper), `render_args` with a context made from the upstream states and the request's run params, `so_input` from `input_spl`, then `fill`. Earliest and latest are the step's own, with `now=scheduled_time`. `previous` steps send no earliest or latest.
  - Params are checked with `scheduler.validate_params` (a 400 on failure).
  - `anyway: true` bypasses only the `skipped` decision, and the response adds `"anyway": true`.
  - Each start emits an audit event `{"type": "preview_dispatched", "job_id", "step_id", "sid"}`.

- [ ] **Step 1: Write the failing tests** in `tests/test_api.py`, using the existing `World`:
  - `test_preview_runs_as_caller_with_scheduled_now`: alice previews step a of an unsaved job. `user_gateway.preview_log[0]` has user alice, `now == scheduled_time`, and a sid with the `so_preview_` prefix. Nothing is dispatched on the system gateway. An audit `preview_dispatched` is emitted.
  - `test_preview_requires_edit`: a run-only user gets 403, and an unknown job id behaves as new.
  - `test_preview_downstream_uses_live_upstream_sid`: preview a, finish it in the fake, then preview b (`| loadjob $a.sid$`) with `previews={"a": {"sid": <a sid>}}`. The `spl` sent contains `| loadjob "<a sid>"`.
  - `test_preview_previous_type_from_run_input`: a run where b and c succeeded and a sibling was skipped. Previewing the `previous` step with `mode=run` sends `so_input` with b's and c's sids only.
  - `test_preview_rejects_foreign_sids`: bob's sid, a run sid and `"x"` as a live input each give 409 `needs_preview` or 404. `preview/<bob sid>` gives 404 for alice.
  - `test_preview_skip_and_anyway`: run_when Mondays on a Tuesday gives `skipped`; `anyway=true` gives `started`.
  - `test_preview_upstream_failed_and_expired`: a failed upstream preview gives 409 `upstream_failed`. A run input whose upstream sid is missing gives 410 `run_results_expired`.
  - `test_preview_poll_enforces_limit_and_touches`: a fake `run_duration` of 601 gives `failed` and a cancel in `control_log`. Below the limit there is a `touch`.
  - `test_preview_results_capped`: 150 scripted rows give 100 rows and `total == 150`.
  - `test_preview_errors_only_in_closure_block`: an invalid unrelated step still lets the preview start. An invalid upstream step gives 400.
- [ ] **Step 2: Run to confirm they fail.** `.venv/bin/pytest -q tests/test_api.py -k preview`
- [ ] **Step 3: Implement** the routes in a section `# Preview.` of `api.py`, keeping helpers small. Document the routes in the module docstring.
- [ ] **Step 4: Run** `.venv/bin/pytest -q`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "feat: preview REST routes"`

---

### Task 5: UI, the type in the editor and the preview logic

**Files:**
- Modify: `ui/src/api/types.ts` (add `StepDef['type']` value `'previous'`; add preview types)
- Modify: `ui/src/api/client.ts` (add `previewDefaults`, `startPreview`, `previewStatus`, `previewResults`, `cancelPreview`)
- Modify: `ui/src/features/builder/reducer.ts` (type conversion inside `updateStep`)
- Modify: `ui/src/features/builder/StepPanel.tsx` (type option, the read-only input line, no Earliest or Latest for `previous`)
- Create: `ui/src/features/builder/previewLogic.ts`
- Test: `ui/src/__tests__/previewLogic.test.tsx`, `ui/src/__tests__/reducer.test.tsx`, `ui/src/__tests__/StepPanel.test.tsx`, `ui/src/__tests__/client.test.tsx`

**Interfaces:**
- Produces:
  - Preview types in `types.ts`:
    - `PreviewInput = { mode: 'live'; previews: Record<string, { sid?: string; skipped?: SkipKind }> } | { mode: 'run'; run_id: string }`
    - `PreviewStart = { status: 'started'; sid: string; spl: string; anyway?: boolean } | { status: 'skipped'; skip_kind: SkipKind; reason: string }`
    - `PreviewStatus = { state: 'running' | 'done' | 'failed' | 'missing'; result_count: number; error?: string | null; truncated?: string | null; run_duration?: number; messages: { type: string; text: string }[] }`
    - `PreviewResults = { fields: string[]; rows: Record<string, unknown>[]; total: number }`
  - `client.ts` calls mirroring the Task 4 routes. Error codes surface as `ApiError` with `extra.steps` and `extra.step`.
  - `previewLogic.ts`:
    - `upstreamOf(job, stepId): string[]`: the same closure as the server's `preview.closure` (edges plus `$x.…$` tokens), topologically ordered.
    - `generatedInput(job, stepId): string`: the display text, `| loadjob ‹a›` or `| loadjob ‹a› | append [| loadjob ‹b›]`, or `(no previous steps yet)`.
    - `previewKey(job, stepId, ctx, upstreamKeys): string`. `ctx = { scheduledTime, params, source }`. It's a stable JSON of the step with inherited defaults resolved, `scheduledTime`, only the params the step references, `source` (`live` or the run id), and the upstream keys and sids.
    - `type LivePreview = { key: string; sid?: string; skipped?: SkipKind; state: 'running' | 'done' | 'failed' | 'skipped'; startedAt: number }`
    - `isStale(preview, currentKey): boolean`.
    - `toBeRun(job, stepId, previews, keyOf): string[]`: the upstream steps (in order) whose preview is missing, stale, or `missing` on the server; then the step itself.
  - Reducer: switching `inline` to `previous` keeps `spl`. Switching `previous` to `inline` rewrites `spl` to `| loadjob $a.sid$ | append [| loadjob $b.sid$] ` plus the old tail, with dependencies in edge order, and clears nothing else.
- Consumes: Task 4 routes.

- [ ] **Step 1: Write the failing tests.**

```tsx
// previewLogic.test.tsx
test('upstreamOf follows edges and tokens', () => { /* c reads $b.resultCount$, b has edge from a → ['a','b'] */ });
test('generatedInput for none, one and two deps', () => { /* exact strings above */ });
test('test_edit_during_preview_marks_stale', () => {
    // previewKey for b with a's key K1; then edit a's spl → a's key K2 → b's key changes → isStale(b) true,
    // even though b's preview is still 'running'.
});
test('toBeRun previews missing and stale upstream first, in order', () => { /* ... */ });
test('changing an unrelated step or the schedule keeps keys', () => { /* ... */ });

// reducer.test.tsx
test('switching previous → inline writes loadjob tokens in edge order', () => {
    // edges b→p, a→p; spl '| stats count' → '| loadjob $b.sid$ | append [| loadjob $a.sid$] | stats count'
});

// StepPanel.test.tsx
test('From previous steps shows the read-only input and hides time fields', () => { /* ... */ });
```

- [ ] **Step 2: Run them to confirm they fail.** `cd ui && npx jest previewLogic reducer StepPanel client`
- [ ] **Step 3: Implement.** In `StepPanel`, add the type option `<Select.Option label="From previous steps" value="previous" />`. Show the input as monospace read-only text labelled "Input (added for you)" above the Search box. Help text under Search: "Starts with |. Results of the steps before this one come first." Earliest and Latest are not shown for this type.
- [ ] **Step 4: Run** `cd ui && npm test && npx tsc --noEmit -p .`. Expected: all pass, no type errors.
- [ ] **Step 5: Commit.** `git commit -m "feat(ui): From previous steps type and preview logic"`

---

### Task 6: UI, the preview bar, the step-panel results and graph notes

**Files:**
- Create: `ui/src/features/builder/PreviewBar.tsx`, `ui/src/features/builder/PreviewResult.tsx`, `ui/src/features/builder/usePreviews.ts`
- Modify: `ui/src/features/builder/BuilderPage.tsx`, `StepPanel.tsx`, `Canvas.tsx` (a node note line)
- Test: `ui/src/__tests__/PreviewBar.test.tsx`, `ui/src/__tests__/usePreviews.test.tsx`, `ui/src/__tests__/PreviewResult.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`previewLogic`, client calls, types).
- Produces:
  - `usePreviews(job, ctx)` returns `{ previews: Record<string, LivePreview & { status?: PreviewStatus; results?: PreviewResults; error?: string }>, preview(stepId, opts?: { anyway?: boolean }), cancel(stepId) }`.
    - It runs `toBeRun` sequentially: start, poll every 2 s until done, failed or missing, then the next.
    - Starting a step that already has a running preview cancels the old one first.
    - On a 409 `needs_preview` it re-runs the named steps once, then retries.
    - It polls each `done` preview's status every 5 minutes while mounted, which keeps its TTL fresh.
    - It discards everything when the editor unmounts. It cancels running previews on unmount, best effort.
  - `PreviewBar` props: `{ scheduledTime, onScheduledTime, params: ParamDecl[], values, onValues, source, onSource, runs: RunSummary[] }`. It shows "Preview as if scheduled at" as a SUIT date and time input (Date plus Text `HH:MM`), one control per param, and "Input from" as a Select: `Live previews`, then up to 20 runs of this job, newest first, labelled `<scheduled time> · <state>`. For an unsaved job the run list is empty. Choosing a run sets the time and params from that run.
  - `PreviewResult` props: `{ preview, onCancel, onAnyway }`. It shows these states:
    - running: WaitSpinner, "Previewing…" and a Cancel button.
    - done: a line such as "3 rows · 0.4 s · input: daily preview, 2 min ago" (or "input: run 2026-11-05 01:00"), then a SUIT `Table` of up to 100 rows, plus "showing 100 of N" if more.
    - failed: a `Message type="error"` with the error, or the truncation text.
    - skipped: "Would be skipped tonight: <reason>" and a **Preview anyway** button.
    - stale: the last table, dimmed with `opacity: 0.5`, under "Out of date. Preview again to refresh."
    - A "Search sent" disclosure shows the exact `spl`.
    - The panel's small print: "Previews run with your access. Real runs use the owner's."
  - `StepPanel` gets the **Preview step** button under the search box, with `PreviewResult` under it.
  - `Canvas` node note text: `✓ 7 rows`, `previewing…`, `preview failed`, `would be skipped`, `out of date`. Plain text, using `contentColorMuted`, or `statusColorHigh` for failed.
- [ ] **Step 1: Write the failing tests:**
  - `usePreviews.test`: previewing b with no preview of a starts a and then b, in that order, with b's `previews.a.sid` set. A 409 `needs_preview` re-runs once. Cancel calls `cancelPreview`.
  - `PreviewBar.test`: choosing a run sets the time and params. An unsaved job shows only "Live previews".
  - `PreviewResult.test`: each state renders as specified, and "Preview anyway" calls `onAnyway`.
- [ ] **Step 2: Run them to confirm they fail.** `cd ui && npx jest usePreviews PreviewBar PreviewResult`
- [ ] **Step 3: Implement.** On mount, `BuilderPage` gets the default time from `previewDefaults` and the runs from the existing runs client, filtered by job.
- [ ] **Step 4: Run** `cd ui && npm test && npx tsc --noEmit -p .`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(ui): preview bar, step preview results and graph notes"`

---

### Task 7: Docs, release build and owner verification

**Files:** `docs/user-guide.md` (Previewing steps section), `docs/admin-guide.md` (preview searches: who, TTL, auto-cancel, audit event), `CHANGELOG.md` (1.1.0), `app/search_orchestrator/default/app.conf` (1.1.0).

- [ ] **Step 1:** Write the docs. Version 1.1.0. Run `.venv/bin/pytest -q`, `cd ui && npm test`, `scripts/package.sh 1.1.0` and `scripts/appinspect.sh dist/search_orchestrator-1.1.0.tgz`. Expected: all pass, 0 failures.
- [ ] **Step 2:** Commit. `git commit -m "docs: step previews; 1.1.0"`
- [ ] **Step 3 (owner):** The owner installs 1.1.0, restarts, and in the editor of a copy of the rollup job:
  1. Previews daily.
  2. Previews weekly as From previous steps from the live preview.
  3. Previews weekly from a past run.
  4. Previews with "as if scheduled at" on a day the weekly would skip, then uses Preview anyway.

  Do this in dark and light themes. Verify over MCP that `index=orchestrator type=preview_dispatched` shows the previews, and that `| rest /services/search/jobs splunk_server=local count=0 | search sid="so_preview_*" | table sid eai:acl.owner ttl` shows the owner as the user and a TTL of 1800 or less.
- [ ] **Step 4 (owner, optional):** As the restricted user from `scripts/m1_setup.sh`, given `orchestrator_admin` temporarily, try a past-run input on a job owned by someone else. If Splunk refuses `loadjob`, apply the spec §9a fallback: offer past runs only to the run's owner, and show the list greyed out with the reason for others. That is a small follow-up in `PreviewBar` and the `run` input check.
