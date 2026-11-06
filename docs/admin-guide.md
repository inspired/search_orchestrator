# Search Orchestrator: admin guide

Version 1.1.0. This guide covers installing, securing and running the app. The [user guide](user-guide.md) covers building and running jobs.

## Supported platforms

| Platform | Status |
|---|---|
| Splunk Enterprise 9.4 and later, standalone search head | Supported. Verified on Splunk Enterprise 10.6.1.1. |
| Splunk Cloud Platform, Victoria Experience | Supported. Checked with AppInspect's Cloud checks only; not run on a real Cloud stack. |
| Splunk Cloud Platform, Classic Experience | **Not supported.** |
| Search head cluster | Designed for it but **unit-tested only**. See [Search head clusters](#search-head-clusters). |

The app needs Python 3 (3.9 to 3.13), which ships with every supported version.

### Custom page templates (Splunk 10.4 and later)

The app's pages use custom Mako page templates so they work on Splunk Enterprise 9.4. Splunk deprecated custom templates in 10.4, and AppInspect warns about them. They still work. A move to Splunk's built-in template is planned before Splunk removes custom templates.

## Install

1. Install `search_orchestrator-1.1.0.tgz` through **Apps > Manage Apps > Install app from file**, or Cloud self-service app install.
2. Restart Splunk if asked.
3. Create the audit index if it doesn't exist (see [Audit index](#audit-index)).
4. Give people roles (see [Roles and capabilities](#roles-and-capabilities)).
5. Open **Search Orchestrator > Settings** and set a fallback notification.
6. Check the health messages on the Settings page are gone.

The engine is a modular input, `orchestrator_engine://main`, enabled by default. It starts on its own; there is no external scheduler.

## Roles and capabilities

| Capability | Allows |
|---|---|
| `orchestrator_admin` | Manage every job, the settings and the webhook destinations. Run the self-test. |
| `orchestrator_build` | Create and edit their own jobs. |
| `orchestrator_run` | Start and control the jobs they may run, and view those runs. |

| Role shipped by the app | Capabilities |
|---|---|
| `orchestrator_admin_role` | admin, build, run |
| `orchestrator_builder_role` | build, run (imports `user`) |
| `orchestrator_user_role` | run (imports `user`) |

`admin` and `sc_admin` also get all three. The builder and user roles import Splunk's `user` role, so either one alone is enough to use Splunk Web. Give users a role by having their role inherit one of these, or add the capabilities to an existing role. The REST handler checks the capabilities on every request; hiding a screen is only a convenience.

**Who sees what.** Admins see everything. Anyone else sees the jobs they own or may run, including those jobs' SPL and run history.

## How steps run (security)

- **Steps run as the job owner.** Each step is a hidden private saved search owned by the job owner (named `_so_<job>_<step>_<hash>`), so it gets exactly the owner's roles and index access, never more.
- **"Who may run" lends the owner's access.** A job can list roles that may start it. Members of those roles (who also hold `orchestrator_run`) start searches that run **as the owner**, with the owner's access. They can only run the SPL the owner saved, and run parameters are type-checked. Every token, including values taken from search results, is substituted as one escaped, quoted SPL string, so it can't inject SPL commands or field names. The builder says this next to the setting.
- **Role names typed into "who may run" are not checked.** The picker offers the builder's own roles and accepts typed names. A typo saves fine and simply matches nobody.
- **An admin who saves someone else's job becomes its owner.** This is audited, and the builder asks first. It stops anyone changing SPL that runs under another person's identity.
- **Job-to-job chaining** (start-job actions and completion triggers) checks that the upstream job's owner may run the target job, and stops after a chain depth of 10.
- **Secrets.** Webhook URLs and headers are kept in Splunk's credential store (`storage/passwords`). The Settings page never shows them again after saving.
- **KV Store.** The `so_*` collections are readable and writable only by `admin` and `sc_admin`. All changes go through the REST handler.
- **TLS.** Outbound webhooks always verify TLS. Calls from the app to its own splunkd over loopback (127.0.0.1) skip verification because splunkd's default certificate is self-signed; any other host is refused.

### Saved-search steps and the `| savedsearch` wrapper

A step that runs an existing saved search is dispatched directly only when the job owner owns it, it is private, and it runs as owner. Its own time range, summary indexing and alert actions then work as configured.

Anything else (a shared search, or one owned by someone else) runs through a hidden `| savedsearch "<name>"` search owned by the job owner, so it runs with the job owner's access. In this mode:

- the saved search's own summary indexing and alert actions **do not run**;
- the step's results are the saved search's results, so tokens and `loadjob` work as normal.

The builder warns about this when the job is saved. If you need summary indexing, put `collect` in the step's SPL instead.

Either way, the saved search must be shared globally or saved in the Search Orchestrator app; steps run in this app's context, so a search private to another app can't be used, and saving the job says so.

The engine checks a directly dispatched search again, with its own session, right before each run: if it is no longer the owner's private search with dispatchAs = owner, the step fails with a clear message instead of running. **Keep the app's default ACL (`[] write : [admin, sc_admin]` in `metadata/default.meta`).** It stops non-admins sharing objects into this app, which is part of what keeps a direct dispatch running as the owner.

### Alert action "Start orchestrator job"

The alert action starts a run with the alert's own session, so the alert's owner must be allowed to run the job. It refuses, and logs a clear error, when:

- the alert is owned by `nobody` (such an alert runs with the system user's session), or
- the session's user is not the alert's owner.

Assign the alert to a real user who may run the job. Errors go to splunkd's alert action log (`index=_internal sourcetype=splunkd component=sendmodalert`).

## Settings page

Only users with `orchestrator_admin` see it.

| Setting | Default | Limits |
|---|---|---|
| Searches at once (all jobs) | 10 | 1 to 100 |
| Searches at once per job | 4 | 1 to 50 |
| Queue cap per job | 20 | 1 to 1000 |
| Keep step results after a run | 24 hours | 1 to 168 hours (7 days) |
| Keep run records | 90 days | 1 to 3650 days |
| Fallback notification | none | an email address or a webhook destination |
| Splunk Web address | empty | an http(s) URL; makes links in messages absolute |

**Health** shows whether the engine is running, whether the audit index exists, whether a fallback is set and how many commands are waiting, with a warning message for each problem.

### Webhook destinations

Admins define each destination once: a name, an `https://` URL, a body format (generic JSON or Slack) and optional headers such as `Authorization`. Job builders pick from the list by name and never see the URL. This keeps secrets out of jobs and stops builders pointing the search head at internal addresses.

The URL and headers are write-only. The page shows only whether each is set. To change a destination, use **Replace** and enter the URL again; leave the headers empty to keep them, or remove them. A destination used as the fallback can't be deleted until the fallback changes.

**Splunk Cloud may block outbound webhooks.** If deliveries fail with connection errors, ask Splunk support to allow the destination host.

### Fallback notification

A delay or failure is never meant to be silent. When a job has no failure or delay action, or that action keeps failing, the engine sends the fallback notification. It carries only job, run and step names, status and links, and doesn't run as the job owner, so it still works when the owner's account is gone. Email uses Splunk's `sendemail`, so Splunk's mail server settings must be configured.

## Audit index

The engine writes every state change as JSON to the `orchestrator` index (sourcetype `orchestrator:audit`): jobs saved, runs and steps changing state, actions, permission denials and ownership changes.

- **Enterprise:** the app ships `indexes.conf` for the index.
- **Splunk Cloud:** create an event index named `orchestrator` yourself (**Settings > Indexes**). The app keeps working without it, because the screens read from KV Store, but audit events are lost and Settings shows a warning.
- Inside the app, search with the `orchestrator_index` macro. The macro isn't shared outside the app, so **outside the app, and on Cloud, search `index=orchestrator` directly.**

Run records are pruned from KV Store after the retention period; audit events stay for the index's own retention.

## Step previews

The job editor can run a step and show its rows. See [Previewing steps](user-guide.md#previewing-steps).

- **Who:** `orchestrator_build` or `orchestrator_admin`, plus the right to edit the job. The REST handler checks this on every request.
- **Runs as the caller.** A preview is an ad-hoc search dispatched as the user, in the Search Orchestrator app namespace (`servicesNS/<user>/search_orchestrator`). It is never run as the job owner or the system user, and it sees only what that user can see. Search job ids start with `so_preview_`.
- **Auto-cancel:** 180 seconds. A running preview that nobody polls, such as after a closed tab, is cancelled. The margin covers browsers that slow timers in background tabs.
- **TTL:** 1800 seconds (30 minutes) once finished. The editor keeps it alive while it uses the preview.
- **Runtime cap:** the smaller of the step's max runtime and 600 seconds.
- **Rows:** the search isn't row-capped, so later previews read all rows. The table shows 100.
- **No actions.** A preview never sends actions. A saved-search step runs through the `| savedsearch` wrapper, so its own alert actions and summary indexing don't run.
- **Audit:** every preview writes `type=preview_dispatched` to `index=orchestrator`, with the job, step and sid.
- **Past runs as input:** a preview reads the run's step results with `loadjob`. They expire after the run's result retention (24 hours by default).

To see current previews:

```
| rest /services/search/jobs splunk_server=local count=0
| search sid="so_preview_*"
| table sid eai:acl.owner ttl
```

## Search head clusters

The engine runs on every member, and a KV Store lease (90 seconds, renewed about every 10 seconds and right before each search dispatch and action send; every engine call to splunkd times out after 15 seconds, so no call outlives the lease) makes sure only one member advances runs at a time. This was tested against a fake KV Store only; no real cluster was available. Watch the first runs after installing on a cluster.

## Deleting jobs

The Jobs page shows **Delete** to users who may edit the job: its owner (with `orchestrator_build`) and admins. It asks for confirmation, naming the job, then deletes the job and its hidden saved searches. A job with active or queued runs can't be deleted until those runs are cancelled; the dialog says so. Past runs stay in the Runs list until run-record retention prunes them.

## Orphaned owners

If a job owner's Splunk account is removed, that job's runs fail with a clear error. To recover, an admin opens the job in the builder and saves it. The admin becomes the owner (the builder asks first, and the change is audited), and the job's searches run as the admin from then on. The admin can then hand the job to someone else by having that person save it, if they hold `orchestrator_admin`, or by rebuilding it under their account.

## Self-test

`| orchestrate selftest` (admin only) checks a build on the server without any screens. It creates and runs small built-in jobs made of `makeresults` searches.

| Command | What it does |
|---|---|
| `\| orchestrate selftest` | Saves and runs job `so_selftest`: serial and parallel steps, tokens, `loadjob`, a skipped step and a retry. |
| `\| orchestrate selftest scenario=rollup_late` | Daily, weekly and monthly rollup with a slow daily, to show waiting, the delay alert and a late start. Optional `slow_n=<number>` (50,000 × slow_n hashes, default 600, about 40 seconds on a test server; at most 100000) and `delayed_after=<seconds>`. |
| `\| orchestrate selftest scenario=rollup_fail` | The same rollup with a daily that fails once, to try re-run from a step. |
| `\| orchestrate selftest scenario=probe` | Checks the server calls the app depends on (search history, job control, KV Store, users, saved searches, index checks, audit writes, the REST endpoint) and returns one row per check with `ok` and `detail`. It never prints secrets. |

Follow a run with `| orchestrate status run="<run id>"`, or on the Runs page.

**What it leaves behind.** The self-test jobs stay after they run, so they can be run again:

- jobs `so_selftest`, `so_selftest_rollup_late` and `so_selftest_rollup_fail` (the probe also saves `so_selftest`), with their runs;
- their hidden saved searches (`_so_so_selftest_...`), private to the admin who ran the test;
- audit events and `collect`ed test events in the `orchestrator` index;
- the probe's scratch documents are written to the `so_selftest` KV Store collection and deleted straight away.

To remove them, use **Delete** on the Jobs page for each `so_selftest*` job. Deleting a job also deletes its hidden saved searches. A job with active or queued runs can't be deleted; cancel those runs first. The REST equivalent is `DELETE /services/orchestrator/jobs/<id>`.

Run records are pruned with the normal retention.

## REST API

All routes are under `/services/orchestrator/` (or `/servicesNS/-/search_orchestrator/orchestrator/`) and return JSON. Each checks the caller's capabilities.

| Route | Methods |
|---|---|
| `jobs`, `jobs/<id>` | GET, POST, PUT, DELETE |
| `jobs/validate` | POST |
| `jobs/<id>/runs` | POST (start a run: `params`, optional `scheduled_time`) |
| `runs`, `runs/<id>` | GET |
| `runs/<id>/pause`, `resume`, `cancel`, `dismiss`, `rerun` | POST |
| `settings` | GET, PUT (admin) |
| `destinations`, `destinations/<name>` | GET, POST, DELETE (admin; builders may list) |
| `health`, `me` | GET |
| `selftest` | POST (admin) |

## Known limits

- Not tested on a real search head cluster or a real Splunk Cloud stack.
- Classic Experience Cloud stacks are not supported.
- Custom page templates are deprecated from Splunk 10.4; migration is planned.
- Node positions in the builder are not saved.
- No per-step workload pool: the dispatch endpoint rejected it.
