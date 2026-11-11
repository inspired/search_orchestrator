# Schedule timeline: design

Date: 2026-11-11. Extends `2026-11-05-search-orchestrator-design.md` (the base spec). Marked **(owner)** = decided by the owner in conversation; **(builder call)** = my call, open to correction.

## 1. Intent

Today you can see one run at a time on the run page's Timeline. Nothing shows the whole picture: what ran, what failed, what is running and what will run next, across all jobs. The owner wants that view **(owner)**.

The main reason is **planning**. Before adding or changing a schedule, the owner wants to see where the busy and quiet times are, so they don't schedule too many things at once **(owner)**. Seeing what ran, failed or will run is the second use **(owner)**.

There are two parts on one shared calculation:

1. A **global timeline** on the Runs page: one row per job and one bar per run, past and future.
2. A **busy-times strip and time suggestion** in the job builder, next to each cron schedule **(owner)**.

## 2. Goals, non-goals, anti-goals

**Goals**

- See every visible job's past, running and scheduled runs on one time axis, with a window of 24 hours or 7 days **(owner)**.
- See at a glance how many searches overlap at each moment **(owner: a run with several searches running in parallel counts as several)**.
- While editing a cron schedule in the builder, see the load around its slots and get a suggested quieter time nearby **(owner)**.
- Look like the run page's Timeline and Splunk UI Toolkit / Dashboard Studio designs **(owner)**.

**Non-goals (first version)**

- A heatmap or other summary view for very many jobs. The owner picked swimlanes **(owner)**. A heatmap can come later if rows become too many.
- Moving or rescheduling a job automatically, or from the timeline.
- Projecting manual, REST or search-command runs (they have no schedule).
- Exact projections of how long future runs will take. These are estimates.
- Drag-to-zoom, or a range picker beyond 24 h / 7 d plus back/forward paging.

**Anti-goals**

- **A suggestion that changes a schedule without the user's say-so.** Some jobs must start or finish at a fixed time, so suggestions are only hints **(owner)**. Saving is never blocked or warned about because of load.
- A suggestion that changes a schedule's days, or moves it far from what the user typed.
- A view that shows names, ids, run details or links for jobs the user may not view. Their runs show anonymously (section 3).
- A view that looks foreign next to the per-run Timeline: new colours, chart libraries or a different row style.

## 3. The load calculation (shared)

Both parts use one server-side projection over a time window `[from, to)`. Cron expansion already lives in Python (`so/cron.py`: `parse`, `slots_between`), so this runs on the server and the UI only draws **(builder call)**.

**Past and current runs.** Runs whose life overlaps the window: created, queued or started before `to`, and ended after `from` or still active. Each run's embedded step states (`run.steps[*].started_at/ended_at`) give exact search intervals. Every step that ran counts as one search for the time it ran. A step still running counts until now **(builder call)**.

**Future runs.** For each enabled job with enabled cron triggers, `slots_between(spec, max(now, from), to, job.timezone)` gives the start times. Each projected run gets a **profile**: each step's start offset and duration relative to the run's start. The profile is built per step from that step's most recent succeeded attempt **(builder call)**. A step with no history falls back to the step graph: it takes a default of 60 s and starts when its predecessors finish, limited by `max_searches_per_job` **(builder call)**. A projected run is marked `estimated` and says which profile it used.

**Step "Run when" conditions.** `run_when` is a per-step condition (`steps[*].run_when`), not part of the trigger cron. For each projected slot, a step whose `run_when` is `kind: cron` and doesn't match that slot is left out, along with any steps that would then be skipped (the same skip rules the engine uses). A step whose `run_when` is `kind: expression` can't be judged ahead of time, so it is **counted** **(builder call: overstating the load is the safer side for planning)**. The builder strip's "doesn't run every day → 7 days" rule also applies when any step's cron `run_when` limits the days.

**Demand, not a queue simulation.** The projected load is raw demand: overlapping searches added up, with no modelling of the engine queueing searches above `max_searches` **(builder call)**. Past load can't go above the line, because the engine queued the extra searches. Projected load can, and that's the point: it shows where you'd go over. Past bars that sat queued keep the existing hatched "waiting" style, so queueing that actually happened stays visible.

