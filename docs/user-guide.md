# Search Orchestrator: user guide

Version 1.16.1. Search Orchestrator makes dependent searches run as one unit, so a weekly rollup never runs on top of an unfinished daily summary. Admins: see the [admin guide](admin-guide.md).

## Words used

- **Job:** a graph of search steps, with triggers, parameters and actions.
- **Step:** one search in a job. A step starts only when the steps it depends on have finished.
- **Run:** one launch of a job. Each run keeps a copy of the job as it was when the run started.

You need `orchestrator_build` to create jobs and `orchestrator_run` to start them. Ask your Splunk admin.

## Example jobs

**Browse examples** on the Jobs page (also offered when there are no jobs) lists ten ready-made jobs that use only data every Splunk has (`_internal`, `_audit`, `| makeresults`, `| rest`). **Open in builder** opens one as a new, unsaved job to look at and save. **Add all examples** saves every example that isn't a job yet, with ids starting `example_`; existing ones are skipped and errors are listed. Every example is scheduled but turned off: turn one on from its Settings when you're ready. Email actions go to `you@example.com` until you change them.

1. **Hourly splunkd errors** (simple): one search step counting splunkd errors each hour.
2. **Top sourcetypes to a lookup** (simple): yesterday's top 20 sourcetypes written to `so_example_top_sourcetypes.csv` by a Lookup node.
3. **Daily search activity** (simple): searches per user from `_audit`, with an email when the step fails.
4. **Daily, weekly and monthly rollup** (intermediate): a daily count appended to a lookup, rolled up on Mondays and on the 1st with Run when and `$run.scheduled_time$`.
5. **Two branches, one report** (intermediate): errors by component and warnings by host run side by side and merge in a Results of earlier steps step.
6. **Investigate only when errors were found** (intermediate): an If… node with `$count_errors.resultCount$ > 0` gates the investigate step.
7. **Parameters for component and threshold** (intermediate): a list and a number parameter used in the SPL and in a condition.
8. **Retries, recovery and clean-up** (advanced): retries, a Fails line to a recovery step, a Finishes either way summary and a job failure email (swap it for a webhook once your admin adds a destination).
9. **A slow step and a delay alert** (advanced): a deliberately slow step that is delayed after 30 seconds, emails once and has a 10-minute max runtime; run it to watch the run graph live.
10. **Chained jobs** (advanced): starts after the rollup example succeeds, starts the hourly errors example when it succeeds, and uses groups to organise the canvas.

## Build a job

Open **Jobs**, then **Create job**.

A new job starts from a template. Pick one and its steps are filled in, and one undo takes them back out:

- **Daily, weekly and monthly rollup:** three steps, each starting when the one before it succeeds.
- **One search after another:** a chain of steps.
- **Run searches side by side, then combine:** two searches run at once, and a third works on both their results.
- **Blank job:** an empty canvas.

Above the tabs, a **setup checklist** shows what the job still needs: a name, a step, each step's search, when it runs and who hears about failures. Each open item has a button that opens the right tab and selects the node to change; for a job with no schedule yet, it opens the add-node box with the two trigger nodes. It goes away once the job is ready, or sooner with **Hide checklist**; the choice is remembered per job in this browser, and **Show checklist** brings it back while the job is not ready.

