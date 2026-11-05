# Search Orchestrator for Splunk: design

Date: 2026-11-05. Status: approved 2026-11-05.

Items marked **(owner)** came from the project owner. Items marked **(builder call)** were chosen during design and can be challenged.

## 1. Intent

Splunk cannot make one scheduled search wait for another. Today people space out schedules and hope the first search finishes in time. The clearest case is summary building: daily, then weekly, then monthly, or a summary built from another summary **(owner)**.

Search Orchestrator lets dependent searches operate as one unit: a **job** is a graph of search **steps**, and each launch of a job is a tracked **run**. A step never starts until the steps it depends on have finished. The logic and the state all live inside Splunk.

**What success looks like:** a rollup never runs on top of an unfinished summary, and when something is late or broken the owner is told, can see why, and can put it right the next morning from one screen.

## 2. Goals, non-goals, anti-goals

### Goals (first version)

- **Jobs:** serial and parallel dependencies, inline SPL or saved searches, tokens and `loadjob` between steps, and "run when" rules.
- **Reliability:** delay alerts, deadlines, retries, ordered queuing, concurrency limits, and cancel, pause, resume or re-run from a step.
- **Triggers:** cron, manual, REST, `| orchestrate`, an alert action, and completion of another job.
- **Actions:** webhook (which covers Slack), email, event to an index, start another job, and any installed alert action.
- **Screens:** graph-canvas builder, run list, per-run timeline, step logs.
- **Audit and access:** an audit index and two new capabilities.
- **Platform:** runs on Splunk Enterprise and Splunk Cloud Victoria Experience, and passes AppInspect **(owner)**. Classic Experience Cloud stacks are not supported in this version **(owner)**, and the docs say so.

### Non-goals (agreed out of the first version)

- Fan-out (running a step once per result row).
- Direct SOAR and ITSI actions. They still work through their alert actions if installed.
- A lookup-writing action. A step can use `outputlookup`.
- Arbitrary custom scripts. Package them as alert actions.

### Anti-goals (a failure even if it technically works)

- A downstream step runs after its dependency failed or has not finished.
- A late search produces a summary for the wrong time window.
- A step runs with more access than its job's owner has.
- A run fails or stalls silently.
- The app needs an external scheduler, or an exception to pass Cloud vetting.
- The screens look generic or un-Splunk-like. The owner rejected a filled status pill as "too AI designed".

## 3. Agreed behaviour **(owner)**

These are the behaviours played back and confirmed:

1. **One job, many cadences.** A job runs on one schedule, and each step has a "run when" rule, so the weekly step only activates on the weekly night. Steps that don't apply show as Skipped, not failed.
2. **Late dependency.** The downstream step keeps waiting and starts as soon as the dependency completes. A delay alert fires once at the step's threshold. A separate hard deadline is where the run finally gives up.
3. **Failed dependency.** The step retries according to its policy. If it still fails, downstream steps do not start and stay waiting, so the owner can re-run from that step the next morning.
4. **Overlapping runs.** If yesterday's run is still waiting when tonight's is due, the runs queue in order and never overlap.
5. **Builder:** graph canvas with a side panel for the selected step.
6. **Run view:** timeline with a plain Splunk-style warning message that explains the delay, and plain-text step statuses with no filled pills. Mockup: `.superpowers/brainstorm/*/content/run-view-v2.html`.
7. **Design system:** Splunk UI Toolkit (`@splunk/react-ui`).

## 4. Core concepts

### Job

A job holds: name, description, owner, enabled flag, triggers, declared parameters, steps, edges, job-level actions and defaults.

### Step

| Field | Meaning |
|---|---|
| `id` | Short token-safe identifier such as `daily`. Unique in the job. |
| `type` | `inline` or `saved_search` |
| `spl` or `saved_search_ref` | The search to run. |
| `earliest`, `latest` | Time range, resolved against the run's scheduled time (see §6). |
| `run_when` | Cron expression tested against the scheduled time, or a token expression. Empty means every run. The builder offers presets such as "Mondays" and "1st of month". |
| `delayed_after` | Duration from the scheduled time. |
| `give_up_after` | Duration from the scheduled time. |
| `max_runtime` | Limit per attempt. Exceeding it cancels the search and counts as a failed attempt. |
| `retries` | Extra attempts after a search has run and failed, with exponential backoff. |
| `workload_pool` | Optional. |
| `actions` | Step-level hooks. |

