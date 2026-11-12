# Dependent reports: design

> **Removed (2026-11-12).** Shipped in 1.5.0 and taken out after it: the report had to be rewritten around `$args.so_input$` and then no longer ran outside a job, which left little reason not to keep the search in the job as a From previous steps step. Direct-mode crash recovery needed proof of each job's input from its search text, which relied on undocumented Splunk behaviour. Kept: reading `dispatch.now` from the search ID and never adopting `scheduler__` jobs (section 6). The `read_previous` field is now ignored. This document is kept as a record.

Date: 2026-11-09. Extends `2026-11-05-search-orchestrator-design.md` (the base spec) and `2026-11-06-step-preview-design.md` (From previous steps and previews). Marked **(owner)** = decided by the owner in conversation; **(builder call)** = my call, open to correction.

## 1. Intent

Search Orchestrator already runs dependent searches as one unit. The owner wants the same for reports: report A runs first, and when it has completed, report B runs and uses A's results **(owner)**. It should re-use the search dependency patterns where they fit **(owner)**.

A report is a Splunk saved search, and a job can already run two reports in order with two Saved search steps and a connection. The missing part is the data: a Saved search step always runs a fixed search and receives no values at run time. This design adds that one thing.

## 2. Goals, non-goals, anti-goals

**Goals**

- A Saved search step can read the results of the one step connected before it, in real runs and in previews **(owner: first version)**.
- The job runs report A itself, and report B reads that run by search ID **(owner: first version)**.
- One report text works whether the step runs directly or through the wrapper **(builder call, made possible by test 1 in section 8)**.
- A report run directly keeps its own summary indexing and alert actions, as Saved search steps do today.

**Non-goals (first version)**

- Reusing a run of A made by its own schedule. `/history` makes this possible, but it needs a waiting state, a rule for choosing the run, access checks and result-lifetime handling. Section 8 records what the live tests found, for later.
- More than one input per report. Passing `| append [...]` in one argument failed on real Splunk (section 8).
- Passing `$step.first.<field>$`, `$run.param.<name>$` or any other value into a report through this feature.
- Passing results between whole jobs.
- Showing report B's rows on the run page.
- Making an edited report B still runnable outside a job (section 3).

**Anti-goals**

- Report B succeeding without having read A's results. This would be a wrong report that looks right.
- Any value other than a validated search ID reaching report B's SPL through this feature.
- Running report A twice to produce one result.
- A new way of starting searches. Runs keep dispatching through saved searches only (base spec, section 9).

## 3. What the report author does

1. Edit report B so it reads its input from the placeholder, with no quotes around it:

   ```
   | loadjob $args.so_input$ | stats count by host
   ```

   The placeholder may appear more than once, for example inside a subsearch. A report can't be handed rows from outside, because `| savedsearch` is a generating command, so this edit can't be avoided.
2. Add B as a Saved search step and tick **Reads the previous step's results**.
3. Connect exactly one step before it.

Consequences to document for users:

- B no longer runs on its own. Outside a job Splunk has no value for the placeholder, and running it through `| savedsearch` fails with "Error while replacing variable name".
- B must have no other placeholders. A wrapped run fails on any it can't fill, with the same Splunk error.
- A wrapped report's own summary indexing and alert actions still don't run, as today. Use job actions instead.
- Opening a wrapped report B in Splunk doesn't show the orchestrated results, because they belong to the hidden wrapper's search job. What the report page shows after a direct run hasn't been checked (section 9).

## 4. Job definition

One new optional field on a step **(builder call on the name)**:

| Field | Type | Meaning |
|---|---|---|
| `read_previous` | boolean, default false | Valid only on `saved_search` steps. The step reads its one upstream step's results. |

Jobs are stored as whole JSON documents, so there is no KV Store schema change, and existing jobs behave exactly as before. Runs carry the field in their definition snapshot as usual.

## 5. Validation

**At save, without Splunk** (`model.py`, mirrored in `graphLogic.findIssues` where it overlaps):

| Code | Level | Rule |
|---|---|---|
| `bad_shape` | error | `read_previous` is present and not a boolean. |
| `bad_step` | error | `read_previous` is true on a step that isn't `saved_search`. |
| `report_input_needs_one` | error | A `read_previous` step doesn't have exactly one distinct upstream step (`tokens.previous_inputs`). |
| `report_input_may_be_missing` | warning | The upstream step can be skipped or fail and the step still runs: an edge condition other than `on_success`, or an upstream step in the existing `skippable` set. |

