# Search Orchestrator: user guide

Version 1.1.0. Search Orchestrator makes dependent searches run as one unit, so a weekly rollup never runs on top of an unfinished daily summary. Admins: see the [admin guide](admin-guide.md).

## Words used

- **Job:** a graph of search steps, with triggers, parameters and actions.
- **Step:** one search in a job. A step starts only when the steps it depends on have finished.
- **Run:** one launch of a job. Each run keeps a copy of the job as it was when the run started.

You need `orchestrator_build` to create jobs and `orchestrator_run` to start them. Ask your Splunk admin.

## Build a job

Open **Jobs > New job**.

1. **Add steps** with **Add step**, or by dragging a line from a step's handle (the circle at its bottom edge) and letting go on empty canvas: that adds a **From previous steps** step that reads the first step's results, and selects it. Let go on another step instead to make that step depend on the first. Steps are arranged automatically, top to bottom, every time the graph changes, so there is nothing to place. Keyboard and screen-reader users can use **Depends on** in the side panel instead.
2. **Select a step** to edit it in the side panel: its search, time range, run-when rule, delay and give-up times, retries and actions.
3. **Select an edge** to choose when it lets the next step start: on success (the default), on failure, always, or an expression such as `$daily.resultCount$ > 0`.
4. Use the job tabs for triggers, parameters, actions, who may run and job-wide defaults.
5. **Save.** The builder checks for cycles, unknown tokens, bad cron, unreadable saved searches and tokens from steps that might be skipped.

Node positions are not saved. The graph is laid out again each time the job opens.

### Steps