Step fields left empty inherit the job's defaults. Builder-call defaults: `delayed_after` 1 hour, `give_up_after` 24 hours, `max_runtime` 4 hours, `retries` 0.

`retries` defaults to 0 because re-running a search that may already have written to a summary index can create duplicates. Dispatch errors, where the search never started, are always safe to repeat, so they retry up to 3 times regardless **(builder call)**. The builder shows the duplicate warning when `retries` is above 0.

### Edge

A dependency between two steps, with a condition:

- `on_success` (the default)
- `on_failure`, for clean-up or notification branches
- `always`
- An expression, such as `$daily.resultCount$ > 0`

### Run (instance)

One launch of a job: run ID, scheduled time, trigger, parameter values, a snapshot of the job definition, and the state of each step (search ID, timings, attempts, result count, error).

The snapshot means that editing a job never changes a run already in progress, with one deliberate exception: re-run from a step, in §5 **(builder call)**.

## 5. State model

**Run states:** `queued`, `running`, `blocked`, `paused`, `succeeded`, `failed`, `cancelled`.

**Step states:** `waiting`, `ready`, `running`, `retrying`, `succeeded`, `failed`, `skipped`, `cancelled`, `abandoned`.

"Delayed" is a flag on a waiting or running step or run, not a state, because the work is still expected to finish. The screens render it as described in §11.

Rules:

- **Order of evaluation **(builder call)**:** `run_when` is evaluated only after all of a step's dependencies have resolved. In daily → weekly → monthly, the weekly can't be skipped early and so can't release the monthly while the daily is unfinished.
- **Ready:** every incoming edge is resolved and at least one is satisfied.
- **Two kinds of skip **(builder call)**:**
  - `skipped (run_when)`: the step's cadence doesn't apply tonight. It passes through, satisfying `on_success` and `always` edges. This matters for rollups: when the 1st of the month is not a Monday, the weekly is skipped but the monthly must still run.
  - `skipped (not taken)`: every incoming edge resolved and none was satisfied, such as an unused `on_failure` branch or an expression that evaluated false. Only `always` edges leave it, so a branch that wasn't taken stays not taken.
- **Edge table:**

| Upstream outcome | `on_success` | `on_failure` | `always` | Expression |
|---|---|---|---|---|
| Succeeded | satisfied | not satisfied | satisfied | evaluated |
| Failed (after retries) | unresolved, downstream waits | satisfied | satisfied | evaluated; a token from the failed step that has no value counts as false |
| Skipped (run_when) | satisfied | not satisfied | satisfied | false |
| Skipped (not taken) | not satisfied | not satisfied | satisfied | false |

- **Tokens from a skipped step:** a reference such as `$weekly.sid$` fails that step with a clear error, unless the token declares a default (`$weekly.sid|default$`). The builder warns about this when a job is saved.
- **Unsatisfied edges:** an `on_success` edge from a failed step stays unresolved. The downstream step keeps waiting.
- **Handled and unhandled failures **(builder call)**:** a failed step is *handled* if it has an outgoing `on_failure` or `always` edge. An unhandled failure, including one in a leaf step with nothing downstream, makes the run `blocked` once nothing else can progress. A run whose failures were all handled ends `failed`, not `succeeded`, so job-level `on_failure` hooks fire and the problem stays visible, but it doesn't wait for a person.
- **Blocked runs:** a blocked run still holds its place in the queue, so later runs for that job wait behind it. It ends by re-run, cancel or deadline.
- **Delay clock **(builder call)**:** `delayed_after` counts from the scheduled time for on-time scheduled runs, so time queued behind an earlier run counts and the delay alert still fires. For backfills, catch-up, manual and chained runs, it counts from when the run leaves the queue, as does any re-run. The alert fires once per run, and once more per re-run. It can't fire while the run is paused.
- **Give-up clock **(builder call)**:** `give_up_after` always counts from when the run leaves the queue, or from the re-run for a re-run. A queued run can therefore never expire before it has had a chance to work, and a backfill or a Monday re-run of Friday's failure isn't dead on arrival. Pausing stops this clock.
- **Giving up:** when a step's `give_up_after` passes, the step's search is cancelled if still running, and the step fails. Any other searches running in the same run are cancelled too. Unfinished steps become `abandoned` and the run becomes `failed`.
- **After giving up **(owner)**:** a per-job setting, `after_give_up`, controls later runs:
  - `hold` (the default): later runs stay queued until someone re-runs or dismisses the failed run, and then proceed in order. A rollup can't run over a window with a missing day. A warning message and the job's failure actions make the hold visible, and an alert repeats daily while it lasts **(builder call)**. Reaching the queue cap while held is reported the same way.
  - `continue`: later runs proceed. The Monday weekly can then run with Friday missing, and the setting's help text says so.
  - A re-run of the held run goes first, keeping the order. In `continue` mode, the app does not rebuild rollups that already ran.
