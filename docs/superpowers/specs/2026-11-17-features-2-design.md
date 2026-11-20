# Search Orchestrator: features round 2

Date: 2026-11-17. Status: the owner approved the feature list; the design calls are Claude's and are marked *(my call)*. Releases 1.19.0 to 1.23.0, branch `features-2` (from `main` at 1.18.2).

Builds on `2026-11-05-search-orchestrator-design.md` (core), `2026-11-16-node-editor-design.md`, `2026-11-16-node-editor-2-design.md` and `2026-11-17-spl-conditions-design.md`. Every rule there still holds: steps run as the job owner; the engine is the only component that advances runs; every engine change is restart-safe and idempotent; the server validates everything; sentence case; buttons start with a verb; errors say what is wrong and how to fix it; destructive actions are confirmed in a `Modal` titled with a question; no `Badge`, `Chip` or filled pill for status; colours only from theme tokens; everything doable with the pointer is doable with the keyboard.

## 1. Intent

The owner picked ten features that make the app easier to trust day to day: undo a bad save, check a condition before a run depends on it, know when a job misses its finish time, re-run a month of history in one go, see how jobs feed each other and when they run, notify the tools teams already use, stop a run for a human decision, reuse common pieces, and see what each job costs.

**Success:** an owner who broke a job yesterday restores last week's version in two clicks; a missed 06:00 finish pages the on-call through PagerDuty; a 30-day backfill runs in order without flooding the queue and can be stopped as one unit; a run that needs sign-off waits for it and records who decided.

### Non-goals

- Running two runs of the same job at the same time, also for backfills (the one-active-run rule protects rollups).
- Editing snippets in place inside jobs (an inserted snippet is a copy; changing the snippet later does not change jobs).
- Storing CPU and memory per run in KV Store (they are read from `_introspection` when asked).
- A dependency graph across apps or across jobs the viewer may not see.
- Two-way integrations (closing a PagerDuty incident or a ServiceNow ticket from Splunk beyond the PagerDuty resolve event in section 7).

### Anti-goals (a failure even if it works)

- Opening and saving a job without editing it changes the job, adds a version, or changes how it runs.
- A job saved before 1.19.0 behaves differently after the upgrade.
- A backfill, an approval or a deadline that a restart can make fire twice, skip, or forget.
- A restore, a snippet or an approval that lets someone act with more access than they have.
- A secret (webhook URL, PagerDuty routing key, ServiceNow password) appearing in a job, a version, a snippet, an audit event or a screen.

## 2. Shared decisions

- **Field compatibility:** every new job field is optional. Absent means the old behaviour, and the client never writes a new field with its default value, so an unchanged job round-trips byte for byte *(my call)*.
- **New KV Store collections:** `so_job_versions`, `so_backfills`, `so_snippets`. Each is declared in `collections.conf` and restricted in `metadata/default.meta` like the others (`read : [ admin, sc_admin ], write : [ admin, sc_admin ]`); all access goes through the REST handler.
- **New global names** (need rename rules in `scripts/variant_rename.py`): capability `orchestrator_approve`, role `orchestrator_approver_role`, pages `calendar` and `dependencies` (their views and templates), and one macro, `orchestrator_search_process` (search processes in `_introspection`, for the Run health Performance section). No new alert actions or commands: `| orchestrate` gains the actions `backfill` and `approve` *(my call)*. New REST routes live under `/orchestrator/` and are at most three segments deep, so `web.conf` needs no new `expose` stanza.
- **Audit:** every new state change is an event in the audit index, named in each section.
- **Large files:** `engine.py` (1357 lines), `api.py` (1135) and `BuilderPage.tsx` (595) only gain call sites; new behaviour lives in new modules (`history.py`, `condition_test.py`, `deadline.py`, `backfill.py`, `calendar_api.py`, `approval.py`, `snippets.py`, `perf.py`, and matching UI files). New files stay at or under 600 lines.
- **UI API modules:** `ui/src/api/client.ts` exports its `request` and `enc` helpers; each feature adds `ui/src/api/<feature>.ts` with its types and calls, so `types.ts` (414 lines) does not grow past 600.
- **No new dependencies.** The calendar, dependency graph and diff view use React, SUIT and `@dagrejs/dagre`, which the app already has.

## 3. Job version history and rollback (1.19.0)