- **Search** steps hold SPL. **Saved search** steps run an existing saved search. **From previous steps** steps search the results of the steps before them; see [From previous steps](#from-previous-steps). A saved search that isn't your own private search runs through a `| savedsearch` wrapper, and its own summary indexing and alert actions don't run. The builder warns you.
- **A saved search must be shared globally or saved in the Search Orchestrator app** to be used as a step. Steps run in this app's context, where a private search in Search & Reporting, or one shared only with another app, can't be seen. Saving the job then fails with: "Saved search '<name>' must be shared globally or saved in the Search Orchestrator app to be used as a step."
- **Steps run as the job owner**, with the owner's roles and index access.
- **Time range:** Earliest and Latest are relative to the run's **scheduled time**, never to when the step actually starts. A daily summary that starts late after midnight still summarises the right day. **A search step with no time range runs over all time.** Set Earliest and Latest, such as `-1d@d` and `@d`.
- **Run when:** limits a step to some runs, so one job can hold daily, weekly and monthly steps. Presets such as "Mondays" and "1st of month" match the whole day of the scheduled time. A step that doesn't apply shows as *Skipped (run when)* and lets the steps after it go ahead.
- **Delayed after** (default 1 hour from the scheduled time): fires the delay alert once.
- **Give up after** (default 24 hours from when the run leaves the queue): the step fails, other searches in the run are cancelled, and unfinished steps are abandoned.
- **Max runtime** (default 4 hours per attempt).
- **Retries** (default 0). A retry runs the search again, which can write duplicates to a summary index. See [Make steps safe to re-run](#make-steps-safe-to-re-run). Searches that never started are always retried up to 3 times.

### From previous steps

A **From previous steps** step searches the results of the steps it depends on, with no search of its own to repeat. Its SPL runs on their rows, as if each were loaded with `| loadjob`: the first dependency's results, then each later one appended, in the order the dependencies were connected.

- **Its SPL must start with `|`**, such as `| stats sum(count) by host`. Saving fails otherwise, and it fails unless the step depends on at least one step (a connection into it).
- **It has no time range of its own.** It works on rows the earlier steps already found. Switching a step to this type drops its Earliest and Latest.
- **Switching back to Search** writes the input into the SPL as `| loadjob $<step>.sid$` tokens. A token from a skipped or failed step fails the step, so if a dependency can be skipped or fail, give the token a default or keep the From previous steps type.
- **Skipped and failed inputs add nothing.** Only dependencies that succeeded are loaded. A step that runs after an `on_failure` connection still runs, without the failed step's rows. If no dependency succeeded, it runs on no rows.
- **The second and later inputs are limited to 50,000 rows each.** They are appended through a subsearch, and Splunk cuts a subsearch short at that limit. When that happens the step fails with "a subsearch was cut short: ..." and Splunk's message, never with silently partial results. The first input has no such limit, so connect the largest dependency first, or summarise the inputs before they reach this step.

### Tokens

Use these in SPL, expressions and action messages:

- `$run.id$`, `$run.scheduled_time$`, `$run.param.<name>$`
- `$<step>.sid$`, `$<step>.resultCount$`, `$<step>.status$`
- `$<step>.first.<field>$`: a field from the step's first result row

**Tokens are substituted as quoted values**, so they can't be used to inject SPL commands or field names. `index=$run.param.idx$` runs as `index="<value>"`; a token you already put inside double quotes stays there. A token can't sit inside a ```` ``` ```` comment or right after a backslash (put the backslash in the value), and a parameter or result value containing a backtick fails the step. Pass a step's full results with `| loadjob $daily.sid$`, so nothing runs twice. A step can't call `| orchestrate`; use a start-job action instead. Any other `$` text in SPL, such as `rex "foo$"`, is left alone. A token from a skipped step fails the step that uses it, unless you give a default: `$weekly.sid|none$`.

### Parameters

Declare each parameter with a type (string, number, enum or time) and an optional pattern. Values are checked when a run starts, and every value goes into SPL as one escaped, quoted string.

### Triggers

| Trigger | How |
|---|---|
| Schedule | Cron on the Triggers tab, in the job's time zone. |
| Manual | **Run now** on the Jobs page. |
| Search | `\| orchestrate start job=<id> param.<name>=<value>` |
| Alert | The "Start orchestrator job" alert action. The alert must be owned by a real user who may run the job, not `nobody`. |
| REST | `POST /services/orchestrator/jobs/<id>/runs` |
| Job completion | "After job X succeeds" or "completes". |

- **"Completes" also fires when the upstream run is cancelled**, not only when it succeeds or fails.
- Each upstream run starts the downstream job once. A chained run uses the upstream run's scheduled time.
- **Missed runs:** if Splunk or the engine was down at a scheduled time, choose to run each missed slot (up to 7), only the latest, or none.

### Actions

Add actions to a step or to the whole job, on start, success, failure, complete or delayed:

- **Webhook** to a destination your admin set up (Slack is a body format).
- **Email**, **event to an index**, **start another job**, or **any installed alert action**.

Action messages (email subject and message, webhook body, event payload and alert action parameters) take the tokens above, filled in when the action is sent, for example an email subject of `Daily rows: $daily.resultCount$`. A token with no value uses its default (`$weekly.sid|none$`) or is left empty. They also take `{{job}}`, `{{run_id}}`, `{{hook}}`, `{{step}}`, `{{status}}`, `{{run_url}}` and `{{message}}` (the default message). Webhook bodies are JSON-encoded after filling, and values sent to email, event and alert actions are escaped.

An action failing never changes the run's outcome; it shows on the run's Actions tab. If a job has no failure or delay action, your admin's fallback notification is used.

### Who may run

On the Access tab, list roles that may start the job. **Their runs search as you, with your access**, but only the SPL you saved. Role names you type are not checked, so check the spelling.

### When a step gives up

On the job Settings tab:

- **Hold later runs** (default): later runs wait until someone re-runs or dismisses the failed run. A rollup can't run over a window with a missing day.
  While runs are held, runs turned away because the job's queue is full are reported in the daily hold alert, not one notification each.
- **Continue with later runs:** later runs go ahead, so a weekly rollup may run with a day missing.

This setting is read from the job **as it is now**, not from the run's copy. Changing it affects runs already waiting.

### Previewing steps

**Preview step** runs one step in the editor and shows its rows. You don't need to save the job first. Nothing is stored in the run history, and previews never run actions.

- **Who:** you need `orchestrator_build` or `orchestrator_admin`, and the right to edit the job.
- **Your access:** a preview runs as you, as an ordinary search. A real run uses the job owner's access, which can differ. The step panel says so.
- **Preview as if scheduled at:** the time the step's Earliest, Latest and `run when` are worked out from. It starts as the last time the schedule would have fired, or now if the job has no schedule. Change it to try another day. The time field takes `9:05` as typed and shows it as `09:05` when you leave it.
- **Parameters:** one input per job parameter. The input shows the parameter's default, and an empty value uses the default, as a run does. An empty value for a parameter with no default fails the preview with "value is required".
- **Input from:** where earlier steps' results come from.
  - **Live previews** (default): the previews you made in this editor. If a step before this one has no current preview, it is previewed first, in order. A failed step is treated as a run would treat it: a step reached from it by an `on_success` connection isn't previewed ("... failed, so a run would not reach this step"), and you fix that step first; a step reached by an `on_failure` or `always` connection is previewed. Live previews are kept only in your browser tab; leaving the editor drops them.
  - **A past run:** the results that run saved for the earlier steps. The list shows the job's 20 most recent runs, and is refreshed when you save and when you open it. A run that ended longer ago than the result retention (24 hours by default) is greyed out and marked "(results expired)". Choosing a run also sets the time and parameters to that run's. If the run's step results have expired or the step isn't in the run, the preview fails and says so. It never falls back to a live preview. If Splunk won't let you read a step's results from that run, the preview fails with "you may not read <step>'s results from that run; only its owner or an admin can".
- **Result:** a line with the row count, time and input, then a table of the first 100 rows. The input part names every earlier step the preview read, through a connection or a token, as the server used it: "daily preview, 2 min ago" (the time updates each minute), "weekly skipped" for a step a run would skip (even one you previewed anyway), or "daily failed preview" for a failed step an `on_failure` or `always` connection still reads. Search errors and warnings show above the table. An ERROR message fails the preview, as in a run.
- **Skipped steps:** if a run at that time would skip the step, you see "Would be skipped" and why. Steps after it treat it as skipped. **Preview anyway** runs it once with its inputs; steps after it still treat it as skipped, as a run would.
- **Job-wide errors:** a dependency cycle or a malformed job blocks every preview, since the editor can't work out which steps come first. The preview says which, for example "the job has a cycle: a → b → a; fix it before previewing". Other errors block only the previews of steps they touch.
- **Out of date:** changing a step, the time, the parameters or the input marks that step's preview and the ones after it "Out of date". The old table stays greyed until you preview again.
- **Limits:** a preview is cancelled after the step's max runtime, or 10 minutes if that is shorter. A preview you stop watching is cancelled after about three minutes. Finished previews are kept for 30 minutes while you use them. **Cancel** stops one early, together with the earlier steps' previews it started that are still running, unless another step's preview is waiting on them. Each step has one preview at a time: starting another cancels the first. The table shows 100 rows, but the search keeps all of them, so a later preview reads the full input.

## Follow runs

- **Jobs** shows each job's next run and last outcome, with Run now and an enable switch. The switch never changes the job's owner. A next run more than about 400 days away shows as a dash. If you may edit a job, **Delete** removes it after you confirm. Cancel its active or queued runs first.
- **Runs** lists runs, filterable by job and state.
- **Run detail** has a timeline, the graph, logs, actions and parameters. A warning message explains a delay, such as which step is late and what waits for it. Click a step for its attempts, actions and links to its search job and Job Inspector.

Statuses are plain text with an icon. **Delayed** is not a state: the work is still expected to finish.

| Run state | Meaning |
|---|---|
| Queued | Waiting behind an earlier run of the same job. Runs of a job never overlap. |
| Running | Steps are running or waiting on dependencies. |
| Blocked | A step failed with nothing to handle it. The run waits for a re-run, cancel or its deadline. |
| Paused | No new steps start; running searches carry on. |
| Succeeded, Failed, Cancelled | Finished. |

## Re-run from a step

On a blocked, failed or cancelled run, choose **Re-run from step**. That step and everything after it run again with the same scheduled time and parameters; finished steps before it are kept.

- If the job changed since the run started, **you must choose the latest or the original definition**. Nothing is preselected. The latest is disabled, with the reason, if it removed a step the run needs. The search command needs `definition=latest` or `definition=original` in the same case.
- Tick **start downstream jobs again** to re-fire completion triggers that already fired.
- Step results are kept for 24 hours after a run by default. If they have expired, the step fails and says which earlier step to re-run.

### Make steps safe to re-run

Retries and re-runs run a search again. If the search writes with `collect` or summary indexing, it can write the same data twice. The app doesn't detect or remove duplicates. Ways to stay safe:

- **Overwrite instead of append.** Write to a lookup with `outputlookup`, or to KV Store with a key per time window, so a second write replaces the first.
- **De-duplicate when reading.** Summarise per time bucket and read with `dedup _time` or `stats latest(...) by _time`.
- **Check first.** Have the step look for existing summary data for its window and write only if there is none.
- Keep **Retries** at 0 for steps that write.

## The `| orchestrate` command

```
| orchestrate start job=<id> [param.<name>=<value>]... [scheduled_time=<epoch>]
| orchestrate status [run=<run id>] [job=<id>] [limit=<n>]
| orchestrate cancel run=<run id>
| orchestrate rerun run=<run id> step=<step> [definition=latest|original] [restart_downstream_jobs=true|false]
| orchestrate jobs
```

`status` without `run=` shows up to 20 recent runs (5 by default), and stops with a warning if fetching them takes over two minutes. `scheduled_time` lets you backfill a day: steps then summarise that day's window.

`start` refuses a `param.<name>` the job doesn't declare. An option given twice or with an empty value is an error, so an unset dashboard token can't select other runs. `cancel` refuses a run that has already finished.

## Audit events

Every change is written to the `orchestrator` index. **Outside the app, and on Splunk Cloud, search `index=orchestrator`**; the `orchestrator_index` macro works only inside the app.
