# Changelog

## 1.44.1 (2026-11-20)

- **Open in search opens the whole search:** the dashboard framework hands a panel's action only the data sources that panel uses (its chain search), so Open in search opened just `| fields … | rename …`. It now gets the dashboard's own data sources and opens the base search and the chain together. It is a plain icon button, without the external-link icon a link button added.
- **Problems keep the whole error:** Splunk's key=value extraction stopped `error="…"` at the first escaped quote inside it (`command=\"sendemail\"`), so problems read "action search failed: command=\". The problems search now takes the whole quoted value with `rex` and unescapes it.

## 1.44.0 (2026-11-20)

- **Troubleshooting graphs are a Dashboard Studio dashboard:** Splunk's own dashboard framework (`@splunk/dashboard-core` 29.9.0, pinned) draws them from a definition: the page's timechart as the base search (`ds.search`, run by Splunk from the browser) and a chain search (`ds.chain`) per graph. Each panel has the framework's hover action bar with **Open in search**, which, as in Dashboard Studio, opens the panel's base and chain search together. The framework leaves that action to the app (Dashboard Studio ships its own), so the app supplies it. Only the grid layout, the two search types and the Column and Line charts are loaded. With **Live**, the graphs rerun every 10 seconds.
- The emulated magnifying glass is gone; the lists (slowest routes, Splunk calls, events) have an **Open in Search** link again.
- The `@splunk/visualizations` family is pinned to 28.9.1 throughout (`overrides`), so nested packages no longer pull in 28.10.0.
- The Troubleshooting page script grows from about 8.5 MB to about 17 MB with the dashboard framework.

## 1.43.0 (2026-11-20)

- **Problems are built in SPL:** the Troubleshooting **Problems** table is the result of its search (`stats` by signature, with the ids and numbers taken out by `replace`), so **Open this search in Search** shows the same table: times, level, problem, area, jobs, runs, last and first seen. The page only adds job names, how long ago, and why and what to do. Every matching line in the range is counted, not just the newest 2000; the 200 most serious problems are shown.
- **Beta building blocks:** Approval, Webhook, Slack, Microsoft Teams, PagerDuty and ServiceNow carry a **Beta** tag (still in development, may not work yet) in Settings > Building blocks and the builder's add menu.

## 1.42.0 (2026-11-20)

- **Building blocks in Settings:** an admin can turn off any node kind except Search and Schedule (Approval, Saved search, Summary index, Lookup, After another job, and each action: Email, Webhook, Slack, Teams, PagerDuty, ServiceNow, Event, Alert action, Start another job). A kind that is off is not offered in the Flow or Simple editors, examples that use it can't be added, and a save that adds it is refused (`block_turned_off`). Jobs that already use it keep working and can still be saved. New setting `turned_off`, shown to every user in `/me`; new module `so/blocks.py`.
- **Export one job:** **Export** in a job's ⋯ menu downloads just that job (`search_orchestrator_job_<id>_<date>.json`), importable with Import jobs.
- **Open a graph in Search:** each Troubleshooting graph has Splunk's magnifying glass at its top right, as on a Dashboard Studio panel. It opens the graph's search in a new tab, and graphs over time open as the same chart with the same series and colours. The hint explains the low, steady heartbeat bars on the Activity graph.

## 1.41.0 (2026-11-20)

- **One palette on Troubleshooting:** the graphs, the single values and the **Level** column use the same colours for the same level (red errors, orange warnings, blue info, green OK, grey detail), with separate steps for dark and light mode checked for contrast and colour-blind separation. Every single value is coloured by its state with its icon (green when fine), and the Level column colours Info and OK too, with an icon for Info. The whole page now uses the graphs' own background, black in dark mode and white in light mode, for the tables and tiles too.

## 1.40.0 (2026-11-20)