### Data

`so_job_versions` documents, key `<job_id>:<n>` (`n` from 1, increasing per job):

| Field | Meaning |
|---|---|
| `job_id`, `version` | The job and `n`. |
| `saved_at`, `saved_by` | When, and the user whose save made it. |
| `owner` | The job's owner after that save. |
| `definition` | The job as saved, without server fields (`owner`, `hidden_searches`, `created_*`, `updated_*`, `_key`, `_user`). Includes `layout` and `enabled`. |
| `summary` | Up to 8 short lines describing what changed from the previous version, e.g. "Changed the search of Daily summary", "Added step Weekly rollup", "Moved 3 nodes". |
| `restored_from` | The version number this save restored, if it was a restore. |

### Behaviour

- **When a version is written:** at every successful create, update and restore whose stored definition differs from the newest version's `definition`. A save of an unchanged job writes nothing *(my call)*. Turning a job on or off (`jobs/<id>/enabled`) also writes a version ("Turned the job off"), because it changes when it runs.
- **Jobs from before 1.19.0:** the first save of a job with no versions first writes the job as it was stored as version 1, with summary "Saved before version history started", then the new save as version 2. So the pre-upgrade state is always restorable *(my call)*.
- **Layout:** a layout-only change is a version with summary "Moved n nodes" or "Changed groups", so a restore also brings back the picture.
- **Diff:** computed on the server by one function, `history.diff(a, b)`, used for the stored summary and for the compare view, so they never disagree. It returns a list of changes `{path, kind, label, before, after}` where `kind` is `added`, `removed` or `changed`, `path` is readable (`steps.daily.spl`, `edges.daily>weekly.condition`, `triggers[0].cron`, `actions[1]`, `settings.timezone`), and `label` is a sentence ("Changed the search of Daily summary"). Steps and edges are matched by id and by `from>to`, not by list position, so reordering is not a change. Layout positions are folded into one change ("Moved 3 nodes").
- **Retention:** at most 50 versions per job *(my call)*; the oldest beyond that are deleted after each write. Deleting a job deletes its versions (a new job with the same id must not see them).
- **Restore:** runs the normal save path with the version's `definition` (validation, hidden saved searches written as the restorer, the "admin becomes owner" rule and its confirmation). It is a new version with `restored_from`. A restore that fails validation (for example a saved search that no longer exists) returns the same 400 `job_invalid` with issues as a save, and changes nothing.
- **Concurrent saves:** the version number is taken as newest + 1; if the insert finds the key taken, it retries with the next number (up to 5 times).

### REST

| Route | Who | Returns |
|---|---|---|
| `GET jobs/<id>/versions` | may view the job | `{"versions": [{version, saved_at, saved_by, owner, summary, restored_from}]}`, newest first. |
| `GET jobs/<id>/versions?version=<n>` | may view the job | `{"version": {..., "definition"}}`. |
| `GET jobs/<id>/versions?compare=<a>,<b>` | may view the job | `{"from": a, "to": b, "changes": [...]}`. `b` may be `current` (the stored job). |
| `POST jobs/<id>/restore` `{"version": n}` | may edit the job | the same body as `PUT jobs/<id>` (`job`, `issues`, owner change). |

### Audit

`job_version_saved` (`job_id`, `version`, `summary`), `job_restored` (`job_id`, `from_version`, `to_version`), `job_versions_pruned` (`job_id`, `count`).

### UI

A **History** tab in the builder (after Source). It lists versions: number, "Saved by alice · 2 hours ago", the summary lines, and "Restored from version 4" where it applies. Each row has **Compare with current** and **Restore**. Two checkboxes pick any two versions for **Compare selected**. The compare view shows the changes grouped by step, edge, trigger, action and job setting, each as before → after; long text (SPL) is shown as two read-only blocks, removed lines and added lines marked with `−` and `+` and colour from `statusColorHigh`/`statusColorNormal` text, never only colour. **Restore** opens a Modal "Restore version 4?" explaining it saves a new version and that unsaved edits are discarded; with unsaved edits the Modal says so first. After a restore the editor reloads the job. A new, unsaved job shows "Save the job to start its history."

## 4. Test condition (1.19.0)

A **Test condition** button in the condition editor (the If… node and a condition line) runs the line's condition now with the editor's preview context (scheduled time, parameters, and Input from live previews or a past run) and says true or false and why.