**At save, with the user's session** (`hidden._saved_search`, so previews get it too):

| Code | Level | Rule |
|---|---|---|
| `report_missing_input` | error | The report's SPL doesn't contain `$args.so_input$`. |
| `report_input_quoted` | error | The placeholder is directly inside double quotes (`"$args.so_input$"`). The value already carries its own quotes. Best effort: a placeholder deeper inside a longer quoted string isn't caught, and that run fails in Splunk. |

Both messages say what to write: `| loadjob $args.so_input$`. The report text comes from `gateway.report_search(owner, name)`, which reads the owner's namespace in this app (`/servicesNS/<owner>/search_orchestrator/`), where dispatch and `| savedsearch` resolve the name. It isn't taken from the entry `saved_search_info` selects, because that lookup spans all apps and may pick a different report. A 403 or 404 gives None.

**At dispatch.** Report B can be edited after the job is saved, and a report that lost its placeholder would otherwise succeed without reading A. Following `Engine._direct_problem`, the engine re-reads the report right before each dispatch of a `read_previous` step, in both modes, and applies the same two checks. A failed check fails the attempt with a message naming the report. It reads the text with `report_search`, as at save. A transient lookup error leaves the step `starting` and is checked again next tick, as `_direct_problem` does; a non-transient one fails the attempt. A report that is gone or unreadable fails the attempt with `saved search '<ref>' was not found or can't be read, so it was not run`.

## 6. How a run works

The upstream dependency, ordering, retries, re-runs and result keep-alive are unchanged. `Engine._expired_upstream` and `preview.reads` already follow connections, so they need no change.

**Hidden search** (`hidden._saved_search`). The mode rule is unchanged. With `read_previous`:

- `wrapped`: the wrapper becomes `| savedsearch "<ref>" args.so_input="$args.so_input$"`. It's hashed into the hidden search name as usual.
- `direct`: `hidden_search` remains the report itself.

**Dispatch** (`Engine._dispatch`, `Engine._render_args`). `_input_sids` already means "this step's dependencies that succeeded", and is used as is. For a `read_previous` step:

| Case | Behaviour |
|---|---|
| No input succeeded | The attempt fails: "Report step `<id>` needs the results of step `<up>`, which did not succeed" **(builder call)**. Only reachable through a skip or a non-`on_success` connection, and the save warning covers those. |
| Direct | `args.so_input` is `tokens.input_spl(sids)`, for example `"<sid>"`. |
| Wrapped | `args.so_input` is `tokens.escape_spl_string(tokens.input_spl(sids))`, so the wrapper's quoted argument ends up exactly as in test 1. |

`input_spl` already rejects any search ID that doesn't match `^[A-Za-z0-9_.-]+$`, which is what keeps injection out (section 8, test 3).

Unchanged and deliberate:

- The step's Earliest and Latest still apply, unlike From previous steps, since a report may also search events.
- Direct runs keep `trigger_actions=1`.
- History adoption after a crash. Direct mode has no per-step name, so steps on one report share a history. Live check, 2026-11-10: Splunk keeps no `args.*` on a job, and history entries carry only `start`, `ttl` and flags. A job keeps `dispatch.now` as `request.now` and in its search ID (`..._at_<now>_<n>`), and its search with the arguments filled in. So `gateway.parse_history_details` reads the run time from the search ID, marks `scheduler__` jobs (never adopted), and a direct `read_previous` step fetches each history job's search (`gateway.job_search`) and looks for its own `tokens.report_input_value(sids, False)` in it, among the jobs dispatched for the run's scheduled time: a search containing it is adopted; one without it is another step's and is ignored; a search that can't be read can't be proven, so the job is never adopted, the step isn't re-dispatched while that lasts, and the outcome is unknown until `UNKNOWN_LIMIT` fails the attempt. If every job in history provably read something else the step dispatches; other jobs that ran but not for this scheduled time keep the outcome unknown. With no input or an invalid search ID there is nothing to adopt, and `_dispatch` fails the attempt. Steps without `read_previous` and wrapped steps, whose hidden search has its own name, are as before.
- A `read_previous` step's only argument is `so_input`. Nothing is rendered from its `spl`, which the builder keeps when a step switches type.
- The truncation check stays limited to `previous` steps. One input means nothing is appended.

