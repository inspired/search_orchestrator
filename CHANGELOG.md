# Changelog

## 1.0.0 (2026-11-06)

First release.

### Added

- **Jobs:** graphs of search steps with serial and parallel dependencies, inline SPL or saved searches, tokens and `loadjob` between steps, "run when" rules, parameters and edge conditions (on success, on failure, always, expression).
- **Reliability:** delay alerts, give-up deadlines, retries, ordered queuing (runs of a job never overlap), concurrency limits, pause, resume, cancel, dismiss and re-run from a step with a choice of the latest or original definition.
- **Time:** every step's time range resolves against the run's scheduled time; cron in a per-job time zone; missed-run catch-up (all, up to 7; latest; none).
- **Triggers:** cron, manual, REST, `| orchestrate`, the "Start orchestrator job" alert action and completion of another job.
- **Actions:** webhook (generic JSON or Slack), email, event to an index, start another job and any installed alert action, plus a fallback notification so a delay or failure is never silent.
- **Screens:** Jobs, Runs, Run detail (timeline, graph, logs, actions, parameters), a graph-canvas job builder and Settings, in light and dark themes.
- **Security:** steps run as the job owner through hidden private saved searches; three capabilities (`orchestrator_admin`, `orchestrator_build`, `orchestrator_run`) and matching roles; webhook secrets in the credential store.
- **Audit:** every state change to the `orchestrator` index.
- **Self-test:** `| orchestrate selftest` with `basic`, `rollup_late`, `rollup_fail` and `probe` scenarios.

### Hardening in this release

- The alert action refuses to start a job when the alert is owned by `nobody`, or when the session's user is not the alert's owner.
- Screen requests give up after 30 seconds, so a request that never answers can't stall polling.
- `| orchestrate status` without `run=` looks at no more than 20 runs.
- The self-test probe writes its scratch documents to its own `so_selftest` KV Store collection, never next to the engine lease.

### Known limits

- Splunk Cloud Classic Experience is not supported.
- Search head clusters are unit-tested only.
- Custom page templates are deprecated from Splunk 10.4; migration is planned.
- Node positions in the builder are not saved.
- Role names typed into "who may run" are not checked.
- No delete button for jobs; use the REST API.