**Very frequent jobs.** A job whose runs would be packed tighter than about 3 px apart at the current window width is returned as merged **spans** for that row ("every 5 min, 00:00–24:00") instead of separate runs **(builder call)**. The load series is still computed from every run, so it stays exact. There is a hard cap of 500 run entries per job per response. Anything above the cap is merged into spans.

**Time zones.** The global timeline uses the browser's time zone and labels which one. The builder strip and the suggested time use **the job's time zone** (or the server's when that's empty), the same as the cron fields, so "02:40" means what the cron means **(builder call)**.

**Active runs.** A run still going counts until its estimated end (running steps until their profile duration, waiting steps at their offset), and the runs it will trigger are projected too.

**Dependent jobs.** A job with a completion trigger ("after job X succeeds/completes") gets a projected run that starts at the projected end of each projected run of X. Its steps are decided at the upstream run's *scheduled* time, as the engine does. A job with several completion triggers on the same upstream fires once per upstream run. It is placed the same way as any other projected run, and chains are followed to the existing chain depth limit **(builder call)**. Projected dependent runs are marked as such.

**Load series.** The number of searches active at each moment, across all projected and actual intervals, returned as change points (time, count). The UI draws it as a step shape. The global `max_searches` setting comes back with it as the reference line.

**Visibility.** Jobs the caller may view (`authz.can_view`, the same rule `list_runs` uses) show normally. Jobs the caller **may not** view still show, with their runs, but **without their names** **(owner)**. Each one gets an anonymous row labelled "Hidden job" plus a number. The numbers are stable within one response only. The server replaces the job id with an opaque token, so neither the id nor the name reaches the browser. Hidden rows have no link to the job or its runs. Their tooltips show only times, state and "estimated", with no run id, parameters or step names **(builder call)**. The load series counts everything. Rows are nested (upstream) only when both jobs are visible, since nesting would reveal the chain. Runs of deleted jobs keep today's rule (`_deleted_job_run_visible`).

**Cost.** One request covers at most 8 days of window. The server reads runs with a time filter, not a "newest 200" list. The 7-day view of a busy install may return thousands of runs, so the response is compact: per run, an id, a job id, a state, a start and end, and the step intervals as a flat array. The builder picks the exact shape.

## 4. Part 1: the global timeline (Runs page)

