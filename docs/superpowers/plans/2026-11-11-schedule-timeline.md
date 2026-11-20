# Schedule Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global past/future timeline on the Runs page and a busy-times strip with a time suggestion in the builder, both from one server-side load projection.

**Architecture:** A pure module `so/schedule.py` projects runs (history + cron slots + completion chains) and computes the load series and suggestions. `api.py` exposes `GET schedule` and `POST schedule/preview`. The UI adds `features/schedule/` (pure layout + components that reuse the run Timeline's row style) and a `BusyStrip` in the builder's Triggers tab.

**Tech Stack:** Python 3 (pytest, FakeGateway), React 18 + TypeScript, @splunk/react-ui, @splunk/themes, jest + testing-library.

**Spec:** `docs/superpowers/specs/2026-11-11-schedule-timeline-design.md`

## Global Constraints

- Window ≤ 8 days per request. Views: 24 h and 7 d.
- Search count = each step running counts as one search.
- Fallback step duration 60 s, limited by `max_searches_per_job`.
- Suggestions: one minute + one hour value only; ±2 h in 5-minute steps, same day; "clearly quieter" = peak ≥ 2 lower, or no longer above `max_searches`.
- "Use this time" changes only cron fields 1–2.
- Hidden jobs: label "Hidden job N", opaque id, no run ids, no links.
- At most 500 run entries per job per response. Runs closer than window/400 merge into spans (failed and running runs never merge).
- Theme tokens only. Future bars: 1.5 px dashed `borderColorStrong`, no fill.

## Review Focus

- A job with an invalid cron or bad `run_when` → skipped / step counted, never a 500.
- A window straddling a DST change → slots come from `cron.slots_between`, so they follow its rules.
- A completion chain that loops (A after B, B after A) → stops at `CHAIN_LIMIT`.
- A user with no visible jobs → hidden rows only, load still correct.
- An unsaved draft (no id) in `schedule/preview` → treated as a new job, and the caller needs build rights.

---

### Task 1: Projection core (`so/schedule.py`)

**Files:** Create `app/search_orchestrator/bin/so/schedule.py`, `tests/test_schedule.py`

**Produces:**
- `profile(job, history_runs, max_per_job) -> {step_id: (offset, duration)}`
- `steps_for_slot(job, slot) -> set[str]`
- `project(job, prof, start, end, now) -> [{"start","end","steps":[(s,e)]}]`
- `project_dependents(jobs, projected, start, end) -> {job_id: [...]}` (chains up to `CHAIN_LIMIT`)
- `run_intervals(run, now) -> [(s,e)]`
- `load_series(intervals, start, end) -> [[t, n], ...]`
- `merge_dense(bars, start, end) -> bars` (spans have `kind: "span"` and `count`)
- `suggest(job, trigger_cron, prof, other_load, start, end, max_searches) -> dict | None`

- [ ] Tests: profile from history vs fallback (60 s, cap); run_when cron drops a step on non-matching days and expression steps are counted; project uses slots in tz; dependents start at upstream end, loop stops; load series counts overlaps; merge keeps failed runs; suggestion within ±2 h, none when not clearly quieter, none for `*/5`.
- [ ] Implement, pass, commit.

### Task 2: API routes

**Files:** Modify `app/search_orchestrator/bin/so/api.py` (routes + `get_schedule`, `schedule_preview`), `tests/test_api.py`

- [ ] Tests: visible vs hidden rows (no names/ids/run ids for hidden), load counts hidden jobs, window clamp/400, preview needs edit rights, preview excludes the draft's own job from the load, returns a suggestion.
- [ ] Implement, pass, commit.

### Task 3: UI client, types, pure layout

**Files:** `ui/src/api/types.ts`, `ui/src/api/client.ts`, create `ui/src/features/schedule/layout.ts`, `ui/src/__tests__/scheduleLayout.test.ts`

- [ ] Types `ScheduleResponse`, `ScheduleJob`, `ScheduleBar`, `SchedulePreviewResponse`; `getSchedule(from,to)`, `schedulePreview(job)`.
- [ ] `layout.ts`: `pct(t, from, to)`, `barStyleKind(bar)`, `loadSegments(load, from, to, max)`, `withTime(cron, hour, minute)`.
- [ ] Tests, pass, commit.

### Task 4: Global timeline on Runs page

**Files:** create `ui/src/features/schedule/LoadRow.tsx`, `ScheduleTimeline.tsx`, `SchedulePanel.tsx`; modify `ui/src/features/runs/RunsPage.tsx`; test `ui/src/__tests__/ScheduleTimeline.test.tsx`

- [ ] Table/Timeline toggle kept in `?view=`, 24 h / 7 d, paging, Now, polling, tooltip, links for visible runs only.
- [ ] Tests, pass, commit.

### Task 5: Builder busy strip + suggestion

**Files:** create `ui/src/features/builder/BusyStrip.tsx`; modify `TriggersTab.tsx`, `JobTabs.tsx` if props needed; test `ui/src/__tests__/BusyStrip.test.tsx`

- [ ] Debounced `schedulePreview`, strip in job tz, hint text, "Use this time" rewrites minute/hour only, dismiss.
- [ ] Tests, pass, commit.

### Task 6: Docs, changelog, package

- [ ] `docs/user-guide.md` section, `CHANGELOG.md` entry (unreleased 1.6.0), `scripts/package.sh 1.6.0`, typecheck, full test runs.