### REST

`POST preview/condition` `{"job", "from", "to", "scheduled_time", "params", "input"}` (same `input` as `POST preview`). Permission: the same as previews (may edit the job, `orchestrator_build` or admin). Listed before `preview/<sid>` in the route table.

- The line must exist and have `condition: expression`; else 400 `unknown_edge`.
- The source step's results come from the input like a preview's: 409 `needs_preview` (`steps: [from]`) when there is no live preview of it, 410/403 for expired or forbidden run results, as previews do.
- **Source skipped:** 200 `{"status": "done", "result": false, "why": "Weekly rollup would be skipped, so this line isn't taken; no condition runs."}` (a run does the same).
- **Simple comparison:** evaluated on the server with `expr.py` against the token values. 200 `{"status": "done", "kind": "simple", "result": true|false, "filled": "1204 > 0", "values": {"daily.resultCount": "1204"}, "why": "1204 > 0 is true"}`. A parse error is 200 with `result: false` and `error` (a run counts it as not met), and `why` says how to fix it.
- **SPL expression / Search returns results:** the compiled condition with its tokens filled in, dispatched as an ad-hoc search **as the caller** (like a preview, never as the owner), `dispatch.now` = scheduled time, with the condition's own time range (`-1m`..`now` for SPL expression). Its sid is a preview sid of the line's target step (`preview.make_sid(user, job_ref, to, "c" + random)`), so the existing `GET preview/<sid>`, `.../results` and `.../cancel` routes, the 180 s auto-cancel and the 30 minute TTL apply. Reply 201 `{"status": "started", "kind", "sid", "spl", "earliest", "latest"}`. The client polls; `result_count > 0` is true, a failed search is false with its error. Runtime cap 300 s, the engine's condition timeout.
- Audit `condition_tested` (`job_id`, `edge`, `kind`, `sid` when dispatched).

### UI

The result shows under the condition field: "True: the line would be taken" or "False: the line would not be taken", then the why line, the filled SPL in a read-only code block with **Copy**, the row count for SPL modes, and the error (in `statusColorHigh` text with the error icon). With no preview of the source step it says "Preview Daily summary first to test this condition." with a **Preview Daily summary** button. The result is marked out of date when the condition text, mode, time range, scheduled time or input changes.

## 5. Deadlines (SLA) (1.20.0)

### Data

Job field `deadline` (optional): `{"finish_by": "HH:MM" | absent, "within": seconds | absent}`; at least one present. `finish_by` matches `^([01]\d|2[0-3]):[0-5]\d$`; `within` is an integer from 60 to 604800 (7 days).

### Behaviour

- **Which runs have a deadline** *(my call)*: on-time scheduled runs (`trigger: cron`, not catch-up) and chained runs (`completion`, `start_job`), which inherit the upstream scheduled time. Manual, REST, alert-action, backfill and catch-up runs have none: their scheduled time is often in the past, so they would be late at once. A re-run keeps the run's deadline.
- **When it is:** `within` → scheduled time + `within`. `finish_by` → the first `HH:MM` in the job's time zone at or after the scheduled time (00:30 scheduled with finish by 06:00 → 06:00 the same day; 07:00 scheduled → 06:00 the next day). With both, the earlier. Stored on the run as `deadline_at` when the run is created.
- **Late:** when `now >= deadline_at` and the run is queued, running, blocked or paused, the engine marks it once: `late_at`, audit `run_late` (`deadline_at`, `state`), and fires the job-level hook `on_late`. The deadline is wall-clock time: pausing does not move it *(my call)*. A run that ends before its deadline is never late. One deadline per run, so the event fires once (and not again on re-run).
- **Fallback:** `on_late` uses the fallback notification like `on_delayed` when the job has no `on_late` action or it runs out of retries *(my call: a missed deadline is the delay the core spec says must never be silent)*.
- **Restart safety:** the hook is submitted (idempotent action row, key `run_id:job:on_late:None:0`) before the run recording `late_at` is saved; a replayed tick finds `late_at` or the row.
- Message verb: "is late" ("Job "Daily summary" is late (run …, status running)").

### UI