**Where.** The Runs page gets a toggle between **Table** (today's view, the default) and **Timeline** **(builder call)**. The choice is kept in the URL (`?view=timeline`) like the other filters. The existing search box filters the timeline's rows by job name too. The state filter applies to past runs only.

**Window.** "24 hours" or "7 days" (a segmented control). The default view puts *now* at about one-third from the left, so more of the future shows, because the main use is planning **(builder call)**. Back/forward buttons page by one window, and a "Now" button returns. Times show in the browser's time zone, with the axis labelled in hours for 24 h and in days plus hours for 7 d.

**Layout.** This follows the run page's Timeline (`features/run/Timeline.tsx`):

- The same grid: label column (job name, a link to the job), bar track, and a right-hand column. The right-hand column shows the job's next scheduled time, or its last run's status (via `StatusText`) when nothing is scheduled in the window.
- The same track: `backgroundColorSection`, 18 px high, radius 3 px, with bars inset by 2 px.
- The same fills from the Splunk theme: done = `contentColorMuted`, failed = `statusColorHigh`, delayed = `statusColorMedium`, running = `contentColorDefault`, queued/waiting = the existing hatched pattern.
- **Scheduled (future) bars** are new: a 1.5 px dashed outline in `borderColorStrong` with no fill. Projected dependent runs use the same style.
- A vertical "now" line in `contentColorActive` (or the closest theme token) across all rows.
- Hovering a bar shows a tooltip with the job, run state, start, end or estimated duration, and "estimated" for future bars. Clicking a past or running bar opens its run page. Future bars don't link.

**Load row.** A fixed row above the job rows, labelled "Concurrent searches". It is drawn as a step shape in the track using the load series, in the same 18 px row style or a little taller (up to 36 px) so it can be read **(builder call)**. A thin line marks `max_searches`, and any part above it uses `statusColorMedium`. Hovering shows the count at that moment.

**Rows.** One row per visible job that has a run or a projected run in the window, sorted by name **(builder call)**. The rows render in a plain scrolling list. Virtualise only if a live check with hundreds of jobs shows it's needed. A dependent job sits directly under its upstream job, indented with "↳". A job with several upstreams sits under the first one in name order. Jobs with nothing in the window are hidden, and a one-line note counts them. Bars that overlap in one row (a run started before the previous one ended) stack in the same track: later bars draw on top, and their outline keeps them distinguishable.

**Refresh.** It polls with the same rhythm as the table: 5 s while anything is active, 30 s otherwise.

**Empty / error.** These use the same `Message` patterns as `RunsPage`.

## 5. Part 2: busy-times strip and suggestion (job builder)

**Where.** In `TriggersTab.tsx`, under each cron schedule's Cron field.

**Strip.** A track in the same row style that shows the projected load from **all other jobs**, so the job being edited is left out of the count. It covers the next 24 hours, or the next 7 days when the schedule doesn't run every day (for example `0 2 * * 1`) **(builder call)**. This schedule's own projected runs are drawn on top as bars in `contentColorDefault`, using the job's own profile. The `max_searches` line is shown. It updates after the user stops typing (the existing `useDebounced`), and a cron expression that isn't valid shows nothing beyond the field's existing validation.

The draft job may be unsaved, so the builder sends its draft (job id if saved, triggers, timezone, steps and edges) to a projection endpoint. It does not reload a saved job **(builder call)**.

**Suggestion.** Only for a schedule with exactly one minute and one hour value. Days, months and day-of-week can be anything. A schedule like `*/5 * * * *` gets the strip only **(builder call)**. The server tries other start times within **±2 hours** of the typed time, in 5-minute steps **(builder call)**. For each one, it scores the peak load that this job's runs would meet across the window, using the job's profile. It suggests the closest time whose peak is clearly lower. "Clearly" means at least 2 searches lower, or no longer over `max_searches` **(builder call)**. The hint reads, for example:

> Quieter nearby: **02:40**, with up to 3 other searches running instead of 9. [Use this time]

"Use this time" rewrites only the minute and hour fields of that cron expression. The hint can be dismissed for that schedule during the editing session. Nothing else changes, and saving is never affected (anti-goal).

## 6. API

The new route is in `api.py`'s `_routes()` **(builder call; exact names are the builder's)**:

- `GET schedule?from=<epoch>&to=<epoch>` returns visible runs (actual and projected) grouped by job, the load series and `max_searches`. Window ≤ 8 days.
- `POST schedule/preview` takes a draft job definition and a window. It returns the load series with that job left out, that job's projected runs, and a suggestion if one applies.

The client functions go in `api/client.ts` and the types in `api/types.ts`. Permissions are the same as for viewing runs and editing a job, respectively.

## 7. Testing

- Python unit tests for the projection: cron slots with timezones and run-when days, profile from the last succeeded run, the graph fallback, dependent chaining, the load series from overlapping intervals, the visibility filter, and suggestion scoring (including "no suggestion" when nothing is clearly quieter, and never outside ±2 h).
- UI tests in the style of `timeline.test.tsx`. Keep the bar layout pure (like `bars.ts`) so positions, kinds and the dashed future style can be tested without rendering. Test the toggle, URL state and the builder strip's "Use this time", which must change only minute and hour.
- A live check on a dev Splunk with a few cron jobs, recorded in docs like earlier features.

## 8. Left to the builder

The exact response shape, the component split, the tooltip component (prefer `@splunk/react-ui` Tooltip), the axis tick density, the visual details of the load row within the constraints above, how projections are cached per request, and the docs updates (`user-guide.md`).

## 9. Open questions

None. Visibility was settled by the owner: hidden jobs show, without names (section 3).