## 7. Preview and builder

**Preview** (`preview_api._preview_search`). A saved-search preview already uses the wrapper. For a `read_previous` step, fill the wrapper with `tokens.fill`, using the escaped value from `preview.input_sids`. With no input, return a `no_input` issue using the dispatch message. The existing "preview the earlier step first" and past-run flows already work from connections.

**Builder.**

- `StepPanel`: under the Saved search field, a **Reads the previous step's results** control, with help text giving the `| loadjob $args.so_input$` line and "connect exactly one step before it". Time range fields stay.
- `reducer`: changing a step's type away from Saved search clears `read_previous`.
- `graphLogic.findIssues` and `api/types.ts`: the new field and the upstream count check.
- Which control to use, and the exact wording, are left to the builder.

## 8. Evidence from real Splunk

Splunk 10.6.1.1, 2026-11-09, read-only, as an admin user.

| Test | Result |
|---|---|
| 1. `\| savedsearch` with `args.so_input="\"SID\""` into a hidden `\| loadjob $args.so_input$` search | Worked: all 201 rows loaded. Dotted argument names work. |
| 2. Same, with `"SID" \| append [\| loadjob "SID"]` as the value | Failed: "Could not find variable in the argument map" for the argument after it. |
| 3. A value containing an escaped quote and `\| eval injected="yes` | `injected=yes` appeared. A value escaped once can still break out of the report's quotes. |
| 4. Truncation through a nested search | Not tested: failed the same way as test 2. |
| `/history` on a scheduled report | Lists search IDs with done, finalized and zombie flags, published time and time to live. No row count, failure flag or `dispatch.now` was seen. |
| `loadjob` by search ID and by `savedsearch=` | Both work. `savedsearch=` returned the newest run, so it can't pin one. |

Why test 2 failed isn't proven. Test 3's value had a pipe but no brackets and worked, so brackets are the likely cause. Argument order wasn't varied.

For later reuse of scheduled runs: the slot time is in the search ID (`_at_<epoch>`). Published time isn't reliable: one run published 1 second after its slot, another 51 minutes after. `Engine._dispatched_for` falls back to published time, so it can't be used as is. Time to live ranged from about a minute to a day, and read access differed by report.

## 9. Testing

**Automated** (existing Python and Jest suites):

- `model`: each save rule in section 5, including the warning's triggers.
- `gateway` and `hidden`: the report text is read from the owner's namespace in this app; the wrapper text; direct mode unchanged; both placeholder errors.
- `engine`: direct and wrapped arguments, including escaping; no input fails the attempt; report edited after save fails the attempt; a transient lookup keeps the step `starting`; re-run with expired upstream results; a bad search ID is refused.
- `preview_api`: the filled search, no input, and the past-run flow.
- UI: the control, clearing on type change, the upstream count check.

**Live, before release, because automated tests can't show these:**

- A wrapped and a direct report B each read a real report A end to end. Direct mode with arguments hasn't been run on a report yet.
- A direct report B with an alert action still fires it.
- A report edited to drop its placeholder fails the step rather than succeeding.
- Done 2026-11-10: a direct report B read A (`total=15`, `count=5`), and its job's search was `| loadjob "<A sid>" | ...`. `args.so_input` is not kept on the job, which led to reading the search instead (section 6).
- Still open: whether the report's history, read as `splunk-system-user`, lists the jobs the app dispatched. Read as the report's owner, it listed only the owner's own run.
- What report B's page shows after a direct run, so the user guide can say.

## 10. Left to the builder

File layout within the modules named above, the helper that applies the placeholder checks, the exact messages except where quoted, and the user guide and changelog wording. Docs need a new section in `docs/user-guide.md`, next to From previous steps.

## 11. Separate from this work

An existing Search step can contain `| savedsearch "B" x=$run.param.y$`. Test 3 shows that a quote in that value can run SPL as the job owner if B uses the placeholder, and `$step.first.<field>$` has the same problem. This exists today and this design doesn't change it. It deserves its own save-time warning or block.
