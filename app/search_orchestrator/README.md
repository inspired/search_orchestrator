# Search Orchestrator

Version 1.0.0.

Makes dependent Splunk searches run as one unit. A job is a graph of search steps; a step starts only when the steps it depends on have finished. Jobs have schedules, delay alerts, deadlines, retries, ordered queuing, re-run from a step, and actions such as webhooks and email. All logic and state live inside Splunk.

## Supported platforms

- Splunk Enterprise 9.4 and later.
- Splunk Cloud Platform, Victoria Experience.
- **Splunk Cloud Classic Experience is not supported.**
- Search head clusters are unit-tested only.

## After installing

1. On Splunk Cloud, create an event index named `orchestrator` (Enterprise gets it from the app).
2. Give users the `orchestrator_admin_role`, `orchestrator_builder_role` or `orchestrator_user_role` role, or the matching capabilities.
3. In **Search Orchestrator > Settings**, set a fallback notification and clear any health messages.
4. Optional: run `| orchestrate selftest` as an admin to check the install.

## Good to know

- Steps run as the job owner, with the owner's access. Listing roles under "who may run" lets their members start the job with the owner's access.
- Search steps with no time range run over all time.
- Retries and re-runs can write duplicate summary data; keep retries at 0 for steps that write.
- Outside the app, and on Splunk Cloud, search audit events with `index=orchestrator`.
- Splunk Cloud may block outbound webhooks until an admin allows the host.
- Custom page templates are deprecated from Splunk 10.4; migration is planned.

Full documentation: `docs/admin-guide.md` and `docs/user-guide.md` in the project repository, and `CHANGELOG.md`.
