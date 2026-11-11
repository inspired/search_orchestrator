# Changelog

## 1.6.0 (unreleased)

- **Runs → Timeline**: every job's past, running and scheduled runs on one axis, over 24 hours or 7 days, with a **Searches at once** row and the Max searches limit, so busy times show before they are scheduled. Scheduled runs are projected from cron schedules (honouring step Run when days) and completion triggers, with lengths estimated from recent runs. Jobs you may not see show anonymously. Very frequent jobs are merged into spans. (`GET schedule?from=&to=`)
- The Triggers tab shows a **busy-times strip** under each schedule, in the job's time zone, and may suggest a quieter start nearby. **Use this time** changes only the minute and hour; nothing changes otherwise. (`POST schedule/preview`)

## 1.5.0 (2026-11-11)

- Run when offers **Days of week**, a row of day buttons with Weekdays, Weekends and Every day shortcuts, in place of the Mondays preset. The step on the canvas reads "Mondays only", "Weekdays only" or "Mon, Wed, Fri only". Steps saved with the Mondays preset, and any cron that only limits the day of the week, open with their days on. The stored value is still a cron, so the server is unchanged.
- A Saved search step can read the previous step's results: tick **Reads the previous step's results**, and the report receives that step's search ID as `$args.so_input$`. The report must read its input with `| loadjob $args.so_input$` with no quotes around the placeholder, have no other placeholders, and follow exactly one step. Saving the job checks the report and warns if the previous step can be skipped or fail.
- After a dispatch timeout, a Saved search step that runs the owner's own search directly finds its job by the run time in the job's search ID. Splunk's history doesn't carry it, so recovery used to fall back to the published time. A job from the search's own schedule is never taken for the step's.
- The Jobs page loads quickly with hundreds of jobs. It shows 50 jobs at a time with **Previous** and **Next**, sorted by name ignoring case, and reads last runs only for the jobs on screen (`GET jobs?limit=&offset=`). If the last runs can't be read, the jobs still show, with Last run as **Unknown** and a warning.
- Search the Jobs page by any part of a job's name, ignoring case (`q`).
- Search the Runs page by job name, replacing the Job dropdown (`GET runs?q=`). Runs of a deleted job are found by its exact job ID. The search looks through at most the newest 5,000 runs when more than 100 jobs match, and says so if it stopped early.
- The Runs page and the job builder no longer read every job's last run just to get job names.
- `so_runs` has KV Store indexes for reading runs newest first.

## 1.4.1 (2026-11-10)

- The engine makes far fewer calls to splunkd, so steps hold their slots for less time and busy periods drain faster. A run is written only when a pass changed it, a hook with no actions stores no row, a new attempt row takes one write instead of two, and renewing the leader lease takes two calls instead of four.

## 1.4.0 (2026-11-09)

- An alert action's parameters are labelled fields with help text, dropdowns and default hints, read from the action's form in Splunk. An empty field uses the action's default, and picking another action clears the parameters. Anything the form doesn't list goes in **Other parameters**.

## 1.3.0 (2026-11-09)

- Alert actions on jobs and steps are picked from a searchable list instead of typed by name. It shows the enabled custom alert actions this app can use. A saved action that is no longer listed stays selected, and the field falls back to typing the name if the list can't be loaded.

## 1.2.1 (2026-11-08)

- The app has an icon: the Splunk UI `NodeStartToEnd` symbol on a Splunk green tile.

## 1.2.0 (2026-11-08)

Job editor canvas.

- A line dragged from a step's handle and dropped on empty canvas adds a **From previous steps** step that depends on that step (on success), and selects it. One undo removes the step and its connection. Dropped on another step, it still adds a dependency.
- Steps are arranged automatically, top to bottom, after every change, and can no longer be dragged. The **Auto layout** button is gone. The view follows the selected step if it lands outside the visible area.

`| orchestrate` hardening, from a logic, performance and resilience test suite.

- `start` refuses a parameter the job doesn't declare, so a mistyped name no longer runs with the default. The REST API does this only when asked (`strict_params`); the alert action and other callers still drop undeclared names.
- `cancel` refuses a run that has already finished (409 `invalid_state`) instead of reporting success and having the engine reject it. This applies to the Cancel button too.
- `scheduled_time` must be a real time: from 0 to the end of year 9999. `inf` was a server error and `1e300` was stored.
- An option given twice, an empty option value (such as an unset dashboard token in `status run=""`) and a `/` in `job` or `run` are errors.
- `status` skips a run removed by retention while it was listing, instead of losing every row. It stops fetching runs after 120 seconds and warns how many it returned.
- An unexpected reply from the server is a readable error, not a raw `KeyError`.
- The command tells Splunk not to run it for search previews.
- `jobs` no longer reads each job's last and next run (`GET jobs?brief=1`).
- The probe sleeps at most 40 seconds in all, so it ends inside the command's 60-second call on a slow server.
- The per-job queue cap holds when two starts race: a run that finds the queue over its cap after inserting removes itself and reports `queue_full`.

