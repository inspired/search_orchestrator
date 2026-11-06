# Step preview and the "From previous steps" type: design

Date: 2026-11-06. Extends `2026-11-05-search-orchestrator-design.md` (the base spec); section numbers like §7 refer to it. Marked **(owner)** = decided by the owner in conversation; **(builder call)** = my call, open to correction.

## 1. Intent

While building a job, the author wants to try each step and see its real output without saving or running the job **(owner)**. A chain is built one step at a time: preview the daily step, see its rows, then write the weekly step and see what it does to those rows **(owner)**. Writing `| loadjob $daily.sid$` by hand is boilerplate, so a new step type fetches the previous steps' results automatically, and it previews the same way **(owner)**.

## 2. Goals, non-goals, anti-goals

**Goals**

- A **Preview step** button for every step type: Search, Saved search and the new From previous steps **(owner)**.
- A later step's preview uses earlier steps' results from either live previews made in this editing session or a real past run of the job **(owner)**.
- A new step type, **From previous steps**, that reads all of its dependencies' results in front of the author's SPL, both in preview and in real runs **(owner)**.
- The existing Search type keeps working unchanged, including `$step.sid$`, `$step.first.<field>$` tokens and hand-written `loadjob` **(owner)**.

**Non-goals**

- Previewing the whole job in one click as a dry run with actions. Actions never run from a preview **(builder call)**.
- Saving preview results or showing them to other users.
- Previewing in the run view; previews live only in the Job editor.

**Anti-goals**

- A preview that runs with more access than the person clicking it. Previews must never run as the job owner on someone else's behalf, or as the system user.
- A downstream preview silently built on stale or truncated upstream results.
- A preview that leaves long-lived search jobs behind or competes with real runs for a long time.

## 3. The editor **(owner: layout B)**

- The top of the editor gets a preview bar for the whole job:
  - **Preview as if scheduled at**: a date-time. It defaults to the most recent time the job's schedule would have fired, or now if the job has no schedule **(owner)**. Changing it lets the author preview another day.
  - **Run parameters**: one input per declared parameter, prefilled with its default, validated as in §7 **(owner)**.
  - **Input from**: either `Live previews` (default) or one of the job's past runs. The list shows the most recent runs, newest first, labelled with the scheduled time and state **(owner)**. Choosing a run also sets "as if scheduled at" to that run's scheduled time and fills the parameters from the run **(builder call)**, so a step previews against the same window its inputs came from.
- The step panel (right side) gets a **Preview step** button under the search box and, under that, the preview result: a line such as "3 rows · 0.4 s · input: daily preview, 2 min ago", then the results table **(owner)**.
- On the graph, each previewed step shows a short plain-text note ("✓ 7 rows", "previewing…", "preview failed"). No filled pills (base spec §11).
- A running preview has a **Cancel** button **(builder call)**.
- Search errors and warnings from the preview search appear as a SUIT `Message` above the table, using the same rule as runs: an ERROR message counts as a failed preview.

## 4. How a preview runs

- **As the person clicking**, through their own session, as an ordinary ad-hoc search (`search/jobs`), never through the hidden saved searches and never as the job owner or system user **(builder call)**. It sees exactly what the author can see. The step panel says, in small text, that real runs use the owner's access, which can differ. In practice the author is the owner or an admin, because only they may edit the job (base spec §9).
- Only users who may edit the job can preview it. The editor sends the unsaved definition, so previews work before the first save.
- **Time**: the step's earliest and latest resolve against "as if scheduled at", exactly as for a real run (§6), using the search's `now` parameter.
- **Tokens**: compiled exactly as for a real run (§7, quoting and escaping included), but resolved from the chosen input:
  - Live previews: `$daily.sid$` is the sid of daily's latest valid preview; `$daily.resultCount$`, `$daily.status$` and `$daily.first.<field>$` come from that preview.
  - A past run: the values that run recorded for its steps.