- **Pause:** no new steps start, and running searches carry on.
- **Cancel:** running searches are cancelled and unstarted steps become `cancelled`.
- **Re-run from a step:** resets that step and everything downstream in the same run, with the same scheduled time and parameters. Completed upstream steps are kept. It is allowed on `blocked`, `failed` and `cancelled` runs. On a run that has already ended, it stays subject to the one-active-run rule.
- **Re-run definition **(owner)**:** if the job changed since the run started, the re-run dialog says so and the person re-running must choose between the latest definition and the original one, with nothing preselected. The `| orchestrate` and REST equivalents require the same choice in that case. If the latest definition removed or renamed a step the run depends on, that option is disabled with the reason. Hidden saved searches are named by content (`_so_<job>_<step>_<hash>`), so old and new versions coexist, and unused versions are removed once no active run needs them. A run using the latest definition takes on the job's current owner.
- **Re-run warning:** retries and re-runs can write duplicates to a summary index when the search itself uses `collect` or summary indexing. The screens warn before a re-run, and the docs explain how to make steps safe to repeat. The app does not try to detect or remove duplicates.

## 6. Time: the scheduled-time rule

Every step's time range resolves against the run's **scheduled time**, never the time the step actually starts. Without this, a daily summary delayed past midnight would summarise the wrong day, which is an anti-goal. Searches are dispatched with `dispatch.now` set to the scheduled time. Manual, REST and alert-triggered runs use the time they were requested, and may override it, which also gives a simple way to backfill a day.

Chained runs, whether from a completion trigger or the start-job action, inherit the upstream run's scheduled time. A late upstream job therefore can't make the downstream job summarise the wrong day **(builder call)**.

Cron schedules use a job-level IANA time zone, defaulting to the server's **(builder call)**.

Missed schedules (engine or Splunk down) follow a per-job policy **(builder call)**: `all` (default, capped at 7 runs, queued oldest first), `latest`, or `none`. Each schedule slot has one deterministic run key (`job:scheduled_time`), so a restart can never launch a slot twice.

## 7. Passing data between steps

Tokens available in SPL, expressions and action templates:

- `$run.id$`, `$run.scheduled_time$`, `$run.param.<name>$`
- `$<step>.sid$`, `$<step>.resultCount$`, `$<step>.status$`
- `$<step>.first.<field>$`, a field from the first result row

Full results pass with `| loadjob $step.sid$`, so nothing runs twice. The engine keeps each dependency's results alive until the run ends, using the job control `touch`/`setttl` action. A setting controls how long results are kept after a run ends so that re-runs can use them; default 24 hours **(builder call)**. If results have expired by the time of a re-run, the step fails with a message saying which upstream step to re-run.

**Injection protection:** run parameters are the only values that come from outside the job's author, so each one declares a type (`string`, `number`, `enum`, `time`) and an optional regex. Values are validated when the run starts, and `string` values are inserted escaped as SPL string contents. `first.<field>` values are escaped the same way.

## 8. Engine

A single persistent Python modular input (`orchestrator_engine`) is the only component that advances state. It loops every 5 seconds by default:

1. Take or renew the leader lock. If it isn't leader, sleep.
2. Fire due cron triggers and consume pending commands from the screens and REST.
3. Promote queued runs. A job has at most one active run.
4. For each active run: evaluate delays and deadlines, resolve edges and `run_when`, and start ready steps within the concurrency limits.
5. Poll running searches, record results and schedule retries.
6. Touch results that are still needed.
7. Execute pending actions.
8. Write state to KV Store, and audit events to the index.

**Restart safety:** all state is in KV Store, so a restarted engine resumes, and in-flight searches are picked up by search ID. If a search has disappeared, that counts as a failed attempt.

**Search head clusters:** the modular input runs on every member, and a KV Store lease document (30 second expiry, renewed each tick) makes sure only one is active. The test server is standalone, so this is unit-tested only. This gap must be stated in the docs.

**Limits:** global running-search limit, default 10; per-job limit, default 4; queue cap per job, default 20. When the queue cap is hit, the new run is rejected, audited and reported through the job's `on_failure` actions. All of these are settings **(builder call)**.

**KV Store collections:** `so_jobs`, `so_runs`, `so_step_runs`, `so_action_runs`, `so_commands`, `so_locks`, `so_settings`. Collection ACLs deny ordinary users write access, so all changes go through the REST handler. Run records are pruned after 90 days by default, while audit events remain in the index for its retention period **(builder call)**.

Cron parsing and the expression evaluator are small in-house parsers. There is no `eval`, and no compiled dependencies. The expression grammar is deliberately small: comparisons, `and`, `or`, `not`, numbers, strings and tokens.

## 9. Security: running as the owner

Steps run as the job owner, never as a privileged service account **(owner)**.

**Mechanism:**

- Saving a job calls the REST handler with the *user's own session*. For each inline step it creates a hidden private saved search owned by that user (`_so_<job>_<step>`), with no schedule and `dispatchAs = owner`.
- Tokens in the SPL are compiled to `$args.<name>$` so values can be passed at dispatch.
- The engine dispatches through `/servicesNS/<owner>/search_orchestrator/saved/searches/<name>/dispatch`.
- Saved-search steps depend on who owns the search **(builder call)**:
  - **The job owner owns it and it has `dispatchAs = owner`:** dispatched directly, which preserves its configured time range, summary indexing and actions, unless the step overrides the time range.
  - **Anything else:** wrapped in a hidden `| savedsearch` owned by the job owner, so it runs with the job owner's access. Its own summary indexing and actions don't run in this mode, and the builder says so at save time.

**This must be proven first.** Milestone 1 is a small build the owner installs, which verifies on the real server that:

- the search runs with the owner's identity, roles and index access;
- `args.*` substitution and `dispatch.now` work;
- the engine can touch and cancel those jobs, and read their results;
- `loadjob` works across steps;
- `workload_pool` can be set at dispatch (if not, it leaves the first version);
- both saved-search modes behave as described above.

An admin-owned test would pass without proving anything, so this must use a restricted user and an index that user can't read. The builder's connection can only run searches, so the milestone ships a short scripted procedure for the owner to create that user and index, and save the test job under that user's session. The builder then verifies the results through the connection **(builder call)**.

**Fallback if it fails:** stop and bring the problem to the owner before building further. The likely alternative is a per-owner Splunk auth token held in the credential store, which has different rotation and Cloud implications.

**Capabilities and roles:**

| Capability | Allows |
|---|---|
| `orchestrator_admin` | Manage all jobs, settings and webhook destinations |
| `orchestrator_build` | Create and edit own jobs |
| `orchestrator_run` | Start and control jobs they may run, and view runs |

The draft named two capabilities, `orchestrator_admin` and `orchestrator_run`. A third, `orchestrator_build`, was added so that being able to run jobs does not also mean being able to author SPL **(builder call)**. It is enforced in the REST handler, with matching roles shipped in `authorize.conf`. `admin` and `sc_admin` inherit `orchestrator_admin`.

**Who may see what **(builder call)**:** `orchestrator_admin` users see everything. Anyone else sees the jobs they own or may run, including those jobs' SPL and run history, and nothing else. A listed role must also hold `orchestrator_run`. Run records store only what's needed: result counts, search IDs, and `first.<field>` values only for tokens the job actually references. The search job links enforce Splunk's normal access rules. Anyone given run access can see those stored values, and the who-may-run setting says so.

