# Changelog

## 1.1.0 (2026-11-06)

- **Step preview.** The job editor has a **Preview step** button for every step type. It runs the step, as you and without saving the job, and shows the first 100 rows. Nothing goes in the run history, and previews never run actions.
- A preview works out times and `run when` from **Preview as if scheduled at**, which starts as the last scheduled time. A step a run would skip shows "Would be skipped" and why, with **Preview anyway**.
- Earlier steps' results come from **Live previews** or from **a past run** of the job. A step with no current live preview is previewed first. Changing a step marks its preview and later ones "Out of date". A past run whose step results have expired, or that lacks the step, fails with a readable error.
- Previews are ad-hoc searches run as the caller (`so_preview_` sids). They are cancelled after 60 seconds without polling, kept 30 minutes, and capped at the step's max runtime or 10 minutes. Each one writes a `preview_dispatched` audit event. They need `orchestrator_build` or `orchestrator_admin` and the right to edit the job.
- New step type **From previous steps**: write only the part after the pipe; the step reads the results of every step before it that succeeded, as `| loadjob`, with later ones appended. Skipped and failed inputs add no rows. With none succeeded, the step runs on no rows. The step fails, rather than passing on fewer rows, when an appended input is cut short by Splunk's 50,000-row subsearch limit, with "a subsearch was cut short: " and Splunk's message.
- `| orchestrate selftest` has a new step `merged` that reads two branches and a skipped step.

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