- **Saved search steps** preview by running the same `| savedsearch` wrapper a real run would use, as the author **(builder call)**. A directly dispatched saved search (base spec §9, first case) previews through the wrapper as well, so its own actions and summary indexing never fire from a preview.
- **Limits** **(builder call)**:
  - The preview job is not row-capped, because a downstream preview may `loadjob` it, and a truncated input would silently change downstream results. Only the table shows at most 100 rows, with "showing 100 of N".
  - A preview is cancelled after the step's `max_runtime`, or 10 minutes if that's shorter, and the panel says so.
  - Preview jobs keep a TTL of 30 minutes, refreshed while the editor is open and using them.
  - One preview at a time per step; starting another cancels the first.
- Previews write an audit event `preview_dispatched` (job id, step id, user, sid). Preview searches carry a label naming the job and step, so they're recognisable in the Job Inspector.

## 5. Live previews and staleness **(owner)**

- A step's live preview is **valid** while the step's definition, its time window inputs ("as if scheduled at", parameters), and the previews it read from are all unchanged, and while its search job still exists.
- Previewing a step whose dependencies have no valid preview first previews those dependencies, in dependency order, then the step. Their results appear on their own steps when the author selects them.
- Changing a step marks its preview and everything downstream as stale. Stale previews keep their table, greyed, with "out of date" until re-run **(builder call)**.
- Live previews are tracked in the browser tab only; leaving the editor discards them. The server keeps no preview records (§9a) **(builder call)**.

## 6. Input from a past run

- Any of the job's runs can be chosen whose step results still exist on the server. These are kept for 24 hours after the run ends by default (§7) **(builder call)**.
- A step's preview reads the run's recorded results for its dependencies. The step itself is previewed fresh, using the current, possibly unsaved, definition.
- If a dependency's results have expired, the preview fails with "daily's results from that run have expired; switch to live previews or pick a newer run". It never falls back silently.
- A dependency that the run skipped is treated as skipped, as in a real run (next section and base spec §5).
- The author must be able to read the run's search jobs. That is true for the job's owner and for admins. If Splunk refuses, the preview fails with that error.

## 7. The "From previous steps" type **(owner)**

- A step type next to Search and Saved search. The author writes SPL that starts with a pipe, such as `| stats sum(count) as count by host`. Saving rejects SPL that doesn't start with `|`.
- The step must depend on at least one step; saving rejects it otherwise.
- The app puts the input in front of the author's SPL: the results of **every** step it depends on, one set after another, in the order the dependencies are listed **(owner)**. With one dependency, that is `| loadjob <sid>`. With several, the first is `| loadjob` and each further one is appended, as `| loadjob <a> | append [| loadjob <b>]` or an equivalent the builder picks.
- The step panel shows the generated input, read-only, above the search box, for example `| loadjob ‹daily›`.
- Tokens work in the author's part, as in a Search step.
- **A skipped or failed dependency** contributes no rows, and the others still load. If none contributes, the step runs with no input rows rather than failing **(builder call)**. See §9a.
- **Real runs** compile the same way, using the run's sids. Each `loadjob` sid gets the quoting from base spec §7. The hidden saved search holds the generated input with tokens, so nothing new is needed at dispatch.
- **Converting**: switching a Search step to this type keeps its SPL, and saving says what to change if it doesn't start with a pipe. Switching back to Search writes the generated `loadjob` text into the SPL, using `$step.sid$` tokens, so the step keeps working **(builder call)**.

## 8. Constraints

- Everything in the base spec's §13 still holds: Enterprise 9.4+ and Cloud Victoria, AppInspect clean, Splunk UI Toolkit components only, plain-text statuses.
- The preview endpoint is part of the existing REST API (`/services/orchestrator/...`), uses the caller's session and needs `orchestrator_build` or `orchestrator_admin`.

## 9. Testing and verification