## 1.1.1 (2026-11-06)

Step preview follow-ups.

- `| orchestrate selftest` says when its new run is queued behind another run of the same self-test job (an active one, or a queued one that goes first), names that run and its state, and says how to cancel it (`queued_behind`, `queued_behind_state`).
- A preview with a past run as input tells results Splunk won't show you (403 `run_results_forbidden`: "you may not read <step>'s results from that run; only its owner or an admin can") apart from expired ones (410 `run_results_expired`).
- A dependency cycle or a malformed job still blocks every preview, now with a message that names it: "the job has a cycle: a → b → a; fix it before previewing".
- Jobs saved before 1.1.0 with a From previous steps step keep that step's old time range until they are re-saved: its hidden saved search still holds it. Validation now warns about such a step (`previous_old_time_range`, "re-save the job to drop this step's old time range"), in the editor and under the job's name on the Jobs page. The engine no longer sends a time range override for the step.
- A malformed preview sid is a 404 everywhere, never a server error.
- **Input from** greys out runs that ended longer ago than the result retention, marked "(results expired)". `POST preview/defaults` now also returns `result_retention`.
- The input line names every earlier step the preview read, through a connection or a token, as the server resolved it (a step a run would skip shows "skipped", even after Preview anyway), and its "2 min ago" updates each minute. `POST preview` returns the list as `input`.
- **Cancel** on a preview also cancels the running previews of earlier steps it started, but never one another preview is waiting on.
- The preview time field keeps `9:05` as typed and shows `09:05` when you leave it.
- The editor flags a From previous steps search that doesn't start with `|` and a From previous steps step with no dependency, with the server's messages, before you save.
- Preview searches stay unlabelled in the Job Inspector: Splunk's search job API has no label parameter. The sid names the job and step.
- Internal: the preview routes moved from `api.py` to `preview_api.py`; one job id pattern (`model.JOB_ID_RE`) serves the API, preview sids and the alert action.

## 1.1.0 (2026-11-06)

- **Step preview.** The job editor has a **Preview step** button for every step type. It runs the step, as you and without saving the job, and shows the first 100 rows. Nothing goes in the run history, and previews never run actions.
- A preview works out times and `run when` from **Preview as if scheduled at**, which starts as the last scheduled time. A step a run would skip shows "Would be skipped" and why, with **Preview anyway**; the server decides every earlier step again, so steps after a skipped one read it as skipped even when it was previewed anyway.
- Earlier steps' results come from **Live previews** or from **a past run** of the job. A step with no current live preview is previewed first. Changing a step marks its preview and later ones "Out of date". A failed earlier step follows the run rules: an `on_success` connection stops with "... failed, so a run would not reach this step", an `on_failure` or `always` connection previews. A past run whose step results have expired, or that lacks the step, fails with a readable error. The run list (the 20 most recent) is refreshed on save and when opened. Previews made before the first save are out of date after it. A preview whose search job is gone shows as expired.
- Previews are ad-hoc searches run as the caller (`so_preview_` sids). They are cancelled after 180 seconds without polling, kept 30 minutes, and capped at the step's max runtime or 10 minutes. Each one writes a `preview_dispatched` audit event. They need `orchestrator_build` or `orchestrator_admin` and the right to edit the job.
- New step type **From previous steps**: write only the part after the pipe; it has no time range (switching to it drops Earliest and Latest, and saving strips them); the step reads the results of every step before it that succeeded, as `| loadjob`, with later ones appended. Skipped and failed inputs add no rows. With none succeeded, the step runs on no rows. The step fails, rather than passing on fewer rows, when an appended input is cut short by Splunk's 50,000-row subsearch limit, with "a subsearch was cut short: " and Splunk's message.
- `| orchestrate selftest` has a new step `merged` that reads two branches and a skipped step, and a step `merged_check` that fails the run unless `merged` gave exactly one row.

## 1.0.5 (2026-11-06)

- Pages follow the user's Splunk theme preference (Dark or Light) by reading it directly. Before, the pages asked Splunk's theme API, which answered "light" on Splunk 10.6 even for a user set to Dark. A "System" preference follows the browser.

## 1.0.4 (2026-11-06)

- The late-rollup self-test's slow daily now really runs about 40 seconds: Splunk's optimizer removed the hashing in 1.0.3 because nothing read its result.
- `| orchestrate` errors whose text contains `{` or `}` (such as a JSON error body from splunkd) showed a `KeyError` from splunklib instead of the error.

## 1.0.3 (2026-11-06)

- The late-rollup self-test's slow daily hashes `slow_n` values on each of 50,000 rows (default 600, about 40 seconds). The earlier forms were capped by `makeresults` and `mvexpand` limits and finished in about a second. `slow_n` is capped at 100000.