**Who may run what:** a job's owner, `orchestrator_admin` users, and roles listed on the job. Because a run executes with the owner's access, listing a role lets its members cause searches to run as the owner, but only the SPL the owner saved, with parameters validated as in §7. The builder states this next to the setting.

**Editing someone else's job:** an `orchestrator_admin` who saves a change to another person's job becomes its owner, and this is audited. This stops anyone changing the SPL that runs under another person's identity **(builder call)**.

**Job-to-job chaining and actions:** the start-job action and completion trigger check that the upstream job's owner may run the target job.

**Orphaned owners:** if an owner's account is removed, runs fail with a clear error, and an admin can take ownership.

**Secrets:** webhook URLs and tokens are stored in Splunk's credential store (`storage/passwords`), never in job definitions.

## 10. Triggers and actions

### Triggers

| Trigger | Details |
|---|---|
| Cron | Set on the job and evaluated by the engine. |
| Manual | From the screens, with a parameter form. |
| REST | `POST /servicesNS/-/search_orchestrator/orchestrator/jobs/<id>/runs` |
| Search command | `\| orchestrate start job=X param.foo=bar [scheduled_time=...]`, a generating custom command. Also `status`, `cancel` and `selftest`. |
| Alert action | "Start orchestrator job", which lets any alert start a job. |
| Job completion | Set on the downstream job: "after job X succeeds" or "completes". |

Every trigger except cron and completion uses the caller's session for permission checks.

`| orchestrate selftest` (admin only) creates and runs a small built-in job using `makeresults`, which covers serial and parallel steps, tokens, `loadjob`, a skipped step and a retry. The existing MCP connection can only run searches, so this is how a build gets verified on the server **(builder call)**.

### Actions

Hooks at step or job level: `on_start`, `on_success`, `on_failure`, `on_complete` and `on_delayed` (added to carry the agreed delay alert).

| Action | How it runs |
|---|---|
| Webhook | Engine POSTs to a named destination with a templated JSON body. Slack is a preset body. |
| Email | `sendemail` in a hidden search, as the owner. |
| Event to an index | `collect` in a hidden search, as the owner. |
| Start another job | Engine creates a run after the permission check. |
| Any installed alert action | `sendalert` in a hidden search, as the owner, using the action's parameters. |

**Webhook destinations:** an `orchestrator_admin` defines each one once (name, HTTPS URL, optional auth header), and job builders only pick from the list. This keeps secrets out of jobs and stops builders aiming the search head at arbitrary internal URLs **(builder call)**. TLS verification is always on. The draft's HEC route was replaced with `collect`, which needs no token.

**Failure handling:** actions retry 3 times with backoff. An action failing never changes the run's outcome, but it is recorded, audited and visible in the run's Actions tab.

**Fallback notification **(builder call)**:** a delay or failure must never be silent, even when a job has no matching action or its action fails. Settings holds a default notification destination (a webhook destination or an email address). The engine sends to it when a job has no `on_delayed` or `on_failure` action, or when that action has exhausted its retries. These messages carry only job, run and step names, status and links, so they don't run as the owner and still work when the owner's account is gone. If no destination is configured, saving such a job shows a warning and Settings shows a health message.

**Chained runs **(builder call)**:** a completion trigger or start-job action fires once per upstream run, the first time that run reaches the matching outcome. A failed upstream run that later succeeds on re-run therefore starts the downstream job, while re-running an upstream that had already succeeded doesn't, unless the re-run dialog's "start downstream jobs again" box is ticked. The run key is `job:upstream_run_id:trigger`, which prevents duplicates across restarts.

**Message content:** the default failure and delay messages link to the run page and the failed searches.

## 11. Screens

Built with React and `@splunk/react-ui` 5.x, `@splunk/themes` and `SplunkThemeProvider`, following both light and dark Splunk themes. Screens poll the REST handler every 5 seconds while something is active.

**Jobs:** table of name, owner, next run, last run outcome, and enable/disable. Actions: New job, Run now.

**Job builder:**