- Unit tests for compiling the new type, including one, several and skipped dependencies, quoting, and conversion both ways.
- Unit tests for staleness: what an edit invalidates, and what gets previewed first.
- API tests: who may preview, that a preview runs as the caller, past-run input including expired and skipped dependencies, and the limits.
- Self-test: `| orchestrate selftest` gains a From previous steps step with two dependencies, so the base server check covers the real `loadjob`/`append` behaviour.
- Owner check on the server: in the editor, preview daily, then weekly from the live preview, then weekly from a past run, in both themes.

## 9a. Decisions from the builder check **(builder call unless marked)**

- **Run-when and edges in previews.** A preview resolves `run_when` and edge conditions against "as if scheduled at" exactly like a real run, reusing the engine's resolution code (pure functions, not a second copy). A step that a run would skip shows "Would be skipped tonight: runs on Mondays", and downstream previews treat it as skipped, so `$weekly.sid$` without a default fails, as in a run. The step offers **Preview anyway**, which previews it once with its inputs, labelled "previewed anyway" **(owner)**.
- **Upstream states.** A missing or stale upstream preview is previewed first, automatically (§5). A *failed* upstream preview stops the downstream preview with "daily's preview failed; fix it or preview it again". The downstream preview never re-runs a failed preview by itself.
- **What gets previewed.** Previewing a step validates the step and every step it depends on, directly or through tokens, plus the edges between them. Errors there block the preview. Errors in unrelated steps don't. A token naming a step that is not upstream is already a save error (base spec §7), so it is a preview error too.
- **Namespace and ownership.** Preview searches are dispatched at `servicesNS/<caller>/search_orchestrator/search/jobs`, the same namespace the run artifacts use, so `loadjob` finds the caller's preview sids. Live-preview input therefore always works. For past-run input, the first build task checks on the server whether an admin can `loadjob` another owner's run artifacts. If not, past runs are offered only to the run's owner, and others see the run list greyed out with the reason, rather than failing later.
- **Server state and timeouts.** The server keeps no preview records and no new collection. Each preview search is dispatched with `auto_cancel` of 180 seconds, so it is cancelled if the editor stops polling, for example when the tab is closed. It has a `ttl` of 30 minutes once done. Every poll lets the REST handler cancel a search past its time limit. Each poll and each use as an input extends the TTL with `touch`. Cancel is an explicit call with the sid. The handler accepts only sids whose label marks them as this user's preview of this job.
- **Staleness inputs.** A step's preview is valid while all of these are unchanged: the step's effective definition, including inherited job defaults; "as if scheduled at"; the parameters the step references; the preview of each step it reads, directly or through tokens; and the input source. The default "as if scheduled at" is computed once when the editor opens, so it never changes by itself. Changes to the schedule, to unrelated steps, or to actions don't make a preview stale.
- **From previous steps: which dependencies contribute.** A dependency contributes its rows when it succeeded. A dependency that failed (reachable through an `on_failure` or `always` edge) or was skipped contributes no rows. Order follows the step's dependency list. With nothing to load, the generated input yields zero rows. The first task picks and checks the exact SPL on the server.
- **No silent truncation (anti-goal).** Several dependencies must be combined with a form that has no subsearch row or time limit, or, if the server only offers limited forms, the step fails loudly when a limit is reached and says which one. It never passes on a cut-down set of rows. The first task verifies this with inputs above 50,000 rows.
- **Saved search steps.** The preview uses the step's time-range override if it has one, otherwise the saved search's own range, as a run does. If the author can't run the saved search, the preview fails with Splunk's error. That is accepted, because previews run as the author.

## 10. Left to the builder

- The exact SPL used to append several dependencies, verified on the server (`append` subsearch limits, or `union`, or `multisearch`).
- The REST shape of preview, poll, cancel and results, and whether the browser polls or the server waits.
- Whether the "as if scheduled at" default uses the cron parser already in the engine.
- How preview jobs' TTL is refreshed while the editor is open.