## 1.0.2 (2026-11-06)

Fixes from the first check on a real Splunk server (Enterprise 10.6.1.1).

- A search that finishes with an ERROR message, such as a missing lookup, now fails its step. Splunk reports these as done and not failed, so before this fix the step counted as a success and later steps built on incomplete results.
- Audit events from the REST API (saves, ownership changes, denied requests, commands) were lost because of a wrong endpoint path. They now reach the `orchestrator` index.
- The self-test probe's search check used a wrong endpoint; it now runs.
- Audit events no longer carry empty fields as the text "null", and "action submitted" is audited only for hooks that have actions.
- `slow_n` for the late-rollup self-test now multiplies 50,000 rows (Splunk caps `makeresults` at 50,000); the default is 40.

## 1.0.1 (2026-11-06)

Fixes from the final review.

### Security

- Every `$run.*$` and `$<step>.*$` token is substituted as one quoted, escaped SPL string. A token outside double quotes gets the quotes added, so a parameter or a `first.<field>` value can't inject SPL commands or field names.
- A job can't be created with the id of a deleted job whose runs are still retained (`job_id_in_use`). Runs of a deleted job are visible only to their owner, the run's "who may run" roles and admins.
- A directly dispatched saved search is checked again right before each run; if it is no longer the owner's private search with dispatchAs = owner, the step fails instead of running.

### Fixed

- Search head clusters: the engine lease is 90 seconds, every engine call times out after 15 seconds, and the lease is renewed right before each dispatch and action send. A member that lost the lease dispatches nothing.
- The Runs screen asks KV Store for only the runs it shows, newest first, without their definition snapshots.
- Saved-search steps are looked up across apps. A search not visible from this app says it must be shared globally or saved in the Search Orchestrator app.
- Action messages fill in `$run.*$` and `$<step>.*$` tokens (with `|default`) as well as `{{...}}` names.
- Failed-search links in messages open the search page (`/app/search/search?sid=`).
- While runs are held, queue-cap rejections fold into the daily hold alert.
- A cancel or a permission check that keeps failing no longer stalls a run: after 5 minutes it is audited and the run proceeds.
- In direct mode, a crash-recovered step adopts only a search dispatched for its scheduled time.
- The enable switch keeps the job's owner (`POST /orchestrator/jobs/<id>/enabled`).
- Two start-job actions to the same job start two runs.
- The Jobs screen's next-run walk is capped; a slot over 400 days away shows a dash.
- Saving a job warns about a step with no time range and refuses `| orchestrate` in step SPL.
- `scripts/package.sh` builds the UI and refuses to package without it.
- The app ships its LICENSE (Apache-2.0), and the builder and user roles import `user`.

## 1.0.0 (2026-11-06)

First release.

### Added

- **Jobs:** graphs of search steps with serial and parallel dependencies, inline SPL or saved searches, tokens and `loadjob` between steps, "run when" rules, parameters and edge conditions (on success, on failure, always, expression).
- **Reliability:** delay alerts, give-up deadlines, retries, ordered queuing (runs of a job never overlap), concurrency limits, pause, resume, cancel, dismiss and re-run from a step with a choice of the latest or original definition.
- **Time:** every step's time range resolves against the run's scheduled time; cron in a per-job time zone; missed-run catch-up (all, up to 7; latest; none).
- **Triggers:** cron, manual, REST, `| orchestrate`, the "Start orchestrator job" alert action and completion of another job.
- **Actions:** webhook (generic JSON or Slack), email, event to an index, start another job and any installed alert action, plus a fallback notification so a delay or failure is never silent.
- **Screens:** Jobs (with Run now, enable switch and Delete), Runs, Run detail (timeline, graph, logs, actions, parameters), a graph-canvas job builder and Settings, in light and dark themes.
- **Security:** steps run as the job owner through hidden private saved searches; three capabilities (`orchestrator_admin`, `orchestrator_build`, `orchestrator_run`) and matching roles; webhook secrets in the credential store.
- **Audit:** every state change to the `orchestrator` index.
- **Self-test:** `| orchestrate selftest` with `basic`, `rollup_late`, `rollup_fail` and `probe` scenarios.

### Hardening in this release

- The alert action refuses to start a job when the alert is owned by `nobody`, or when the session's user is not the alert's owner.
- Screen requests give up after 30 seconds, so a request that never answers can't stall polling.
- `| orchestrate status` without `run=` looks at no more than 20 runs.
- The self-test probe writes its scratch documents to its own `so_selftest` KV Store collection, never next to the engine lease.
- The `so_*` KV Store collections are readable and writable by `sc_admin` as well as `admin`, for Splunk Cloud.

### Known limits

- Splunk Cloud Classic Experience is not supported.
- Search head clusters are unit-tested only.
- Custom page templates are deprecated from Splunk 10.4; migration is planned.
- Node positions in the builder are not saved.
- Role names typed into "who may run" are not checked.