- A graph canvas (selected by the owner). Add steps, drag them, and draw edges between them.
- The side panel edits the selected step or edge: search, time range, run-when, delay, give-up, retries, actions.
- Job-level tabs cover triggers, parameters, default actions and who may run.
- `@splunk/react-ui` has no graph component, so the canvas is custom SVG using theme tokens for all colours and type, with `@dagrejs/dagre` for auto-layout.
- Keyboard and screen-reader users can add and connect steps entirely from the side panel with a "Depends on" multi-select.
- Validation on save: cycles, unknown tokens, unreadable saved searches, invalid cron, token references to steps that might be skipped.

**Runs:** filterable table of job, scheduled time, state, duration and trigger, built on the KV Store rather than the index.

**Run detail:**

- Tabs: Timeline, Graph, Logs, Actions, Parameters.
- The timeline is a Gantt view. Running steps show a solid bar, and waiting steps show a hatched bar.
- A plain warning `Message` under the header states the reason, for example "Daily summary is delayed. It passed its 60 minute threshold 42 minutes ago. Weekly rollup will start when it finishes."
- Step status is plain text, with colour used only for delayed and failed text. **No filled pills or badges for status** **(owner)**.
- Clicking a step shows its status, attempts and fired actions, with links to its search job and Job Inspector.
- Header actions: Pause or Resume, Cancel, Re-run from step, with the §5 duplicate warning, and Dismiss for a failed run holding the queue.

**Settings** (admin): webhook destinations, global limits, retention, audit index name.

## 12. Audit

The engine writes every state change as a JSON event to the `orchestrator` index (macro `orchestrator_index`, sourcetype `orchestrator:audit`): job saved, run state changed, step attempts, actions, permission denials and ownership changes.

The app ships an `indexes.conf` for Enterprise. Cloud admins may need to create the index themselves, and the docs say so. The app keeps working if the index is missing, because screens read from KV Store. In that case a Settings health message says audit events are being lost.

## 13. Packaging and constraints

- App ID `search_orchestrator`, packaged as a `.tgz` installable through Manage Apps or Cloud self-service.
- Python 3 only, with `python.version` declared, and compatible with the Python shipped in Splunk Enterprise 9.4 and later. The test server is 10.6.1.1. Vendored pure-Python dependencies only (`splunklib`, in `lib/`). No compiled binaries.
- Custom REST through a persistent `restmap.conf` handler, with all permission checks on the server.
- **Definition of done for packaging:** `splunk-appinspect inspect --mode precert --included-tags cloud` reports no failures, with any warnings listed for the owner.
- No `eval` or `exec`, no writing outside the app's permitted areas, and TLS verification always on.
- `app.manifest` present. Screens load only local assets, and no CDN.

## 14. Testing and verification

**Local:**

- Python unit tests (`pytest`) for the DAG, state transitions, cron, expressions, token escaping, the lease lock and permission rules.
- The engine is tested against a fake Splunk and KV Store, including restart mid-run and every agreed behaviour in §3.
- Jest and React Testing Library for the builder's graph logic, validation and run view.
- AppInspect on every packaged build.

**On the owner's server (10.6.1.1, standalone):** the owner installs each build, and the builder verifies through the MCP connection (read-only searches, `| rest`, and `| orchestrate`):

- Milestone 1's identity proof.
- `| orchestrate selftest`.
- A real rollup scenario with an artificially slow daily, showing wait, delay alert, late start of the weekly, and correct time windows.
- A failure, followed by re-run from step.

The builder cannot click through the screens on the server unless browser access is arranged, so the owner does a final screen check.

**Not testable here:** a real search head cluster and a real Splunk Cloud stack. AppInspect's Cloud checks are the evidence for Cloud, and this limit will be reported in the delivery notes. The docs also note that Cloud stacks may restrict outbound webhooks, which an admin may need to allow.

## 15. Build order

1. Identity spike (§9). The owner installs it. Stop here if it fails.
2. Engine core, KV Store model, REST handler, `| orchestrate`, audit. Verify with `selftest`.
3. Triggers and actions.
4. Screens: jobs, run list, run detail, then the builder.
5. Hardening, docs, AppInspect clean, final package.

## 16. Left to the builder

Internal module layout, REST payload details, KV Store field naming, polling backoff, the exact Gantt rendering, and how SUIT components are composed, provided the behaviours above are met.