- Job **Settings** tab, section **Deadline**: **Finish by** (time, `HH:MM`, "in the job's time zone") and **Finish within** (duration after the scheduled time). Help: "Only scheduled runs and runs started by another job have a deadline."
- Whole job node: a new outcome **⌛ Is late** (actions only), so an action line can hang off it; the When list shows it only on the Whole job node.
- Run page: when late, a warning `Message`: "This run missed its deadline (06:00). It is still running." or "…It finished 12 minutes late." The run header shows "Deadline 06:00" in muted text.
- Run health: a **Late runs** single value and a "Late runs" table (job, scheduled time, deadline, how late, final state) from `run_late`.

## 6. Backfill (1.20.0)

### Data

`so_backfills` documents, key `bf<12 hex>`:

| Field | Meaning |
|---|---|
| `job_id`, `created_by`, `created_at` | |
| `from`, `to` | Epoch range, `from` inclusive, `to` exclusive. |
| `source` | `schedule` (the job's enabled cron triggers) or `step` (every `step` seconds from `from`). |
| `step` | Seconds (`step` source only), 60 to 2678400 (31 days). |
| `slots` | The scheduled times, oldest first, at most 100 *(my call)*. |
| `params` | Validated run parameters, the same for every run. |
| `concurrency` | Runs of this backfill allowed in the job's queue at once, 1 to 5, default 1. |
| `next` | Index of the next slot to create a run for. |
| `state` | `running`, `cancelled` or `done`. |
| `run_ids` | Runs created so far. |
| `ended_at`, `cancelled_by` | |

### Behaviour

- **Order and the one-active-run rule:** runs of one job never overlap, also in a backfill; they queue and run oldest first like any run. So `concurrency` does not run searches in parallel: it is how many of the backfill's runs may wait in the job's queue at once *(my call)*. With the default 1, a normal scheduled run that comes due waits behind at most one backfill run, and the queue cap is never filled by a backfill.
- **Feeding:** each tick, for each `running` backfill, the engine counts its runs that are queued or active; while the job has no queued run that is not from this backfill (regular runs and re-runs go first, since promotion by scheduled time would otherwise always pick the older backfill slot) *(my call)*, that count is below `concurrency` and slots remain, it creates the next run with trigger `backfill`, key `<job>:backfill-<id>:<slot>` (deterministic), the backfill's params, and `backfill: <id>` on the run. If the key exists (a restart after creating it), it moves on. If the queue is full, it stops for this tick and tries again. When every slot has a run and none is queued or active, the backfill is `done` (audit `backfill_done` with counts by final state).
- **Time rules:** a backfill run's scheduled time is the slot, so time ranges cover the slot's window (core spec section 6). Its delay and give-up clocks count from when it leaves the queue, as for other non-cron runs. It has no deadline (section 5).
- **Cancel:** cancels the backfill as a group: no more runs are created, and its queued and active runs are cancelled. It is an engine command (`cancel_backfill`), so creation and cancellation never race. Runs that already finished stay.
- **Disabled job:** a backfill can't start on a disabled job (409 `job_disabled`); a job turned off mid-backfill pauses feeding until it is on again *(my call)*.
- **Hold:** a backfill run that gives up holds the queue like any run (`after_give_up`), and the backfill waits.
- **Permissions:** may run the job (`can_run`). Cancel: the creator, anyone who may edit the job, or an admin.
- **Validation:** `from < to`; range at most 400 days; at least one slot; more than 100 slots is 400 `too_many_slots` "This covers 240 runs; the most is 100. Shorten the range or use a longer step."; `schedule` source needs an enabled cron trigger.
- **Audit:** `backfill_created` (`backfill_id`, `job_id`, `slots`, `from`, `to`, `source`), `backfill_cancelled` (`user`), `backfill_done`.

### REST

| Route | Body / query | Returns |
|---|---|---|
| `POST jobs/<id>/backfills` | `{"from", "to", "source", "step", "params", "concurrency", "dry_run"}`. `from`/`to` are epoch seconds or Splunk relative times (`-30d@d`), resolved as the caller. | 201 `{"backfill": {...}}`; with `dry_run: true`, 200 `{"slots": [...], "count"}` and nothing is stored. |
| `GET backfills` | `job_id`, `state` | `{"backfills": [...]}` without `slots` but with `count`, newest first, visible jobs only. |
| `GET backfills/<id>` | | `{"backfill": {...}, "runs": [{id, state, scheduled_time}]}` |
| `POST backfills/<id>/cancel` | | 202 `{"command_id"}` |

### Command

`| orchestrate backfill job=<id> from=<time> to=<time> [step=<duration>] [concurrency=<n>] [param.<name>=<value>]`: one row with `backfill_id`, `runs` (slot count), `first`, `last`. `step` accepts `30m`, `1h`, `1d`; without it the job's schedule is used. `| orchestrate status backfill=<id>` lists its runs.

### UI

A **Backfill…** button on each Jobs row (for users who may run the job, next to Run now) and in the builder toolbar for a saved job. The dialog: **From** and **To** (date and time pickers in the browser's time zone), **Runs at** (The job's schedule / Every … with a duration field), **Runs in the queue at once** (1–5), the job's parameters as in Run now, and a live summary from `dry_run`: "30 runs, from 1 Oct 01:00 to 30 Oct 01:00." or the server's error. **Start backfill** creates it and links to the Runs page filtered by the job. The Runs page shows each running backfill for the filtered job as a line above the table: "Backfill of 30 runs: 12 finished, 1 running, 17 to go." with **Cancel backfill** (Modal "Cancel this backfill?").

## 7. More notification channels (1.22.0)

Three new webhook presets next to `slack` and `generic`: `teams`, `pagerduty`, `servicenow`. As today, an admin defines destinations (name, `https://` URL, optional headers, body format) and the URL and headers are write-only secrets; builders pick a destination by name.

| Preset | Body | Per-action options (`action.options`) |
|---|---|---|
| `teams` | A message with one Adaptive Card (version 1.4): title "Daily summary failed", facts Job, Run, Step, Status, and an **Open run** action. Works with Teams Workflows webhooks. | none |
| `pagerduty` | Events API v2: `routing_key` (from the destination's secret), `event_action` `trigger`, `dedup_key` = run id (+ `:` step id for step hooks), `payload` `{summary, source: "search_orchestrator", severity, custom_details: {job, run_id, step, status, hook}}`, `links: [{href: run_url, text: "Open run"}]`. For `on_success` and `on_complete` of a succeeded run, `event_action: resolve` with the same `dedup_key` *(my call)*. | `severity`: `critical`, `error` (default), `warning`, `info` |
| `servicenow` | Table API incident: `short_description` ("Search Orchestrator: Daily summary failed"), `description` (the default message with links), `urgency`, `impact`, optional `assignment_group`, `correlation_id` = run id. Basic or bearer auth goes in the destination's headers secret. | `urgency` and `impact` `1`–`3` (default `2`), `assignment_group` (text, at most 100 characters) |

- **Destination secret fields** *(my call)*: a PagerDuty destination also stores a **Routing key** (write-only, in the credential store as `body_secret_ref`, a JSON object merged into the body at send time). The Settings form shows the field only for that format. The URL defaults to `https://events.pagerduty.com/v2/enqueue` for PagerDuty; ServiceNow URLs must end in `/api/now/table/incident`; Teams URLs are any `https://` URL. These checks are in `save_destination`.
- **Action validation:** `preset` is one of the five; a preset's `options` must match its table row; a webhook action with an explicit `body` template ignores `options` (as today).
- **Nodes:** Teams, PagerDuty and ServiceNow are node kinds in the Flow editor (family notify, colour `categoricalA5Strong`, swallowtail flag shape), each with its own icon from `@splunk/react-icons`, label and quick-add keywords ("teams chat", "pagerduty page incident on-call", "servicenow ticket incident snow"). Their properties panel shows the destination picker (filtered to destinations of that format, with "No PagerDuty destinations yet; ask an admin to add one in Settings" when empty) and their options.
- **Audit:** `action_done`/`action_failed` keep `preset` and `host` as today, so Run health counts them per type.

## 8. Approval gate (1.22.0)

### Data

A step of `type: "approval"` with an `approval` object:

| Field | Meaning |
|---|---|
| `message` | Text shown to approvers (optional, at most 500 characters; tokens allowed as in action templates). |
| `approver_roles` | Roles whose members may decide (optional; empty means anyone allowed, see Permissions). |
| `timeout` | Seconds to wait (optional, 300 to 604800). Absent: wait until the run gives up. |
| `on_timeout` | `reject` (default) or `approve`. |

An approval step has no SPL, no `saved_search_ref`, no time range, `retries` 0 and no `max_runtime`; saving with any of those is an error with how to fix it. `delayed_after` and `give_up_after` apply as for any step (the builder warns when `timeout` is longer than the step's give-up time).

### Behaviour

- **New step state `awaiting_approval`** *(my call)*. It counts as activity (the run is not blocked while a step waits) but is not a search: it uses no search slot, is never polled, and cancel and give-up handle it like a waiting step (it becomes `cancelled` or `failed`).
- When an approval step becomes ready, the evaluator sets it `awaiting_approval` with `started_at`, `approval_state: {"requested_at"}`, and fires its step hooks `on_start` and `on_approval_requested`. `on_approval_requested` is a **step-level** hook of approval steps only, so two gates in one job notify separately and each message names its step *(my call)*.
- **Decision:** an approve or reject request becomes an engine command `approve` (`run_id`, `step_id`, `decision`, `comment`, `user`). The engine applies it only if the step is still `awaiting_approval` with no decision; otherwise the command is dropped with audit `approval_ignored` ("already decided by bob"). Approve: the step `succeeded`, `result_count` 0, `first` = `{"decision": "approve", "by", "comment"}` (so `$gate.first.by$` and `$gate.first.comment$` work downstream), hooks `on_success` and `on_complete`. Reject: the step `failed` with error "Rejected by bob: <comment>", no retries, which then follows the edge table (an `on_failure` line handles it; otherwise the run is blocked).
- **Timeout:** at `started_at + timeout` with no decision, the step is decided by `on_timeout` with `by: "timeout"`; reject's error says "No decision within 4 hours". The timeout does not run while the run is paused.
- **Paused runs:** a decision is accepted and recorded while paused and takes effect on resume *(my call)*.
- **Re-run:** re-running from or above an approval step asks again (the step is reset like any step).
- **Previews:** an approval step is never previewed. A preview of a step after it treats it as approved with no comment *(my call)*.
- **Restart safety:** the decision is saved on the run by the command before any hook fires; the evaluator derives the outcome from the stored decision, so a replay never decides twice.

### Permissions

New capability **`orchestrator_approve`**, held by `orchestrator_admin_role`, `admin`, `sc_admin` and a new role `orchestrator_approver_role` (imports `user`; `orchestrator_run` and `orchestrator_approve`). A user may decide when they hold `orchestrator_approve`, may view the run's job, and, if `approver_roles` is set, hold one of those roles. Admins may always decide. The user who started the run may also decide *(my call: small teams; the audit records it)*.

### REST and command

- `POST runs/<id>/approve` `{"step_id", "decision": "approve"|"reject", "comment"}` (comment at most 1000 characters; required for reject *(my call)*). 202 `{"command_id"}`; 409 `not_awaiting_approval` when the step is not waiting; 403 with "You need the orchestrator_approve capability (ask an admin)" or "Only members of ops-leads may approve this step".
- `| orchestrate approve run=<id> step=<id> decision=approve|reject [comment=<text>]`.
- `GET me` adds `can_approve`.

### Audit

`approval_requested` (`run_id`, `step_id`), `approval_decided` (`decision`, `user`, `comment`, `by_timeout`), `approval_ignored`.

### UI

- **Node:** Approval is a node kind in its own family "Approval": an octagon in `categoricalA4Strong` (the gate colour it shares with Condition, whose shape is a diamond) with a hand icon. Its outcomes read **✓ Approved**, **✗ Rejected**, **∞ Decided either way**, **▶ Starts**, **⏱ Is delayed** and **⚑ Asks for approval** (actions only).
- **Properties panel:** Message (SPL-free text with Insert value), Who may approve (role multi-select, empty = "Anyone who may approve runs of this job"), Wait at most (duration, optional), If nobody decides (Reject / Approve).
- **Run page:** a step awaiting approval shows "Waiting for approval since 08:12" (StatusText, the clock icon in `statusColorMedium`) and, for users who may decide, an info `Message` with the step's message and **Approve** and **Reject** buttons. Each opens a Modal ("Approve Sign-off?" / "Reject Sign-off?") with a Comment field (required for reject). Decided steps show "Approved by bob: looks fine" or "Rejected by bob: …".
- **Run graph:** an awaiting step has the waiting styling of the live run graph plus "Waiting for approval"; no spinner.
- **Runs page:** the state column says "Running · waiting for approval" when any step awaits approval, and the filter **Needs attention** includes such runs.

## 9. Reusable sub-flows: snippets (1.23.0)

### Data

`so_snippets` documents, key `sn<12 hex>`: `name` (1–80 characters, unique among snippets, case-insensitive), `description` (at most 500), `owner`, `created_at`, `updated_at`, `node_count`, and `content`: the clipboard format `{"so_clipboard": 1, "steps", "edges", "job_actions", "triggers", "positions"}`, at most 200 KB of JSON and 100 steps.

### Behaviour

- **Save as snippet:** from a selection (the right-click menu, which the Menu key and Shift+F10 also open, or the selection panel). No shortcut: the obvious ones are taken by browsers *(my call)*. The content is made with the existing copy code (`copySelection`), so it holds exactly what Copy would. The dialog asks for a name and description and states "Everyone who can build jobs can see and insert this snippet, including its searches."
- **Insert:** a **Snippets** section in the quick-add box and the Add node menu (matched by name and description). Choosing one pastes its content at the quick-add point with the existing paste code (`pasteResult`): new ids, tokens renamed, nothing connected to existing nodes, the normal checks flag missing parameters or destinations. One undo step. An inserted snippet is a copy; later changes to the snippet don't touch jobs.
- **Manage:** a **Snippets** dialog from the builder toolbar lists snippets (name, owner, nodes, updated); the owner or an admin can **Rename** or **Delete** (Modal "Delete snippet Hourly checks?").
- **Server checks:** shape only (lists and objects of the right types, step ids valid, sizes); the job that receives a snippet is validated when it is saved. SPL in a snippet runs only when a job containing it is saved by someone, as that job's owner.
- **Permissions:** list, read, insert and create: `orchestrator_build` or admin. Rename and delete: the snippet's owner or an admin.
- **Audit:** `snippet_saved` (`snippet_id`, `name`, `created`), `snippet_deleted`.

### REST

`GET snippets` (no `content`), `POST snippets` `{"name", "description", "content"}`, `GET snippets/<id>`, `PUT snippets/<id>` `{"name", "description"}`, `DELETE snippets/<id>`.

## 10. Cost and performance (1.23.0)

### Captured by the engine

When a step's search ends, the job status the engine already reads also gives `runDuration`, `scanCount`, `eventCount`, `resultCount` and `diskUsage`. The engine stores them on the step as `perf: {"run_duration", "scan_count", "event_count", "result_count", "disk_usage"}` and on the attempt row, and adds them to the `step_attempt` audit event. Missing numbers are left out, never zero. Runs before 1.23.0 simply have no `perf`.

### Read on demand

`GET runs/<id>/performance` (may view the run): for the run's step sids, runs two read-only searches **as the caller**, bounded to the run's start minus 1 minute and end plus 5 minutes:

- `index=_introspection sourcetype=splunk_resource_usage component=PerProcess data.search_props.sid IN (<sids>)`: peak and average CPU percent and peak memory (MB) per sid;
- `index=_audit action=search info=completed search_id IN (<quoted sids>)`: `total_run_time`, `scan_count`, `event_count`, `result_count` per sid, used for steps with no `perf`.

Reply `{"steps": {<step_id>: {"run_duration", "scan_count", "event_count", "result_count", "disk_usage", "cpu_peak", "cpu_avg", "mem_peak_mb", "source": "engine"|"audit"}}, "notes": [...]}`. A search the caller may not run, or an index they can't read, adds a note ("CPU and memory need read access to _introspection; ask an admin.") instead of failing. Sids are checked against `^[A-Za-z0-9_.:-]+$` before they go into SPL. At most 50 sids; the searches have a 30 second limit.

### UI

- **Run page:** a **Performance** tab: one row per step with runtime, events scanned, results, disk, peak CPU and peak memory, plus the run's totals; a **Load CPU and memory** button calls the route (it is not called on every poll).
- **Run health:** a **Performance** section: runtime per job over time (line chart, median per day), events scanned per job over time, the 10 slowest steps by median runtime with their run counts, and peak CPU and memory per job from `_introspection` (through the `orchestrator_search_process` macro) joined by sid to `step_attempt` events. All filtered by the dashboard's job input and time range. Viewers need `_introspection` for the CPU and memory panels, as for **Last engine activity** today.

## 11. Cross-job dependency graph (1.21.0)

A **Dependencies** page (nav, after Runs) draws every job the viewer can see and how jobs start each other:

- **Lines** *(my call: built in the browser from the Jobs list, which already holds each visible job's triggers, actions and last run, so no new REST route)*: a completion trigger on job B following A draws A → B labelled "after it succeeds" or "after it finishes"; a `start_job` action in A targeting B draws A → B labelled "start-job action · Fails" (the hook's outcome word, and the step name for step actions). A line to or from a job the viewer can't see ends at a "Job you can't see" node, never showing its id.
- **Nodes:** job name, owner, "Turned off" in muted text when disabled, the last run's state with StatusText (icon and words, no pill) and when it ran. Layout left to right with dagre; node shapes use the Whole job style. Jobs with no lines are listed in a "Not connected" row below the graph.
- **Interaction:** click or Enter on a node selects it and highlights its upstream and downstream jobs; double-click or the panel's **Open job** opens the builder; **Open runs** opens the Runs page filtered by the job. A **List** view shows the same as a table ("Job", "Started by", "Starts") for screen readers and keyboard users. Pan and zoom as in the run graph.
- Refreshes every 30 seconds.

## 12. Calendar (1.21.0)

A **Calendar** page (nav, after Dependencies) with **Day** and **Week** views.

### REST

`GET calendar?from=<epoch>&to=<epoch>[&job_id=<id>]` (any of the three capabilities; visible jobs only). Range at most 8 days *(my call: a week view plus a margin; a month view is out)*. Returns `{"items": [...], "truncated": bool}` where items are:

- `{"kind": "scheduled", "job_id", "job_name", "time"}`: future slots (`time >= now`) of each enabled job's enabled cron triggers in the range, in the job's time zone; at most 300 per job.
- `{"kind": "run", "job_id", "job_name", "run_id", "state", "trigger", "scheduled_time", "started_at", "ended_at", "late": bool, "backfill_id"}`: runs whose scheduled time is in the range.
- `{"kind": "backfill", "job_id", "job_name", "backfill_id", "time"}`: planned slots of running backfills that have no run yet.

At most 2000 items in total, then `truncated: true` and the page says "Showing the first 2,000 items; pick one job to see all."

### UI

- Times in the browser's time zone, said in the page header *(my call)*. Toolbar: **Previous**, **Today**, **Next**, a Day/Week switch, and a Job filter.
- A week view is seven day columns by 24 hour rows; a day view is one wide column. An item is a small button at its time: a run is placed at its scheduled time and, once started, drawn as a bar to its end; it shows its job name and state with the state's icon and text colour on a 3 px left border in the state colour, never a filled background. Scheduled items have a dashed muted border; backfill items say "Backfill". More than three items in the same half hour collapse to "+5 more", which opens a list.
- Click or Enter: a run opens its run page, a scheduled or backfill item opens the job in the builder. Arrow keys move between days in the week view; Tab moves through items in time order.
- Refreshes every 60 seconds while it shows today.

## 13. Releases

| Release | Contents |
|---|---|
| **1.19.0** | Version history and rollback; Test condition. |
| **1.20.0** | Deadlines; Backfill. |
| **1.21.0** | Dependency graph; Calendar. |
| **1.22.0** | Teams, PagerDuty and ServiceNow; Approval gate (with `orchestrator_approve`). |
| **1.23.0** | Snippets; Cost and performance. |

Each release updates `docs/user-guide.md`, `docs/admin-guide.md` (routes, capabilities, collections, settings), the in-app Help, `CHANGELOG.md`, `app.conf` (`version`, `build` + 1, launcher version) and `app.manifest`; builds both packages (`scripts/package.sh <version>` and `scripts/package_variant.sh t1 <version>`) and runs `scripts/appinspect.sh` on both: 0 errors and 0 failures, warnings listed in the release notes.

## 14. Left to the builder

Exact pixel sizes, the calendar's item geometry beyond section 12, the icons picked from `@splunk/react-icons`, the Adaptive Card's wording beyond its title and facts, and test structure, as long as the behaviours above hold.