- **Full control of what is written:** a **Summary index** step sets source, sourcetype, host, the fields to write and the timestamp (each result's own, the run's scheduled time, or when it writes); a **Lookup** step sets the fields (columns) to write; an **Event** action sets source, sourcetype, host and timestamp (now or the run's scheduled time). The generated search shows each choice. View output follows a custom source and sourcetype. A sourcetype other than `stash` is flagged as counting against the license.

## 1.39.0 (2026-11-20)

- **No more "Whole job" node:** actions for the whole job (it fails, succeeds, finishes, starts, a step is delayed, it misses its deadline) are on a new **Job actions** tab next to Flow, each with When, its fields and retries. The canvas holds only triggers, steps, conditions and the steps' own actions; a step action's When lists steps only. The setup checklist and issue links for job actions open the tab. Saved jobs are unchanged (still `job.actions`).
- **Preview explained:** the preview bar says what Preview step does and what "as if scheduled at" and "Input from" are for, with Learn more.
- **Help examples fixed:** examples that were run together as one search (the three kinds of condition, the two write nodes, the `| orchestrate` commands) are separate rows now, and the parameters example counts errors before comparing them.

## 1.38.0 (2026-11-20)

- **Troubleshooting graphs are Splunk's own charts:** the activity, request, engine and response-time graphs use `@splunk/visualizations` Column and Line (as Dashboard Studio), with Splunk's axes, legend, tooltips and severity colours. Filtering by level moves to **Show the errors** and **Show the warnings** under the activity graph. The library is pinned (28.9.1) and loaded only on the Troubleshooting page.

## 1.37.3 (2026-11-19)

- **Jobs page says when it is filtered:** the Show and Tag choices are remembered in the browser, so a filter from an earlier visit could hide jobs and look like they were gone. While anything hides jobs, a line says "Showing 3 of 12 jobs: tagged billing" with **Show all jobs**.

## 1.37.2 (2026-11-19)

- **Action rows are pruned:** run-record retention now removes a run's `so_action_runs` rows with the run; they were never pruned before and grew without end.
- Deleting a job is unchanged: it removes the job, its hidden searches, saved versions and follows, and cancels a running backfill, so nothing runs again; its runs stay in the run list until retention prunes them.

## 1.37.1 (2026-11-19)

- **Calendar navigation:** the buttons say what they move ("‹ Previous week", "Next month ›"), the range shown sits beside them, **Go to date** jumps to any day, and `←`, `→` and `T` (today) work from the keyboard.

- **View output of an Event action** no longer searches the whole index: it shows only the events that action wrote (its search is the events' `source`), and from a run only that run's events. Event actions now mark each event `so_run=<run id>` (re-save a job to pick it up; older events are matched by the run id in the event). The table shows the time and the event's own fields (JSON spread out) instead of Splunk's internal `_bkt`, `_cd`, `_si` and the like; summary index views too.

## 1.37.0 (2026-11-19)

- **Tags:** up to 10 per job (builder Settings tab, with the tags other jobs use offered). The Jobs, Runs and Calendar pages filter by tag; Find jobs searches tags; a job's tags show under its name and filter on click.
- **Follow a job** (Jobs ⋯ menu): be told when a job fails, is late, is delayed or succeeds, by email to your own Splunk address or (builders) a webhook destination, without editing the job. A bell marks followed jobs. Checked at send time; new collection `so_follows`, routes `GET/PUT/DELETE jobs/<id>/follow`, audit `job_followed` and `job_unfollowed`.
- **Compare two runs:** a Compare tab on the run page puts a run next to another run of the job (by default the newest finished one before it): per step the state, run time, results and events scanned, and what changed in words; parameters and job changes too.
- **Events scanned limit:** Settings > Search cost sets a limit and whether going over warns (audit `step_scan_limit`, a note on the step) or stops the search (the step fails); a step can set its own.
- **Schedule preview:** the next 3 or 10 times, each with the other jobs that start in the same minute (`schedule/next` takes `count` up to 10 and `clashes`).
- **Action retries:** each action can set its retries (0 to 10) and first wait (10 s to 1 h, doubling); the panel spells out the waits.
- **Examples:** 18 (7 new: summary index, business hours, search condition, deadline, approval, patient retries, start two jobs), in tabs by group, each drawn as its flow. Add one, or Open in builder, and the examples it starts or follows are added first, so no Start job or After another job link points at a missing job. Every example is tagged `example` and its group.
- **Help page in tabs** (Get started, Build jobs, Follow runs, Troubleshoot, How it works, Reference), with the contents of every tab beside it; Learn more links open the right tab. Long paragraphs are now lists; Troubleshooting is its own section; audit events are a table; How it works has tabs for the parts, the life of a run and the module table (file names no longer break mid-word). New sections: The Jobs page, Tags, Follow a job, The Runs page, Compare two runs, App health alerts.

## 1.36.0 (2026-11-19)

- **Jobs page:**
  - **Next run** also says how soon ("in 6 min").
  - **Duration:** the last run's time (or "so far") against the usual time (median of the recent succeeded runs, at least 3); marked with a warning icon when it took at least twice as long and 30 s more ("3.6× the usual 55s").
  - **Job warnings** with an icon under the name, and **Show: Has warnings**: a Start job action to a job that doesn't exist (or you can't see) or is disabled, and an After another job trigger that follows a missing job. The builder shows them on save too. Codes `missing_target_job`, `disabled_target_job`, `missing_upstream_job`.
  - **Export** the jobs shown to one file (`search_orchestrator_jobs_<date>.json`); **Import jobs** saves every job in such a file at once, keeping ids, skipping ids already taken (nothing is replaced) and turning the jobs off by default. One job still opens in the builder.
- **Runs page, many runs at once:** tick runs (or a job's row, or all) for **Cancel**, **Re-run** (from each run's first failed step, with its original definition), **Approve** and **Reject** (comment required). A dialog lists the runs first; a message names any run that couldn't be changed and why. New route `POST runs/bulk` and audit event `bulk_run_action`.
- **App health alerts**, shipped **off**: *Engine not running* (no heartbeat for 15 minutes), *Missed schedules* and *Errors*, each a tracked Splunk alert over the app's own log lines. Turn them on from Settings > Health or Splunk's alert list; add an email there to be told. The engine now logs a `heartbeat` every 5 minutes (ticks, slowest tick, active runs).
- **Fix:** since 1.35.0 a save from the builder could store the Jobs screen's `recent_runs` and `warnings` in the job. They (and the other screen fields) are now dropped on save and left out of version history.
- Help: the guide, illustrations and How it works cover all of the above.

## 1.35.2 (2026-11-19)

- **Help brought up to date:** How it works describes the Troubleshooting page and routes, the engine logging why a job did not start (skipped and missed schedules, queue and search-slot waits) and the log file's sourcetype and warning levels; the life of a run ends with "anything that did not start says why". The Troubleshooting illustration shows the health values and the new lines; Follow runs shows the Jobs page's run icons.

## 1.35.1 (2026-11-19)

- **Jobs, Last runs:** the last run's state and date sit on one line, and the run icons and "N of the last 10 failed" start at the same left edge as the text above.

## 1.35.0 (2026-11-19)

- **Jobs page:**
  - **Last runs:** the last run and the 10 newest runs as status icons (oldest left; colour only on failed and delayed), each linking to its run, with "N of the last 10 failed".
  - **Calmer actions:** Run now stays a button; Edit, Backfill… and Delete… move to a ⋯ menu.
  - **Show** (all, last run failed, disabled, scheduled, my jobs) and **Sort by** (name, next run, last run, failed first), remembered in this browser.
- `GET jobs` adds `recent_runs` (the 10 newest runs, from the same KV Store query as `last_run`).

## 1.34.5 (2026-11-19)

- **No striped rows:** in Splunk's dark theme every other table row came out reddish-brown, which read as an error. All tables are plain now.
- **Jobs:** a job's name and its summary (schedule and steps) are on two lines instead of running together.

## 1.34.4 (2026-11-19)

- **Navigation icons:** Dependencies, Calendar and Troubleshooting showed a letter in a grey circle: Splunk's app bar only draws a fixed set of icon names, and `nodeconnection` and `calendar` are not in it. They now use `nodetopology`, `chartgantt` and `filemagnifier`; a test checks every view's icon against Splunk's list.

## 1.34.3 (2026-11-19)

- **Troubleshooting uses the job editor's words:** a missed schedule names the job's **Missed runs** setting and its option ("Run only the latest missed time"), not "catch-up", and says where to change it. `schedule_missed` and `schedule_skipped` were checked on a live instance (Splunk stopped for 11 minutes: 4 missed, 7 caught up; a disabled job: one line per minute).

## 1.34.2 (2026-11-19)

- **Clean engine stop:** after ending the event stream the engine points stdout at /dev/null, so Python's own flush at exit no longer reports the pipe splunkd closed ("Exception ignored on flushing sys.stdout: BrokenPipeError", an ERROR in splunkd.log on every restart). Checked by restarting a live instance.

## 1.34.1 (2026-11-19)

Found by restarting a live instance:

- **No more false ERRORs in splunkd.log:** splunkd records everything the engine writes to stderr as ERROR, so "engine starting" and "engine stopped" (41 in a week) now go to the app's log only; a lease that cannot be handed back while splunkd stops is logged there at INFO (`lease_not_released`).
- **No BrokenPipeError traceback on every restart:** the engine ends its event stream itself and ignores a pipe splunkd already closed (39 tracebacks in a week).
- **Quiet start:** while KV Store is starting the engine says so once (`waiting_for_kvstore`) instead of warning every 5 seconds; any other reason a tick is skipped warns once, and `ticks_resumed` says how many ticks were skipped and for how long.

## 1.34.0 (2026-11-19)

- **Why a job did not start is always logged.** Before, a schedule could be skipped without a word.
  - New audit events: `schedule_skipped` (a disabled job's scheduled time passed) and `schedule_missed` (scheduled times passed while the engine was stopped or on standby and the catch-up setting left them out: how many, for how long, the policy and how many were caught up; a warning).
  - New log lines, once until the reason changes: `run_waiting` (held by a failed run, waiting for the run before it, or behind other queued runs), `step_waiting` (search limits full, with the numbers) and `completion_not_fired` (a downstream job disabled, or the run ended the wrong way for its trigger).
- **Troubleshooting:** a **Skipped schedules** value (disabled · missed) that filters to those lines; each new event in plain words with why and what to do (Backfill runs missed times). The `event` filter takes up to 10 events separated by commas.

## 1.33.2 (2026-11-19)

Found by testing against a live instance:

- **Failures are warnings:** audit events that report a failure (failed or retried actions, failed steps and runs, searches that could not start, failed conditions, rejected runs and commands, delayed and late runs, held runs, denied permissions) are logged at WARNING instead of INFO, so the Warnings count, the level filter and Problems find them. Problems also finds those events in lines logged at INFO by 1.32–1.33.1. The audit copies stay out of `splunkd.log`.
- **Troubleshooting wording:** an email that cannot reach a mail server (`sendemail … Connection refused`) now points at Splunk's email settings instead of a host name; actions queued "when it asks for approval"; an applied approval reads "Engine applied admin's approval decision for step …".

## 1.33.1 (2026-11-19)

- **Troubleshooting follows Splunk's design:** the health tiles are a row of single values (no cards, stripes or sparklines; colour and an icon only on a value that needs attention); the lines, problems and run story are Splunk tables with expandable rows; why and what to do is a Splunk message; filter chips are Splunk chips; graphs use neutral grey with colour kept for warnings and errors.

## 1.33.0 (2026-11-19)

- **Troubleshooting, rebuilt:**
  - Health tiles (engine, errors, warnings, failed requests, response time, failed actions, failed runs), each with a trend and a click-to-filter.
  - Graphs to switch between: activity by level, requests and response time with the slowest routes, engine tick time and active runs, the slowest splunkd calls and the most frequent events.
  - **What happened:** every line in plain words (each audit event, request and engine line), with job, run and step names, who did it, the result and the meaning of the status. Known failures say why and what to do. Details show every field, the traceback and the raw line.
  - **Problems:** errors grouped by cause with counts, first and last seen, the jobs and runs affected.
  - **Run story:** one run from created to finished, with the waits explained.
  - Filters in the address, chips to remove them, a job picker by name and **Live** refresh.
- New routes `GET logs/summary`, `GET logs/breakdown` and `GET logs/problems`; `GET logs` adds parsed `fields`, `message`, `traceback`, `names`, and the `event` and `sort` filters.

## 1.32.1 (2026-11-19)

- **Log sourcetype:** the app's log files get the sourcetype `orchestrator:log` (`orchestrator:log_<suffix>` in the side-by-side copy) instead of the per-file `…-too_small` sourcetype Splunk guessed, with one event per line, a Python traceback kept with its line and the timestamp read from the line.
- **How it works** drawing redone to fit the help column without sideways scrolling: parts grouped in areas (the browser, what runs when you use the app, the engine on its own, the gateway to storage and Splunk) with only the 7 hand-offs drawn as arrows; clicking a part lights up the parts it talks to instead of drawing every line. The life of a run and the module table fit the column too.

## 1.32.0 (2026-11-19)

- **Troubleshooting logs:** the engine and the REST handler (every screen, the alert action and `| orchestrate`) write their own `key=value` log files, `search_orchestrator.<process>.log` in `$SPLUNK_HOME/var/log/splunk`, indexed into `_internal`. Every audit event, request (method, path, user, status, ms), engine start, stop and lease change, error (with traceback) and, at debug level, each tick, search status check and splunkd call. No secrets, bodies or search results. New `orchestrator_logs` macro.
- **Log level** in Settings (`log_level`: ERROR, WARNING, INFO, DEBUG; default INFO), applied within 30 seconds without a restart.
- **Troubleshooting page** in the navigation bar: the app's log lines with quick views (errors and warnings, the engine, screens and API), filters for run, job, step, level, part, text and time, the full line on click and Open in Search. **App logs for this run** on the run page and **App logs** in a step's details open it filtered. `GET logs` searches the lines as the caller.
- **How it works** on the help page: a clickable drawing of every part of the app (pages, REST handler, alert action, search command, engine, API modules, scheduler, evaluator, actions, gateway, KV Store, hidden saved searches, secrets, indexes) and the calls between them, the life of a run as a sequence diagram, and a table of every Python module.

## 1.31.2 (2026-11-19)

Fixes from a code review of 1.29.1–1.31.1:

- **Needs attention** also lists running and paused runs with a step waiting for approval, so the approval banner's "and N more" link finds them.
- **Timeline:** a step waiting for approval is a hatched waiting bar from when it asked, not a red failed bar. Near the right edge a narrow bar's time goes on its left instead of spilling unreadably out of it.
- **Approval banner** also shows approvals in paused runs (a decision applies on resume), skips its 30-second check while the tab is hidden and checks at once when it is shown again.
- **Run #N** comes from the server (`number` in `GET runs`): counted over all the job's runs, so a run has the same number in every filter and past the 200-run list limit.
- **Performance tab:** a role without read access to `_introspection` is told to ask an admin instead of being told samples are missing (Splunk returns no rows, not an error, so the route counts `_introspection` events to tell the two apart). The searches listed for Open in Search are only those that ran, with runnable SPL from the server. Live runtimes use the run page's clock, so they match the timeline.

## 1.31.1 (2026-11-18)

- **Performance tab:** when Splunk has no CPU or memory samples for a run's searches, a note says why (samples are taken about every 10 seconds, and none while resource usage introspection is off) instead of leaving the columns blank without a word. Checked against a live instance: the engine's stored numbers match `_audit` (run time, events scanned, events, results), the `_audit` search finds step searches by their quoted search id, and the `_introspection` field names are right.

## 1.31.0 (2026-11-18)

- **Performance tab:** a running step's runtime counts up live ("1m 15s (running)"); each step with a search has **Open in Search**; after **Load CPU and memory** the CPU and memory and audit searches can be opened in Search too (`GET runs/<id>/performance` adds `searches`); the button counts seconds while it searches and can load again.
- **Runs:** a job's runs, opened under its row, are numbered (**Run #12**, oldest is #1) with a marked left edge.

## 1.30.1 (2026-11-18)

- **Fixed:** the run page's **Performance** tab always said "Splunk could not run a search for CPU, memory or audit numbers": its searches (`index=_introspection …`, `index=_audit …`) went to search/jobs without the leading `search` command, which Splunk refuses. Every one-shot search now gets it (`gateway.oneshot_search`), and the note now includes Splunk's error.
- **Runs:** a job's runs, opened under its row, are marked with an indented line instead of a └ character.

## 1.30.0 (2026-11-18)

- **Runs grouped by job:** one row per job (latest run, runs per state, **⚑ N waiting for approval**) that opens to all its runs, with **Only this job**; **Show: All runs** keeps the flat list (remembered in this browser).
- **Approvals stand out:** a banner on every app page while any step waits for approval, with the job, step, message, how long it has waited and **Review**, which opens the run page with that step's drawer (`run?run_id=…&step=…`).

## 1.29.1 (2026-11-18)

- **Run timeline:** each step's bar shows the time it took beside it (so far, while it runs).

## 1.29.0 (2026-11-18)

- **Why it waits:** a queued run shows why under its status on the Runs page and the run page, with a link to the run in the way: another run of the job is active, other queued runs go first, a held run blocks the job, or the engine isn't running (a red banner on the run page too). A waiting step's details say which steps it waits for, or which search limit in Settings is full. `GET runs` adds `queue_reason` to queued runs and `engine` (`running`, `last_seen`, from the engine lease); `GET runs/<id>` adds `queue_reason`, `step_reasons` and `engine`.

## 1.28.1 (2026-11-18)

- **Fixed:** in the Simple view, clicking a choice under **When this search…** closed the picker and did nothing. **+ Add…** now has two steps: pick when, then what (with **‹ Back**), and it stays open until you pick what.

## 1.28.0 (2026-11-18)

- **Simple view:** **+ Add…** under a search picks when (**Succeeds**, **If a condition is true**, **Fails**, **Finishes either way**, **Starts**, **Is delayed**, as in Flow) and then what happens; items are grouped under a heading per choice. A condition item has a **Condition** field; a save on a condition uses Run when, a message uses the new action condition.
- **Actions:** an action may have `condition`, a simple comparison over tokens as on an If… line; it is left out of the hook's firing when the comparison doesn't hold, and checked on save. Flow's action panel has **Only when** for step actions on success.

## 1.27.2 (2026-11-18)

- **Simple view:** each search has **If it succeeds** and **If it fails** lists; **+ If it fails…** adds an email, Slack or Teams post, page, incident or event for when that search fails (a step action on failure). The job-wide band is now **If any step fails**.
- **Fixed:** a trigger's lines can be selected (click, or Tab and Enter), removed with **Remove line** in the side panel or the line menu, or with `Delete`. `Delete` also removes a selected step or condition line.

## 1.27.1 (2026-11-18)

- **Simple view:** each **Then** row has **Settings** with every field of that item: an email's subject and message (with tokens), a webhook's destination and preset options, an event's payload, a summary index's source and run id marker, a lookup's append, and **View output**.

## 1.27.0 (2026-11-18)

- **Simple view:** the Flow tab has a **Simple / Flow** switch (remembered in this browser; Simple by default for jobs it can edit). Simple lists the searches top to bottom, each starting when the one above succeeds, with **+ Then…** items (save to a summary index or lookup, email, Slack, Teams, PagerDuty, ServiceNow, write an event), an **Only if it found results** choice, **+ Add search**, move and remove, preview, and bands for **Starts**, **If a step fails** and **When done** (start another job). It writes ordinary steps, edges and actions, so Flow shows the same job; a job it can't edit opens read only with the reasons and **Edit in Flow**.
- **Actions:** a step action may have `only_if_results: true` and is then left out when the step found no rows. Flow's action panel has **Only if the step found results** for step actions on success.

## 1.26.0 (2026-11-18)

- **Triggers start chosen steps:** a Schedule or "after job" trigger starts only the steps it is connected to (new trigger field `steps`), so different searches in one job can have different schedules. Triggers now have a **+** and can be dragged onto a step with no line into it; a trigger's line can be removed. New triggers start nothing until connected. A run records `entry_steps`; a first step its trigger isn't connected to is skipped with `skip_kind` `not_started`, and so is the branch after it (an *always* line out of it doesn't fire). Schedules firing at once start the union of their steps. Manual, search, alert, REST and backfill runs start every first step, and triggers without `steps` (jobs saved before 1.26.0) behave as before. New checks: `bad_trigger` (an unknown step, or one with a line into it), warnings `trigger_starts_nothing` and `step_not_started`.

## 1.25.1 (2026-11-17)

- **Fixed:** **Test condition** always said "Preview <step> first" even when that step had a current preview: it sent the previews of the steps before the line's source step, but not the source step's own. It now sends both.
- **Fixed:** the SPL expression help used the step's name in its token example (`$Merge both.first.count$`); it now uses the step id (`$merged.first.count$`).

## 1.25.0 (2026-11-17)

- **Builder toolbar:** grouped into **Add node**, an **Arrange** menu (**Tidy up**, **Group selection**) and a **View** menu of toggles (**Node types**, **Grid**, **Line labels**, **Compact nodes**, **Side panel**), with the zoom buttons, the zoom level, **Frame all**, **Reset view** and **Full screen** on the right.
- **Side panel:** hide it (**›**) and bring it back (**‹**), and resize it by dragging its left edge or with the arrow keys, `Home` and `End` on it (260–800 px; double-click for the default). Remembered in this browser (`so.flow.panel`).
- **Help:** every section of the guide has an illustration under its heading: small flows drawn with the builder's shapes, panel and dialog mock-ups, SPL with syntax colours, timelines, a calendar and tables.

## 1.24.1 (2026-11-17)

- **Fixed:** a **Results of earlier steps** step right after an approval step failed with `token $so_input$: bad search id` (an approval has no search). An approval now adds no input, like a skipped step, in runs and previews.
- **Examples:** the platform health example's **Record the escalation** is a search of its own, so it shows who approved, the comment, the score and the environment.

## 1.24.0 (2026-11-17)

- **View output:** Lookup and Summary index nodes have **View output**, Email actions **View sent emails** and Event actions **View output**: a dialog with up to 100 rows, the total, the search and **Open in Search**. In the builder it searches the last 24 hours, 7 days or 30 days (a lookup: its contents now); on the run page, under **Output** in a step's details, only that run's time window and run id. New route `POST preview/output` (runs as the caller, like a preview; polled with `preview/<sid>`), audited `output_viewed`.

## 1.23.1 (2026-11-17)

- **Examples:** the platform health example's Health score step wraps `$run.param.error_threshold$` in `tonumber()`, since tokens go in as quoted strings.
- **Help:** the Help page starts with a visual overview (quick start, an example flow drawn with the builder's shapes and line colours, node shapes, line colours and a card per feature linking to its section) and has a contents list of the guide's sections.
- **Calendar:** a **Month** view: six weeks from Monday, one line per job per day with a count and a dot for the most serious state, a legend, and a click on a day opens it in the day view. It fetches a week at a time (the route still takes at most 8 days).
- **Examples:** an eleventh example, **Platform health pipeline (everything)** (`example_platform_health`), that uses nearly every feature in one job: parallel checks, parameters, all three condition kinds, an approval gate, a deadline, Run when, a lookup, retries, Delayed after, event and start-job actions and groups.

## 1.23.0 (2026-11-17)

- **Snippets:** **Save as snippet** in the right-click menu of a node or selection (`Menu` key or `Shift+F10`) and in the selection panel saves nodes under a name (up to 80 characters, unique ignoring case) and a description (up to 500). Everyone who can build jobs can see and insert a snippet, including its searches; secrets stay in destinations. Snippets appear in a **Snippets** section of the quick-add box (not from a + handle), and inserting one is a single undo step. **Snippets…** in the builder toolbar offers **Rename** and **Delete** for the owner or an admin. A snippet holds at most 100 steps and 200 KB. New KV Store collection `so_snippets`; routes `GET/POST snippets` and `GET/PUT/DELETE snippets/<id>` (PUT renames only); audit events `snippet_saved` and `snippet_deleted`.
- **Performance:** the engine stores `perf` (run duration, events scanned, results, disk usage) on each step, its attempt row and `step_attempt` events; runs from before 1.23.0 have none. The run page has a **Performance** tab (Step, Runtime, Events scanned, Results, Disk, Peak CPU, Peak memory and a Total row) with **Load CPU and memory**. New route `GET runs/<id>/performance`: runs as the caller against `_introspection` and `_audit` (a fallback for older steps), with a 30 second limit and at most 50 searches, and returns notes.
- **Run health:** a **Performance** section with Runtime per job, Events scanned per job, Slowest steps by runtime and Peak CPU and memory per job. New macro `orchestrator_search_process`.
- **Fixed before release** (in features from 1.19.0 to 1.23.0):
  - A run started by a completion trigger or start-job action of a backfill, catch-up, manual or REST run no longer gets a deadline, so it is not late (and paging) the moment it is created. Runs started by an on-time scheduled run, or along a chain from one, still have one.
  - Replacing a PagerDuty destination with an empty **New URL** keeps its stored URL (such as the EU endpoint) instead of resetting it to `events.pagerduty.com`; the help text says so.
  - Version history no longer adds "Changed the hidden search of …" to every search edit, saving an unchanged job from before 1.19.0 writes no version, versions store the job's `owner`, and a failed version write no longer fails a save that already happened (audited `job_version_failed`).
  - **Finish by** follows undo and redo, and an invalid time can no longer save the last valid one unseen: the save is refused until it is fixed, and the issue points to the Settings tab.
  - A backfill whose job is deleted is cancelled (audited `backfill_cancelled` with `reason` `job_deleted`) instead of staying running, so a new job with the same ID can't resume it.
  - **Test condition** works on a line from an approval step, and previewing a step after an approval step no longer asks to preview the approval step; both take it as approved with no comment.
  - Slack, Teams, PagerDuty and ServiceNow approval requests include the approval step's message instead of "status awaiting_approval".
  - The performance route ignores a sid with a trailing newline.
- AppInspect (precert, cloud): 0 errors and 0 failures on both packages; the same 9 warnings as 1.22.0, none new.

## 1.22.0 (2026-11-17)

- **Channels:** new webhook body formats **Microsoft Teams** (Adaptive Card 1.4), **PagerDuty** (Events API v2) and **ServiceNow** (Table API incident), each a notify node in the builder whose destination picker shows only that format. PagerDuty **Severity** is Critical, Error, Warning or Info (default Error, Warning for Is delayed and Is late), and a succeeded run's Succeeds or Finishes either way action resolves the incident. ServiceNow **Urgency** and **Impact** take 1 to 3 (default 2), and **Assignment group** up to 100 characters. An admin sets the PagerDuty routing key as a write-only destination field; the PagerDuty URL defaults to `events.pagerduty.com`, and a ServiceNow URL must end in `/api/now/table/incident`.
- **Approval steps:** an **Approval** node (octagon) with **Message** (tokens), **Who may approve** (roles), **Wait at most** (5 minutes to 7 days) and **If nobody decides** (Reject or Approve). Outcomes: Approved, Rejected, Decided either way, Starts, Is delayed and Asks for approval. The step state is `awaiting_approval`, shown as "Waiting for approval · since …"; the run page has **Approve** and **Reject** with a comment, required to reject. A timeout never fires while the run is paused, but paused time counts toward it; a decision made while paused takes effect on resume; a re-run asks again; previews treat an approval step as approved.
- **Permissions:** new capability `orchestrator_approve` (admin, sc_admin and `orchestrator_admin_role`) and role `orchestrator_approver_role` (imports `user`; run and approve). The run's starter may decide only steps with no role list, audited `as_starter`. `GET me` returns `can_approve`.
- New route `POST runs/<id>/approve`; command `| orchestrate approve run= step= decision=approve|reject [comment=]`; audit events `approval_requested`, `approval_decided` and `approval_ignored`.
- AppInspect (precert, cloud): 0 errors and 0 failures on both packages; the same 9 warnings as 1.21.0, none new.

## 1.21.0 (2026-11-17)

- **Dependencies page:** after Runs in the navigation. A graph of jobs joined by completion triggers and start-job actions, with lines labelled "after it succeeds", "after it finishes" or "start-job action · <outcome>". A job you can't see appears as "Job you can't see". It has a **List** view, a panel with **Open job** and **Open runs**, a **Not connected** row, and refreshes every 30 seconds.
- **Calendar page:** after Dependencies, with **Day** and **Week** views (weeks start on Monday) in the browser's time zone. It shows scheduled times (dashed), runs with their state on a left border plus "Late", and backfill slots; overflow shows as "+N more". Filter by job; it refreshes every 60 seconds while showing today.
- New route `GET calendar?from&to[&job_id]`: a range of at most 8 days, at most 300 scheduled slots per job and 2000 items in all, after which `truncated` is set.
- AppInspect (precert, cloud): 0 errors and 0 failures on both packages; the same 9 warnings as 1.20.0, none new.

## 1.20.0 (2026-11-17)

- **Deadlines:** a job's **Settings** tab has **Finish by** (a time of day in the job's time zone) and **Finish within** (1 minute to 7 days after the scheduled time); the earlier counts. Only on-time scheduled runs and runs started by another job have one; manual, REST, alert, backfill and catch-up runs have none, and a re-run of a run that finished in time, started after the deadline, is not late. A run that passes its deadline is marked late once: the **Whole job** node's **Is late** outcome and the `on_late` hook fire (the admin's fallback notification is used when the job has no late action), the run gets `deadline_at` and `late_at`, the run page shows "This run missed its deadline", the audit index gets `run_late`, and **Run health** has **Late runs** panels.
- **Backfill:** **Backfill…** on Jobs rows and in the builder toolbar runs a job for each time in a past range, oldest first, on the job's schedule or every so often (up to 100 runs over 400 days), with **Runs in the queue at once** from 1 to 5. Backfills show on the Runs page with progress and cancel as a group. New KV Store collection `so_backfills`; routes `POST jobs/<id>/backfills` (with `dry_run`), `GET backfills`, `GET backfills/<id>` and `POST backfills/<id>/cancel`; audit events `backfill_created`, `backfill_cancelled` and `backfill_done`.
- **Commands:** `| orchestrate backfill job= from= to= [step=] [concurrency=] [param.x=]` and `| orchestrate status backfill=<id>`.
- AppInspect (precert, cloud): 0 errors and 0 failures on both packages; the same 9 warnings as 1.19.0, none new.

## 1.19.0 (2026-11-17)

- **Version history:** every save that changes a job stores a version (the newest 50 are kept, in the new `so_job_versions` KV Store collection). The **History** tab, the last tab in the builder, lists them with who saved, when and what changed. **Compare with current** and **Compare selected** show the changes; **Restore** saves an old version as a new one after you confirm, and is hidden on the newest. New routes `GET jobs/<id>/versions` (`version=`, `compare=a,b|current`) and `POST jobs/<id>/restore`; audit events `job_version_saved`, `job_restored` and `job_versions_pruned`.
- **Test condition:** a button under the condition field (on a line and on an **If…** node) runs that condition now and shows true or false, why, the filled SPL with **Copy** and the row count. It says "Preview <step> first…" when the source has no preview, and "Out of date. Test again." after a change. It runs as you, like a preview (`POST preview/condition`), and is audited as `condition_tested`.

## 1.18.2 (2026-11-17)

- Fixed: previewing a step whose search doesn't start with `|` (for example `index=_internal …`) failed with "Unknown search command 'index'". Previews now add the leading `search` that Splunk's search API needs.

## 1.18.1 (2026-11-17)

- **Conditions use a full search editor:** the condition field (on an **If…** node and on a line) is the same multiline SPL editor as a step's search, with colours, **Insert value** and at least four lines that grow with the text, in all three **Check with** modes. **Put each | on a new line** and the time range stay with **Search returns results**.
- **Open larger** on a step's search and on a condition opens a large editor dialog; **Done** applies, **Cancel** or `Esc` discards.

## 1.18.0 (2026-11-17)

- **Example jobs:** Jobs → **Browse examples** shows ten example jobs from simple to advanced (built on `_internal`, `_audit` and `makeresults`). Open one in the builder, or **Add all examples** to save them as turned-off jobs with a schedule, owned by you.

## 1.17.0 (2026-11-17)

Full SPL in conditions on lines, and a `$run.now$` token.

- **Check with** on a condition (the **If…** node and its line): **Simple comparison** (the existing language, still the default, so saved jobs behave as before), **SPL expression** (anything you would write after `| where`, with any eval function such as `now()`, `relative_time()`, `match()` or `if()`; true when `| makeresults | where <expression>` returns a row) or **Search returns results** (a full search with its own time range, default **The 24 hours before**; true when it returns a row). The field uses the SPL editor with colours and **Insert value**; only searches get **Put each | on a new line**. Lines read "◇ where …" or "◇ search …".
- SPL conditions run **as the job owner** through a content-addressed hidden saved search (`_so_<job>_cond_<hash>`) written at save, when the line's source step finishes. The next step waits meanwhile. The result is kept on the run, so each line is checked once per run; a re-run checks it again. A search error, a token with no value or a search running past **300 seconds** counts as not met, is shown in the run page's step details and is audited as `condition_failed`; every result is audited as `condition_evaluated`. The engine survives a restart mid-condition, and condition searches count toward the running-search limits.
- Saving refuses an empty SPL condition, unknown tokens, writing commands (`collect`, `outputlookup`, `outputcsv`, `tscollect`, `mcollect`, `meventcollect`, `sendemail`, `delete`), `| orchestrate`, and a `|` in an SPL expression, each with how to fix it.
- The run graph keeps a condition's line pending while it is checked, fires it when met and greys it when not met or failed.
- New token **`$run.now$`**: the epoch time when the value is filled in, in step searches, conditions, actions and run-when expressions. It is in every **Insert value** list.
- In an SPL expression, `$<step>.resultCount$`, `$run.scheduled_time$` and `$run.now$` go in as numbers (`tonumber("…")`); every other token is a quoted string, as in steps, so wrap first-row and parameter values in `tonumber()` to compare numbers. A search condition runs as `<search> | head 1`; a truncated subsearch fails it.
- Two lines between the same steps can't be saved when one has a condition (`duplicate_edge`).
- **Security:** a token after an unclosed `'` (an eval field name) is refused, in conditions and in step searches, and a `"` inside `'…'` no longer makes a token look quoted. A `'` no longer hides a writing command from the condition checks.

## 1.16.1 (2026-11-17)

- On Splunk 10.4 and later, the app's pages use the modern side navigation instead of the old app bar (`navLayout: "auto"`). Older Splunk versions keep the classic bar.
- Menu items have icons in the side navigation: Jobs, Runs, Run health, Settings and Help.

## 1.16.0 (2026-11-17)

A Run health dashboard and colours in the job source view.

- **Run health** (new menu item): a Dashboard Studio dashboard with a time picker and job filter. It shows run KPIs, runs over time by state, runs that need attention (click to open the run), the steps that fail most, the slowest steps, actions sent and failed, and engine health from `_internal`. It reads the audit index through the `orchestrator_index` macro and `_internal` through the new `orchestrator_internal` macro.
- The engine now writes a `step_delayed` audit event when a step passes its delay limit, and action events carry the webhook `preset`, so the dashboard can count delays and Slack messages. The REST handler prefixes its warnings with `orchestrator_rest:`.
- The **Source** tab colours keys, strings, numbers and `true`/`false`/`null`, and colours the SPL inside `"spl"` values.

## 1.15.2 (2026-11-17)

A quieter Flow canvas: the + appears when you need it, and outcome tabs sit at the middle of the node.

- The **+** handle shows only when you point at a node, select it (alone or in a multi-selection) or focus it with the keyboard. Hidden, it takes no clicks. A line you are already drawing keeps working if the pointer leaves the node. The run page never shows it.
- Outcome tabs are stacked in a column centred on the node's vertical middle, and the + sits to their right (at the edge when there are no tabs).

## 1.15.1 (2026-11-17)

Gentler wheel zoom, a checklist that can come back, and a default time range.

- The wheel now zooms in proportion to how far you scroll (at most 10 % per event), so a trackpad no longer jumps. The zoom buttons are unchanged.
- **Hide checklist** is remembered per job, and a **Show checklist** button brings the checklist back while the job is not ready. The stray bullet dots before the check icons are gone.
- A new search step starts with the time range **The 24 hours before** (earliest `-24h`, latest `now`). Existing and imported jobs, saved search steps and templates are unchanged.

## 1.15.0 (2026-11-17)

SPL colours in the search field, and `|` on a new line.

- The **Search** field of a step now colours its SPL: commands and pipes, keywords such as `by` and `as`, functions, fields, strings, `$tokens$`, macros, comments, numbers and operators. Colours follow the light and dark theme. The generated search of Summary index and Lookup steps is coloured the same way.
- Typing `|` now starts a new line (`| ` at the start of it), so a pipeline reads one command per line. It is left alone inside a quoted string or a ```` ``` ```` comment, for `||`, and on an empty line. Ctrl+Z (Cmd+Z) undoes it in one step. Turn it off with **Put each | on a new line** under the field; the choice is remembered in the browser.

## 1.14.0 (2026-11-17)

Job source: copy, paste and keep job definitions as text.

- New **Source** tab in the builder shows the job as JSON. **Copy** and **Download** it; edit it and choose **Apply changes** to replace the job as one undo step, or **Discard changes**. Syntax errors show the line and column. The job keeps its own id.
- New **Import job** button on the Jobs page: paste JSON or choose a .json file to open it in the builder as a new, unsaved job.
- Viewers see the source read only, with Copy and Download.

## 1.13.1 (2026-11-17)

Quieter canvas: fewer names on the lines.

- Lines carry no label by default; the selected line shows its label, and lines stay coloured by outcome.
- New toolbar toggle **Show line labels** / **Hide line labels**, remembered in your browser. On the run page, row counts show on data lines when it is on or while the line is flowing.
- Click a line itself, not only its label, to select it and open its menu.
- Outcome tabs on nodes are now small round tabs with just the symbol in a coloured ring; the name shows when you point at one and is read by screen readers. Dragging from a tab works as before.

## 1.13.0 (2026-11-17)

The live run graph: watch a run move through its flow.

- A strip above the run graph shows the run's state, the elapsed time ticking every second, a progress bar, "3 of 5 steps finished" and, while the run is active, "Updates every 5 s".
- Running steps have a pulsing blue outline, a spinner and a timer. Waiting steps are dimmed and say what they wait for; finished steps show their outcome and duration.
- Lines show the run: solid when they fired, flowing blue dashes into a running step, faded and dashed when they won't fire. Finished search steps put their row count on their data lines.
- Actions show live text: "Sending…", "Retrying in 30 s" (counted down), "Sent", "Failed" or "Not sent yet".
- The graph follows the running steps until you pan or zoom; **Follow the run** turns it back on.
- With reduced motion, there is no pulse, spinner or moving dashes. A finished run shows its final picture without animation.
- The user guide's "The run graph" section describes all of this.

## 1.12.0 (2026-11-17)

Editing at scale in the flow editor: select, copy, align, group and see results on nodes.

- Select several nodes with **Shift+click**, **Shift+drag** on the canvas, `Ctrl/Cmd+A` or `Shift+Space`, and move them together. The side panel offers **Align** and **Distribute** buttons and **Tidy up selection**. Removing several nodes asks "Remove N nodes?".
- Duplicate, copy and paste nodes with `Ctrl/Cmd+D`, `C` and `V`, also between jobs. Ids are renamed when taken, and "Pasted N nodes" has an **Undo**.
- A right-click menu for nodes, selections and the canvas; open it from the keyboard with `Menu` or `Shift+F10`.
- **Show grid** and alignment guides while you drag. **Compact nodes** shows each node as a name and icon.
- Nodes show their preview result: "1 204 rows · 3.2 s", "Out of date" or "Preview failed: ...".
- Groups: coloured backdrops with a title, colour, width and height, made with `Ctrl/Cmd+G` or right-click, **Group**. They collapse and expand, `Shift+arrows` resize them, and the run page always shows them expanded.
- Only the main mouse button drags.
- The user guide gains sections for each of these and a keyboard shortcut table.

## 1.11.0 (2026-11-16)

Connecting nodes in the flow editor: one + handle, outcome tabs and line labels.

- The six ports on each step are replaced by one **+** on its right edge. Click it to choose **When**: Succeeds, Fails, Finishes either way, Starts, Is delayed or If a condition is true, each with how many lines already use it. Then pick the next node; it is placed to the right and connected.
- Drag from **+** to a node and choose the outcome (or, when only one is allowed, the line is made at once). Drop it on empty canvas to pick the outcome and the new node together.
- Each outcome in use shows as a tab on the node, where its lines leave. Drag from a tab to draw another line with that outcome.
- Lines carry a label with their outcome. Click it for a menu: change the outcome, insert a node, or remove the line (lines to actions can't be removed).
- Drag a step with no lines onto a line between two steps to put it in between. A message with **Undo** says what changed.
- The canvas scrolls while you drag near its edge, fills the window height, and has a **Full screen** mode with the side panel; `Escape` leaves it.
- Previews never run a search that writes: a step whose search uses `collect`, `outputlookup`, `outputcsv`, `tscollect`, `mcollect`, `meventcollect`, `sendemail` or `delete` can't be previewed, nor can a live preview after one. Saved searches and macros are not checked.
- The legend shows the When outcomes, an example + and tab; the user guide's flow editor section is rewritten for all of the above.

## 1.10.0 (2026-11-16)

More nodes, a legend and a minimap for the flow editor, and the flow on the run page.

- New **Summary index** and **Lookup** nodes write the results of earlier steps with a generated `| collect` or `| outputlookup` search. **Edit as search** turns one into a plain **Results of earlier steps** step.
- New **Slack** action node, for a webhook destination with the Slack body format.
- Lines that carry data are thick and lines that only signal are thin.
- **Show node types** opens a legend of node shapes, colours and exits. A minimap helps you move around a big graph.
- The run page has a **Graph** tab that draws the job's flow with each step's state and each action's result: Sent, Failed, Retrying or Not sent yet.
- Previews never write: a **Summary index** or **Lookup** step can't be previewed, and neither can a live preview downstream of one.
- Moving or adding the first node in a job without saved positions keeps every other node where it was.
- Save problems about an action or a trigger select that action or trigger, and the action's panel lists them.
- The user guide covers all of the above.

## 1.9.0 (2026-11-16)

The job builder is a node editor: everything before, during and after a search is a node, and lines say what happens when.

- The **Steps** tab is now **Flow**, and the **Triggers** and **Actions** tabs are gone. Schedules, "after another job" triggers, actions, conditions and the whole job are nodes on the canvas, read from left to right.
- Each kind of node has its own shape and colour: triggers, searches, results of earlier steps, conditions, notifications, writes to an index, starting another job and the whole job. Colour is only an accent; it never shows whether something worked.
- Steps have output ports on their right: Succeeded ✓, Failed ✗, Finished either way ∞, Started ▶, Delayed ⏱ and If… ◇. A line from a port to a step makes a dependency; a line to an action says when it fires. If… adds a condition node with its expression. The Whole job node's lines make job-wide actions.
- **Add node**, or `/` with the canvas or its toolbar focused, opens a search box of every node kind. Dragging a line onto empty canvas opens it with only the nodes that line can lead to, and connects the new node.
- Nodes can be dragged anywhere, and their positions are saved with the job in `layout`. **Tidy up** places every node again. Moving nodes does not count as changing the job, so **Re-run from step** does not ask for the latest or the original definition because of it.
- The side panel edits the selected node. An action's **When** field moves its line from the keyboard. A schedule's time zone is on the Settings tab.
- Save problems and the setup checklist select the node to fix: the step, the condition, the first trigger or the Whole job. A job with no schedule opens the box with the two trigger nodes.
- The keyboard reaches everything: `Tab` through nodes and lines, `Enter` to select, arrow keys to move, `Delete` to remove (after a confirm; Undo brings it back), `F` to frame the graph.
- The server checks the shape of `layout` and of a step's `output`, and says how to fix a broken layout.

## 1.8.0 (2026-11-11)

Plain words, a friendlier Jobs and Runs, and help inside the app.

- The Jobs page shows a summary line for each job (when it runs and how many steps), has a **Find jobs** search and a **Create job** button, and with no jobs offers the templates to start from.
- Runs has a **Needs attention** filter. A run that needs attention says what to do next, and the button that lets held runs go ahead is now **Dismiss run**.
- A **Help** page in the app shows the user guide, and many fields have a **Learn more** link to the matching section.
- Wording: the step type "From previous steps" is now **Results of earlier steps** (the stored value is unchanged); "When a step gives up" offers **Wait for this run to be fixed** or **Start later runs anyway**; skipped steps read *Skipped (branch not taken)*; help texts no longer use internal words such as dispatchAs or wrapper.
- Problem messages from the server say what to do next. Only the message text changed; the codes are the same.
- Next run times use the time zone the server schedules in. `POST schedule/next` also returns `timezone` (the job's zone, or null for server time) and `utc_offsets` for each slot.
- The user guide covers templates, schedule presets, time range presets, Insert value, the setup checklist, automatic checking and the Help page.

## 1.7.0 (2026-11-11)

Fewer surprises when saving or leaving the job editor.

- Job tabs show how many problems each has. A failed save lists every problem, with a button that goes to it.
- The job is checked against the server while it is edited, so the Validate button is gone.
- Leaving the editor with unsaved changes asks first.

## 1.6.0 (2026-11-11)

Faster starts and fewer typos when building a job.

- A new job starts from a template: Daily, weekly and monthly rollup, One search after another, Run searches side by side, then combine, or Blank job. Choosing one fills in the steps, and one undo takes them back out.
- An **Insert value** list puts tokens into searches, edge expressions and action messages (the email subject and message, and the event payload). It lists only the tokens that exist at that point. With no cursor in the field, the token goes at the end. A selection is replaced.
- A setup checklist above the tabs shows what the job still needs: a name, a step, each step's search, when it runs and who hears about failures. Each open item has a button to the right tab. It goes away once the job is ready.

## 1.5.0 (2026-11-11)

Clearer schedules, durations and time ranges in the job editor.

- Durations take a unit (minutes, hours or days). A stored value shows in the largest whole unit, so 5400 seconds reads as 90 minutes. A value that isn't whole minutes shows rounded to minutes and keeps its exact seconds until you edit it.
- A schedule is picked from presets (hourly, daily, weekly, monthly) or typed as a custom cron. It shows a plain summary and the next runs in the job's time zone. A cron no preset matches opens as Custom and is never rewritten. The time zone is picked from a list, and a stored zone the list lacks stays selected.
- A step's time range is picked from presets (the hour, day, week or month before, or the last 24 hours), All time or Custom. It shows the window searched for a run scheduled at the preview time. All time shows a warning.
- Two new REST routes back these readouts: `POST schedule/next` returns the next times a cron fires, and `POST timerange/resolve` returns the window an earliest and latest cover.

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
