# Search Orchestrator: user guide

Version 1.0.0. Search Orchestrator makes dependent searches run as one unit, so a weekly rollup never runs on top of an unfinished daily summary. Admins: see the [admin guide](admin-guide.md).

## Words used

- **Job:** a graph of search steps, with triggers, parameters and actions.
- **Step:** one search in a job. A step starts only when the steps it depends on have finished.
- **Run:** one launch of a job. Each run keeps a copy of the job as it was when the run started.

You need `orchestrator_build` to create jobs and `orchestrator_run` to start them. Ask your Splunk admin.

## Build a job

Open **Jobs > New job**.

1. **Add steps** on the canvas, or in the side panel. Drag from one step to another to make the second depend on the first. Keyboard and screen-reader users can use **Depends on** in the side panel instead.
2. **Select a step** to edit it in the side panel: its search, time range, run-when rule, delay and give-up times, retries and actions.
3. **Select an edge** to choose when it lets the next step start: on success (the default), on failure, always, or an expression such as `$daily.resultCount$ > 0`.
4. Use the job tabs for triggers, parameters, actions, who may run and job-wide defaults.
5. **Save.** The builder checks for cycles, unknown tokens, bad cron, unreadable saved searches and tokens from steps that might be skipped.

Node positions are not saved. The graph is laid out again each time the job opens.

### Steps

- **Search** steps hold SPL. **Saved search** steps run an existing saved search. A saved search that isn't your own private search runs through a `| savedsearch` wrapper, and its own summary indexing and alert actions don't run. The builder warns you.
- **Steps run as the job owner**, with the owner's roles and index access.
- **Time range:** Earliest and Latest are relative to the run's **scheduled time**, never to when the step actually starts. A daily summary that starts late after midnight still summarises the right day. **A search step with no time range runs over all time.** Set Earliest and Latest, such as `-1d@d` and `@d`.
- **Run when:** limits a step to some runs, so one job can hold daily, weekly and monthly steps. Presets such as "Mondays" and "1st of month" match the whole day of the scheduled time. A step that doesn't apply shows as *Skipped (run when)* and lets the steps after it go ahead.
- **Delayed after** (default 1 hour from the scheduled time): fires the delay alert once.
- **Give up after** (default 24 hours from when the run leaves the queue): the step fails, other searches in the run are cancelled, and unfinished steps are abandoned.
- **Max runtime** (default 4 hours per attempt).
- **Retries** (default 0). A retry runs the search again, which can write duplicates to a summary index. See [Make steps safe to re-run](#make-steps-safe-to-re-run). Searches that never started are always retried up to 3 times.

### Tokens

Use these in SPL, expressions and action messages:

- `$run.id$`, `$run.scheduled_time$`, `$run.param.<name>$`
- `$<step>.sid$`, `$<step>.resultCount$`, `$<step>.status$`
- `$<step>.first.<field>$`: a field from the step's first result row

Pass a step's full results with `| loadjob $daily.sid$`, so nothing runs twice. Any other `$` text in SPL, such as `rex "foo$"`, is left alone. A token from a skipped step fails the step that uses it, unless you give a default: `$weekly.sid|none$`.

### Parameters

Declare each parameter with a type (string, number, enum or time) and an optional pattern. Values are checked when a run starts, and string values are escaped before they go into SPL.

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

An action failing never changes the run's outcome; it shows on the run's Actions tab. If a job has no failure or delay action, your admin's fallback notification is used.

### Who may run

On the Access tab, list roles that may start the job. **Their runs search as you, with your access**, but only the SPL you saved. Role names you type are not checked, so check the spelling.

### When a step gives up

On the job Settings tab:

- **Hold later runs** (default): later runs wait until someone re-runs or dismisses the failed run. A rollup can't run over a window with a missing day.
- **Continue with later runs:** later runs go ahead, so a weekly rollup may run with a day missing.

This setting is read from the job **as it is now**, not from the run's copy. Changing it affects runs already waiting.

## Follow runs

- **Jobs** shows each job's next run and last outcome, with Run now and an enable switch. If you may edit a job, **Delete** removes it after you confirm. Cancel its active or queued runs first.
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

`status` without `run=` shows up to 20 recent runs (5 by default). `scheduled_time` lets you backfill a day: steps then summarise that day's window.

## Audit events

Every change is written to the `orchestrator` index. **Outside the app, and on Splunk Cloud, search `index=orchestrator`**; the `orchestrator_index` macro works only inside the app.