The job is drawn on the **Flow** tab as nodes and lines, read from left to right: triggers, then steps, then the actions their outcomes lead to. See [The flow editor](#the-flow-editor).

1. **Add nodes** with **Add node**, or press `/` with the canvas focused, and type what you want, such as "email". Or drag a line from the **+** handle on the right of a node and let go on empty canvas: the box then offers only nodes that line can lead to, and the new node is connected to it.
2. **Connect nodes** by dragging from a node's **+** handle onto another node. A line between two steps makes the second depend on the first; a line to an action says when the action fires. Keyboard and screen-reader users can use **Depends on** in a step's panel, and **When** in an action's panel.
3. **Select a node** to edit it in the side panel: a step's search, time range, run-when rule, delay and give-up times and retries; an action's fields; a trigger's schedule; a condition's check.
4. Use the other tabs for parameters, who may run, and job-wide settings such as the time zone and step defaults.
5. **Save.** The builder checks for cycles, unknown tokens, bad cron, unreadable saved searches and tokens from steps that might be skipped.

**The job is checked as you edit it**, so there is no Validate button. Each tab shows how many problems it has. If a save fails, every problem is listed with a **Go to ...** button that opens the right tab and selects the node that has the problem. If you leave with unsaved changes, the builder asks first.

Where you put nodes is saved with the job. Nodes you never moved are placed for you. Moving nodes does not count as changing the job when you re-run a step.

### The flow editor

Each kind of node has its own shape and colour. The colour is a stripe on the left and the icon; it never says whether something worked.

| Node | Shape | Colour |
|---|---|---|
| Triggers: **Schedule**, **After another job** | rounded ends | purple |
| **Search**, **Saved search** | rounded corners; a saved search has a second stripe | blue |
| **Results of earlier steps** | cut corners | teal |
| **If…** (a condition) | diamond | amber |
| Notify: **Email**, **Webhook**, **Slack**, **Alert action** | notched right edge | pink |
| Write: **Summary index**, **Lookup**, **Event to an index** | cylinder | orange |
| **Start another job** | slanted sides | slate |
| **Whole job** | double outline | grey |

**The + handle.** A step has one input on its left and one round **+** on its right edge, shown when you point at the node, select it or focus it. The **Whole job** node and each **If…** node have a + too.

- **Click +** to open the **When** list: what has to happen to this node for the next one to run or fire. Each row shows how many lines already use it, for example "2 lines". Choose one, then pick a node in the search box below it: the new node is placed to the right of this one, in the first free spot, and connected with that outcome. `Escape` closes the list at any point.
- **Drag from +** to draw a line. Drop it on another node and the When list opens with only the outcomes that can go there; when only one can, the line is made without asking. Drop it on empty canvas and the When list and the search box open together; the new node lands where you dropped the line.

| When this node… | Symbol | A line to a step | A line to an action |
|---|---|---|---|
| Succeeds | ✓ | runs it when this step succeeds | fires on success |
| Fails | ✗ | runs it when this step fails | fires on failure |
| Finishes either way | ∞ | runs it whenever this step finishes | fires on complete |
| Starts | ▶ | not allowed (actions only) | fires on start |
| Is delayed | ⏱ | not allowed (actions only) | fires when the step is delayed |
| If a condition is true | ◇ | adds an **If…** node; the next step runs when its condition is true (see [Conditions](#conditions)) | not allowed |

The **Whole job** list has no "If a condition is true"; its lines make job-wide actions, which fire for the whole run. Trigger nodes have no +: a dashed line goes from each trigger to every step that has no step before it, because those are the steps it starts. An action takes exactly one line in. A line that isn't allowed, such as one that would make a loop, isn't made.

**Outcome tabs.** Every outcome a node already uses shows as a small round tab on its right edge: just the symbol (✓ ✗ ∞ ▶ ⏱ ◇) in a ring in the outcome's colour. Point at a tab to see its name, such as "Succeeds" or "Fails"; screen readers read the name too. Its lines leave from that tab, and lines are coloured by outcome. Dragging from a tab draws another line with that outcome, without the When list. The tabs stack in a column centred on the node's middle, with the + to their right.

**Line labels and the line menu.** Lines carry no label by default, so the canvas stays quiet; a line's colour shows its outcome. The **selected** line shows its label in the middle ("✗ Fails"; a line out of an **If…** node shows its condition, shortened: the expression itself, "◇ where …" for an SPL expression or "◇ search …" for a search). **Show line labels** in the toolbar draws a label on every line, and **Hide line labels** turns them off again; the choice is remembered in this browser. With labels on, they hide when you zoom out below 70 %, except on the selected line. On the run page, row counts such as "1 204 rows →" show on data lines while the toggle is on, or while the line is flowing. Click a line, or press `Enter` on a focused line, to select it and open its menu:

- **Change to …** gives the line another outcome. On a line to an action this changes when the action fires; it stays on the same node. "If a condition is true" turns a line between steps into an **If…** node. On the line into an **If…** node, choosing another outcome turns it back into a plain line and drops the expression. Each change is one undo step.
- **Insert a node** (lines between two steps) opens the search box and puts the new step on the line.
- **Move … onto this line** (lines between two steps) puts a step that has no lines yet on the line, where it is; up to five such steps are listed. This is the keyboard way to drag a node onto a line.
- **Remove line** (lines between steps and **If…** lines). An action's line can't be removed, because an action always belongs to a step or the whole job; change its outcome instead, or move it in the action's panel.

**Put a node on a line.** Drag a step that has no lines yet onto a line between two steps: the line lights up, and when you drop the step, A → B becomes A → new step → B. A → new step keeps the line's outcome; new step → B is Succeeds. A line out of an **If…** node can't be split. Because B now runs after the new step, and reads its results if the line carries data, a message says what changed, for example "Weekly rollup now runs after Filter hosts succeeds. Undo brings back the old line." The message has an **Undo** button and goes away after 10 seconds. **Insert a node** in the line menu does the same.

**Auto-pan.** While you drag a node or a line near the edge of the canvas, the canvas scrolls toward that edge, faster the closer you are.

**Full screen.** The canvas fills the window below the page header (at least 480 px tall), and the side panel scrolls beside it. **Full screen** in the toolbar shows the canvas and the side panel over the whole page; **Leave full screen** or `Escape` goes back. `Escape` first closes an open list or menu, or clears the selection.

**Keys**, with the canvas focused:

- `Tab` moves through the nodes, then the lines. `Enter` selects the focused one. On a focused line, `Enter` also opens its menu.
- `+` or `Shift+Enter` on a focused node opens its When list. Arrow keys move in the list, `Enter` chooses, then the search box takes over; `Shift+Tab` goes back to the list.
- `/` opens the add-node box, also from the toolbar. `Tab` opens it too while the pointer is over the canvas. Type to filter, arrow keys to move, `Enter` to add, `Escape` to close.
- Arrow keys move the selected node by 10 px. `Delete` or `Backspace` asks before removing it; **Undo** brings it back. The full list is under Keyboard shortcuts below.
- `F` frames the whole graph. Drag the background to pan, and use the wheel or the zoom buttons to zoom. The wheel zooms in proportion to how far you scroll, so a trackpad zooms smoothly.
- A new search step starts with the time range **The 24 hours before** (earliest `-24h`, latest `now`); change it in the step's panel. Existing, imported and pasted jobs, and saved search steps, are not changed.

**Data and signal lines.** A thick line carries data: it ends at a **Results of earlier steps**, **Summary index** or **Lookup** step, which read the results of the step it comes from. A thin line is a signal: it only says when something runs or fires, such as a line to an action or a dashed line from a trigger.

**Node types and the minimap.** **Show node types** opens a legend with the shape and colour of each kind of node, the When outcomes with their symbols, and an example + and tab; **Hide node types** closes it. When the graph is bigger than the canvas, a minimap appears. Drag in it to move the view.

**Tidy up** places every node again automatically, as one undo step. Moving a node is one undo step per move.

The time zone every schedule uses is on the **Settings** tab; a schedule's panel links to it.

#### Select several nodes

- **Shift+click** a node to add it to the selection or take it out. **Shift+drag** on empty canvas draws a box and selects every node it touches. `Ctrl+A` (`Cmd+A` on a Mac) selects every node; `Shift+Space` toggles the focused node.
- Drag any selected node to move them all together. Only the main mouse button drags.
- The side panel shows "N nodes selected" with **Align left**, **Align centres**, **Align right**, **Align top**, **Align middles**, **Align bottom**, **Distribute horizontally** and **Distribute vertically**. The two distribute buttons need three or more nodes ("Select three or more nodes"). **Tidy up selection** places only the selected nodes again.
- **Remove nodes** (or `Delete`) asks "Remove N nodes?" and lists their names. **Undo** brings them back.

#### Duplicate, copy and paste

- `Ctrl+D` (`Cmd+D`) duplicates the selected nodes next to the originals. `Ctrl+C` and `Ctrl+V` copy and paste, also into another job in the same browser.
- Pasted nodes get new ids when an id is already taken. Lines between the pasted nodes come with them; lines to nodes you didn't copy don't. A message such as "Pasted 3 nodes" has an **Undo** button, and says when a pasted step still needs a line into it.
- **Paste** in the canvas menu puts the nodes where you right-clicked.

#### The right-click menu

Right-click a node, a selection or the empty canvas, or press the `Menu` key or `Shift+F10` on a focused node. The menu offers, depending on what you clicked:

- Empty canvas: **Add node here**, **Paste**, **Tidy up**.
- A node: **Rename**, **Duplicate**, **Copy**, **Preview**, **Add a line**, **Remove**. An item that can't be used is dimmed and says why.
- Several nodes: **Duplicate**, **Copy**, **Align…**, **Distribute…**, **Tidy up selection**, **Group**, **Remove nodes**.

`Escape` closes the menu.

#### Grid and alignment guides

**Show grid** in the toolbar draws a grid behind the nodes, and moved nodes snap to it. **Hide grid** turns it off. While you drag a node, thin guides appear when its edge or centre lines up with another node, and it snaps to them.

#### Compact nodes

**Compact nodes** in the toolbar shrinks every node to its name and icon, so a big graph fits on screen. **Full nodes** brings the detail back. It changes only how nodes are drawn, not the job.

#### Results on nodes

After you use **Preview step**, its node shows the result under the name: "1 204 rows · 3.2 s". While it runs the node says "Previewing…". When the step, the time, the parameters or an earlier step changed since, it says "Out of date" in muted text. A failed preview shows "Preview failed: " and the first line of the error. A bar shows the row count relative to the largest preview.

#### Groups

A group is a coloured backdrop that gathers nodes under a title. It never changes how the job runs.

- Select nodes and press `Ctrl+G` (`Cmd+G`), choose **Group selection** in the toolbar, or right-click and choose **Group**.
- Click the group to edit its **Title**, **Colour**, **Width** and **Height** in the side panel. With the group selected, `Shift+arrows` resize it.
- **Collapse** shrinks the group to its title bar and hides its nodes; **Expand** shows them again. A faint dashed outline shows the area the collapsed group covers: drop, add or paste a node there and the group expands, so the node stays in view. The run page always shows groups expanded.
- **Remove group** asks "Remove group …?". The nodes in it stay.

#### Keyboard shortcuts

With the canvas focused:

| Keys | What they do |
|---|---|
| `Tab` | Move through the nodes, then the lines |
| `Enter` | Select the focused node or line; open a line's menu |
| `+` or `Shift+Enter` | Open the When list of the focused node |
| `Shift+Space` | Add the focused node to the selection or take it out |
| `Ctrl+A` / `Cmd+A` | Select every node |
| `Ctrl+C`, `Ctrl+V`, `Ctrl+D` (`Cmd` on a Mac) | Copy, paste, duplicate |
| `Ctrl+G` / `Cmd+G` | Group the selected nodes |
| `Delete` or `Backspace` | Remove the selection, after you confirm |
| Arrow keys | Move the selection by 10 px |
| `Shift+arrows` | Resize the selected group |
| `F` | Frame the whole graph |
| `/` | Open the add-node box |
| `Menu` or `Shift+F10` | Open the right-click menu |
| `Escape` | Close a list or menu, clear the selection, leave full screen |

### Write results to an index or a lookup

**Summary index** and **Lookup** are steps that write the results of earlier steps. Draw a thick line from the step whose results you want, then select the node. Both are **Results of earlier steps** steps underneath, and they take their input from the steps they depend on. **Depends on** in the side panel lists them.

- **Summary index** has **Summary index** (the index to write to), an optional **Source**, and **Add the run id**, which is on by default. The step's search is generated from these settings, for example `| collect index=summary source="daily" marker="so_run=$run.id$"`. The marker lets you tell which run wrote each event.
- **Lookup** has **Lookup name** (a lookup file such as `hosts.csv`, or a lookup definition) and **Append instead of replace**. The generated search is `| outputlookup hosts.csv`, or `| outputlookup append=true hosts.csv` when append is on. Without append, each run replaces the lookup's contents.
- Index and lookup names use letters, numbers, `_`, `.`, `:` and `-`. The panel says what to fix if a name is empty or has other characters.
- The **Search** field shows the generated search and can't be edited. **Edit as search** turns the node into a plain **Results of earlier steps** step with that search, so you can change it; the node then no longer has the summary index or lookup settings.

### Slack

**Slack** is an action node. It posts a message to Slack when the step or job reaches the outcome its line comes from, like any other action. It needs a webhook destination that your admin has set up with the Slack body format (see the admin guide); pick it by name in the side panel. A Slack node is a webhook with the Slack preset, so a job saved with one shows it as **Slack** and a plain webhook as **Webhook**.

### Steps

- **Search** steps hold SPL. **Saved search** steps run an existing saved search. **Results of earlier steps** steps search the results of the steps before them; see [Results of earlier steps](#results-of-earlier-steps). If a saved search isn't your own private search, its own alerts and summary indexing don't run; add `collect` to the step if you need them. The builder warns you.
- **A saved search must be shared globally or saved in the Search Orchestrator app** to be used as a step. Steps run in this app's context, where a private search in Search & Reporting, or one shared only with another app, can't be seen. Saving the job then fails with: "saved search '<name>' must be shared globally or saved in the Search Orchestrator app to be used as a step; change its sharing, or save a copy in this app".
- **Steps run as the job owner**, with the owner's roles and index access.
- **Time range:** pick a preset (the hour, day, week or month before, or the last 24 hours), **All time** or **Custom**. Under the picker, the builder shows the window searched for a run scheduled at the preview time, for example "For a run scheduled Tue 11 Nov 00:00, this searches Mon 10 Nov 00:00 to Tue 11 Nov 00:00". Custom takes Earliest and Latest as Splunk relative times, such as `-1d@d` and `@d`. They are relative to the run's **scheduled time**, never to when the step actually starts, so a daily summary that starts late after midnight still summarises the right day. **All time searches everything and shows a warning.**
- **Run when:** limits a step to some runs, so one job can hold daily, weekly and monthly steps. Presets such as "Mondays" and "1st of month" match the whole day of the scheduled time. A step that doesn't apply shows as *Skipped (run when)* and lets the steps after it go ahead.
- **Delayed after** (default 1 hour from the scheduled time): fires the delay alert once.
- **Give up after** (default 24 hours from when the run leaves the queue): the step fails, other searches in the run are cancelled, and unfinished steps are abandoned.
- **Max runtime** (default 4 hours per attempt).

Durations take a unit (minutes, hours or days). A saved value shows in the largest whole unit, so 5400 seconds reads as 90 minutes. A value that isn't whole minutes shows rounded to minutes and keeps its exact seconds until you edit it.
- **Retries** (default 0). A retry runs the search again, which can write duplicates to a summary index. See [Make steps safe to re-run](#make-steps-safe-to-re-run). Searches that never started are always retried up to 3 times.

### Conditions

An **If…** node (or a line set to **When a condition is true**) runs the next step only when its condition is true. **Check with** picks how the condition is written:

| Check with | Write | True when |
|---|---|---|
| **Simple comparison** (the default, and what jobs saved before 1.17.0 use) | `$daily.resultCount$ > 0 and $run.param.region$ == 'eu'`: tokens, numbers and quoted strings compared with `==`, `!=`, `>`, `>=`, `<`, `<=`, joined with `and`, `or`, `not` | the comparison holds |
| **SPL expression** | what you would write after `\| where`: any eval function, such as `now()`, `relative_time()`, `strftime()`, `match()`, `like()`, `if()`, `isnull()` | `\| makeresults \| where <expression>` returns a row |
| **Search returns results** | a full search, like an alert's | the search returns at least one row |

Examples:

- SPL expression: `$daily.resultCount$ > 1000 AND tonumber(strftime(now(), "%w")) = 1` (more than 1000 rows, on a Monday).
- SPL expression: `$run.now$ - $run.scheduled_time$ < 3600` (the source finished within an hour of the scheduled time).
- SPL expression: `match("$daily.first.status$", "^(ok|done)$")`.
- Search returns results: `index=_internal sourcetype=splunkd log_level=ERROR component=IndexProcessor` (run a clean-up step only when indexing errors were logged in the 24 hours before the scheduled time).
- Search returns results: `| loadjob $daily.sid$ | where count > 0 | head 1` (rows of the earlier step match).

How SPL conditions run:

- **When the line's source finishes** (succeeds or fails), the condition search runs **as the job owner**, like a step, through a hidden saved search (`_so_<job>_cond_<hash>`) written when you save the job. The next step stays *Waiting* meanwhile. A source that was skipped never runs it: the line is not taken.
- **Once per run.** The result is kept on the run. **Re-run from a step** checks the conditions into the steps it resets again.
- **Time.** `now()` and the time range are relative to the run's **scheduled time**, as in steps, so `relative_time(now(), "@d")` is the scheduled day. `$run.now$` (and SPL's `time()`) is the clock time when the condition is checked. **Search returns results** has a **Time range** (default **The 24 hours before**); **All time** searches everything.
- **Tokens** go in as quoted strings, as in steps. In an SPL expression, the number tokens (`$<step>.resultCount$`, `$run.scheduled_time$`, `$run.now$`) go in as numbers, so `$daily.resultCount$ > 0` compares numbers; in a search, wrap them in `tonumber()` inside `| where` or `| eval`.
- **A condition only reads.** It can't use `collect`, `outputlookup`, `outputcsv`, `tscollect`, `mcollect`, `meventcollect`, `sendemail`, `delete` or `| orchestrate`; saving says so. An SPL expression can't contain `|` outside quotes; use **Search returns results** for a full search.
- **A condition that fails counts as not met.** That covers a search error, a token with no value, and a search still running after **300 seconds** (it is stopped). The step after it is skipped, the run page's step details show the error, and the audit index gets `condition_failed`. Every result is audited as `condition_evaluated`.
- **Limits.** A condition search counts toward the running-search limits, like a step. Previews never run conditions: a preview treats an SPL condition as met.

The SPL field has the same colours and **Insert value** as a step's search. **Put each | on a new line** is offered for **Search returns results** only.

### Results of earlier steps

A **Results of earlier steps** step searches the results of the steps it depends on, with no search of its own to repeat. Its SPL runs on their rows, as if each were loaded with `| loadjob`: the first dependency's results, then each later one appended, in the order the dependencies were connected.

- **Its SPL must start with `|`**, such as `| stats sum(count) by host`. Saving fails otherwise, and it fails unless the step depends on at least one step (a connection into it).
- **It has no time range of its own.** It works on rows the earlier steps already found. Switching a step to this type drops its Earliest and Latest.
- **Switching back to Search** writes the input into the SPL as `| loadjob $<step>.sid$` tokens. A token from a skipped or failed step fails the step, so if a dependency can be skipped or fail, give the token a default or keep the Results of earlier steps type.
- **Skipped and failed inputs add nothing.** Only dependencies that succeeded are loaded. A step that runs after an `on_failure` connection still runs, without the failed step's rows. If no dependency succeeded, it runs on no rows.
- **The second and later inputs are limited to 50,000 rows each.** They are appended through a subsearch, and Splunk cuts a subsearch short at that limit. When that happens the step fails with "a subsearch was cut short: ..." and Splunk's message, never with silently partial results. The first input has no such limit, so connect the largest dependency first, or summarise the inputs before they reach this step.

### Writing the search

The **Search** field colours your SPL as you type, in the light or dark theme: commands and pipes in the accent colour, keywords (`by`, `as`, `AND`, `OR`), functions, fields before `=`, strings, `$tokens$`, `` `macros` ``, ``` ``` comments ``` ``` and numbers each get their own colour. The colours only help you read; the search is saved exactly as typed.

Typing `|` puts it on a new line, as `| ` at the start of the line, so a pipeline reads one command per line. A space just before the pipe is dropped. It does nothing inside a double-quoted string or a ```` ``` ```` comment, for `||`, or on a line with nothing before it, and pasted text is never changed. Ctrl+Z (Cmd+Z on a Mac) undoes the new line in one step. Clear **Put each | on a new line** under the field to type pipes in place; the browser remembers the choice.

### Tokens

Use these in SPL, expressions and action messages:

- `$run.id$`, `$run.scheduled_time$`, `$run.param.<name>$`
- `$run.now$`: the time, in epoch seconds, when the value is filled in: when a step's or condition's search starts, when an action's hook fires, or when a simple condition or run-when expression is checked. `$run.scheduled_time$` is when the run was scheduled.
- `$<step>.sid$`, `$<step>.resultCount$`, `$<step>.status$`
- `$<step>.first.<field>$`: a field from the step's first result row

**Insert value** next to a search, a condition or an action message (the email subject and message, and the event payload) lists the tokens that exist at that point and puts the one you pick at the cursor. A selection is replaced. With no cursor in the field, the token goes at the end.

**Tokens are substituted as quoted values**, so they can't be used to inject SPL commands or field names. `index=$run.param.idx$` runs as `index="<value>"`; a token you already put inside double quotes stays there. A token can't sit inside a ```` ``` ```` comment or right after a backslash (put the backslash in the value), and a parameter or result value containing a backtick fails the step. Pass a step's full results with `| loadjob $daily.sid$`, so nothing runs twice. A step can't call `| orchestrate`; use a start-job action instead. Any other `$` text in SPL, such as `rex "foo$"`, is left alone. A token from a skipped step fails the step that uses it, unless you give a default: `$weekly.sid|none$`.

### Parameters

Declare each parameter with a type (string, number, enum or time) and an optional pattern. Values are checked when a run starts, and every value goes into SPL as one escaped, quoted string.

### Triggers

| Trigger | How |
|---|---|
| Schedule | A **Schedule** node on the Flow tab, in the job's time zone. |
| Manual | **Run now** on the Jobs page. |
| Search | `\| orchestrate start job=<id> param.<name>=<value>` |
| Alert | The "Start orchestrator job" alert action. The alert must be owned by a real user who may run the job, not `nobody`. |
| REST | `POST /services/orchestrator/jobs/<id>/runs` |
| Job completion | "After job X succeeds" or "completes". |

- **Schedules** are picked from presets: **Hourly**, **Daily**, **Weekly**, **Monthly** or **Custom** (a cron expression). The editor shows a readable summary, such as "Every day at 01:00", and the next times it will fire. A cron no preset matches opens as Custom and is never rewritten. A job can have more than one schedule.
- **Time zone** is on the Settings tab, picked from a list that includes UTC. A stored zone the list lacks stays selected; the server decides if it is valid. Empty uses the server's time zone.
- **"Completes" also fires when the upstream run is cancelled**, not only when it succeeds or fails.
- Each upstream run starts the downstream job once. A chained run uses the upstream run's scheduled time.
- **Missed runs:** if Splunk or the engine was down at a scheduled time, choose to run each missed time (up to 7), only the latest, or none.

### Actions

Each action is a node. Drag a line to it from a step's **+** handle, or from the **Whole job** node's for a job-wide action; the line's outcome says when it fires (Starts, Succeeds, Fails, Finishes either way or Is delayed). An action's **When** field moves its line from the keyboard.

- **Webhook** or **Slack** to a destination your admin set up (Slack is a body format).
- **Email**, **event to an index**, **start another job**, or **any installed alert action**. Pick the alert action from the list, which shows the enabled custom alert actions this app can use. Built-in actions such as email can't run this way. Its parameters then appear as labelled fields, taken from the form the action shows in Splunk's alert editor. A field left empty uses the action's own default. **Other parameters** takes anything the form doesn't list, one `name=value` per line; an action with no form or settings has only this box.

Action messages (email subject and message, webhook body, event payload and alert action parameters) take the tokens above, filled in when the action is sent, for example an email subject of `Daily rows: $daily.resultCount$`. A token with no value uses its default (`$weekly.sid|none$`) or is left empty. They also take `{{job}}`, `{{run_id}}`, `{{hook}}`, `{{step}}`, `{{status}}`, `{{run_url}}` and `{{message}}` (the default message). Webhook bodies are JSON-encoded after filling, and values sent to email, event and alert actions are escaped.

An action failing never changes the run's outcome; it shows on the run's Actions tab. If a job has no failure or delay action, your admin's fallback notification is used.

### Who may run

On the Access tab, list roles that may start the job. **Their runs search as you, with your access**, but only the SPL you saved. Role names you type are not checked, so check the spelling.

### When a step gives up

On the job Settings tab:

- **Wait for this run to be fixed** (default): later runs wait until someone re-runs or dismisses the failed run. A rollup can't run over a window with a missing day.
  While runs are held, runs turned away because the job's queue is full are reported in the daily hold alert, not one notification each.
- **Start later runs anyway:** later runs go ahead, so a weekly rollup may run with a day missing.

This setting is read from the job **as it is now**, not from the run's copy. Changing it affects runs already waiting.

### Job source

The **Source** tab, after Settings, shows the job as JSON text, so you can copy it, keep it in a file or paste it into another Splunk. Server fields (owner, created and updated details, hidden searches) are left out. Keys, strings, numbers and the SPL inside each `spl` value are coloured, in light and dark themes.

- **Copy** puts the text on the clipboard. If your browser blocks that, the text is selected and the tab says "Press Ctrl+C to copy".
- **Download** saves it as `<job id>.json` (`new-job.json` for a job that isn't saved yet).
- Edit the text, then choose **Apply changes**. The whole job is replaced as one step, so **Undo** brings the previous job back. Problems with the new job show in the issue list and on the tabs as usual. Syntax errors say where: "The source isn't valid JSON: ... (line 3, column 7)". The text must be a job object with `name` and `steps`.
- **Discard changes** puts back the text of the current job. If the job changes while you have unapplied edits (for example after Undo), your text is kept and the tab asks you to discard to see the latest.
- **The id is kept.** An `id` in the pasted text is ignored; the job keeps its own id, and the tab tells you so.
- If you can view a job but not edit it, the text is read only and only Copy and Download show.

Switching to another tab drops unapplied edits, so apply or copy them first.

To bring a job in from text, choose **Import job** on the Jobs page, paste the JSON or choose a `.json` file, and choose **Open in builder**. The job opens as a new, unsaved job (its id and server fields are dropped); choose **Save** to create it.

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
- **Steps that write:** previews never write to an index or a lookup. A **Summary index** or **Lookup** step can't be previewed (preview the step before it), and neither can a step whose search uses a command that writes: `collect`, `outputlookup`, `outputcsv`, `tscollect`, `mcollect`, `meventcollect`, `sendemail` or `delete`, after a pipe, also inside a subsearch `[ ... ]`. **Preview step** is dimmed and says why, for example "Previews don't write to indexes or lookups; remove collect to preview this step." With **Input from** set to live previews, the same goes for any step that would run first. Previewing from a past run still works when only an earlier step writes, since nothing before the step runs. Saved searches and macros are not expanded, so a writing command inside one is not caught: check them yourself before you preview.
- **Skipped steps:** if a run at that time would skip the step, you see "Would be skipped" and why. Steps after it treat it as skipped. **Preview anyway** runs it once with its inputs; steps after it still treat it as skipped, as a run would.
- **Job-wide errors:** a dependency cycle or a malformed job blocks every preview, since the editor can't work out which steps come first. The preview says which, for example "the job has a cycle: a → b → a; fix it before previewing". Other errors block only the previews of steps they touch.
- **Out of date:** changing a step, the time, the parameters or the input marks that step's preview and the ones after it "Out of date". The old table stays greyed until you preview again.
- **Limits:** a preview is cancelled after the step's max runtime, or 10 minutes if that is shorter. A preview you stop watching is cancelled after about three minutes. Finished previews are kept for 30 minutes while you use them. **Cancel** stops one early, together with the earlier steps' previews it started that are still running, unless another step's preview is waiting on them. Each step has one preview at a time: starting another cancels the first. The table shows 100 rows, but the search keeps all of them, so a later preview reads the full input.

## Follow runs

- **Jobs** shows each job with a summary line (when it runs and how many steps it has), its next run and last outcome, with Run now and an enable switch. **Find jobs** filters by name, id, owner or description. With no jobs yet, the page offers the templates to start from. **Create job** starts a new one. The switch never changes the job's owner. A next run more than about 400 days away shows as a dash. If you may edit a job, **Delete** removes it after you confirm. Cancel its active or queued runs first.
- **Runs** lists runs, filterable by job and state. The **Needs attention** state filter shows blocked and failed runs, and runs that hold later runs back.
- **Run detail** has a timeline, the graph, logs, actions and parameters. When a run needs attention, a line under the header says what to do next, such as re-running from the failed step. When a failed run is holding later runs back, **Dismiss run** lets them start. A warning message explains a delay, such as which step is late and what waits for it. Click a step for its attempts, actions and links to its search job and Job Inspector.

Statuses are plain text with an icon. **Delayed** is not a state: the work is still expected to finish. A step that a branch didn't reach shows as *Skipped (branch not taken)*.

| Run state | Meaning |
|---|---|
| Queued | Waiting behind an earlier run of the same job. Runs of a job never overlap. |
| Running | Steps are running or waiting on dependencies. |
| Blocked | A step failed with nothing to handle it. The run waits for a re-run, cancel or its deadline. |
| Paused | No new steps start; running searches carry on. |
| Succeeded, Failed, Cancelled | Finished. |

### Run health dashboard

**Run health** in the navigation bar is a dashboard over the audit index for the chosen time range (last 24 hours by default) and job (**All** by default):

- **Overview:** runs, succeeded, failed, held or blocked, the success rate of finished runs and the median run duration. A run counts by its latest state; **held** is a failed run that keeps later runs of its job waiting.
- **Runs over time**, stacked by state: succeeded green, failed red, held and blocked amber.
- **Runs that need attention:** failed, held and blocked runs with the last step error. Click a row to open the run.
- **Steps:** the steps that fail most, with the latest error, and the slowest steps (median and 95th percentile duration, and how many runs found the step delayed). Durations are measured to within one engine tick.
- **Actions:** sent and failed actions per type (email, webhook, Slack, event, alert action, start job, fallback notification), and the latest failures.
- **Engine health:** errors, warnings and Python tracebacks from the app's scripts in `_internal`, and how long ago the engine was last seen; that number turns red after 5 minutes. It needs read access to `_internal` and `_introspection`, which admins have.

### The run graph

The **Graph** tab on a run shows the job as the same flow you built, with each step's state and each action's result. Groups are always drawn expanded here, so no step is hidden. Click a step to open its details.

A strip above the graph shows the run's state with its icon and how long it has been going ("Running · 2 m 14 s"; the time ticks every second), a thin bar and how many steps are finished ("3 of 5 steps finished"; succeeded, failed and skipped steps count). While the run is active (queued, running, paused or blocked) it also says **Updates every 5 s**: the page asks the server for news every five seconds and the clocks tick in between.

While the run is active the graph is live:

- **Running steps** have a blue outline that pulses gently, a small spinner and a timer in their top-right corner ("0:31", or "1:02:05" past an hour).
- **Lines** show how the run went. A line that fired is solid in its outcome's colour. A line into a running step flows: thick blue dashes moving toward the step. A line that won't fire this run (its step finished with another outcome, or the next step was skipped as not taken) is thin, dashed and faded. A line whose step hasn't finished stays as drawn in the builder.
- **Row counts** ride on a finished search step's data lines ("1,204 rows →").
- **Finished steps** show their outcome and how long they took ("Succeeded · 1 m 2 s"). **Waiting steps** are dimmed and say what they wait for ("Waiting for Weekly rollup"). Skipped steps are dimmed with their skip reason.
- **Following:** the graph moves to keep the running steps in view. When you pan or zoom (drag, wheel, the zoom buttons, **Frame all** or the minimap), it stops following you; **Follow the run** in the toolbar turns it back on.
- **Reduced motion:** if your system asks for reduced motion, there is no pulse, spinner or moving dashes. Colours, timers and text stay.

A finished run shows the final picture, with no animation.

Actions say how they went in plain text, with the same icons as step states (a clock while retrying):

| Action text | Meaning |
|---|---|
| Sent | The action ran and succeeded. |
| Failed | The action gave up. The run's outcome doesn't change; the Actions tab has the error. |
| Sending… | An attempt is under way. |
| Retrying in 30 s | An attempt failed; the next one starts in the time shown, counted down. |
| Not sent yet | The step or job hasn't reached the action, or its first attempt hasn't started. |

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

Every change is written to the `orchestrator` index. SPL conditions add `condition_dispatched`, `condition_evaluated` (with `edge` such as `daily>weekly` and `result` true or false) and `condition_failed` (with `error`). **Outside the app, and on Splunk Cloud, search `index=orchestrator`**; the `orchestrator_index` macro works only inside the app.

## Help in the app

**Help** in the app's navigation bar shows this guide. Many fields have a **Learn more** link that opens the matching section.
