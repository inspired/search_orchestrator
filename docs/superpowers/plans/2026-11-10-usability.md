# Usability pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Splunk user who has never seen the app can build, schedule and save the daily → weekly → monthly rollup with presets and pickers, and every save problem points to its field.

**Architecture:** Front-end work in `ui/src` with pure logic modules (`schedule.ts`, `timeRange.ts`, `duration.ts`, `tokens.ts`, `templates.ts`, `readiness.ts`) tested on their own, and thin SUIT components on top. Two small read-only REST routes on the server (`schedule/next`, `timerange/resolve`) so that cron and Splunk time syntax are only ever interpreted by the server. No engine or run-semantics change.

**Tech Stack:** React 18, TypeScript, `@splunk/react-ui` 5.18.0, `@splunk/themes`, Jest + React Testing Library; Python 3.9–3.13, pytest with `tests/fakes.py`.

**Spec:** `docs/superpowers/specs/2026-11-10-usability-design.md` (and the base spec `2026-11-05-search-orchestrator-design.md`).

## Global Constraints

- Work on branch `usability`. Push only to `origin` (`lyderhansen/search_orchestrator`, private). Never push to `upstream` (`inspired/search_orchestrator`).
- Only `@splunk/react-ui` 5.18.0, `@splunk/react-icons`, `@splunk/themes` components; no new npm dependencies.
- Sentence case for every label, button, tab, heading, option and modal title.
- Buttons start with a verb, 1 or 2 words. Destructive actions: `appearance="destructive"` and a confirming `Modal` whose title is a question.
- Errors say what is wrong and how to fix it. Field errors use `ControlGroup` `error`; server errors use `Message`. Never a placeholder in place of a label.
- No `Badge`, `Chip` or filled pill for run or step status (owner rule). Status stays plain text via `StatusText`.
- All colours from theme tokens (`useSplunkTheme`); both light and dark themes.
- Every new control sits in a `ControlGroup` with `labelFor`, or carries an accessible name.
- Stored job format unchanged: durations in seconds, cron strings, `type: 'previous'`, Earliest/Latest strings.
- Python: no new dependencies, no `eval`/`exec`; new routes use the caller's session (`ctx.user_gw`) and need `orchestrator_build` or `orchestrator_admin`.
- Each phase ends with a version bump and a `CHANGELOG.md` entry: Phase 1 → 1.5.0, Phase 2 → 1.6.0, Phase 3 → 1.7.0, Phase 4 → 1.8.0 (in `app.conf` `[id]` and `[launcher]` version, and the doc version lines).

## Review Focus

1. **A cron no preset matches** (`*/15 * * * *`, `0 1 * * 1-5`, two schedules): it must open as Custom, show its cron unchanged and never be rewritten on load or save. Test in Task 3.
2. **Durations that aren't a whole unit** (5400 s = 90 min, 61 s): must show as 90 minutes, not 1.5 hours; a value that isn't whole minutes keeps its seconds until edited. Test in Task 2.
3. **A stored time zone the browser doesn't list** (`Etc/Unknown`, an old alias): it stays selected and saved; only the server judges it. Test in Task 3.
4. **Out-of-order validation replies:** a reply for an older version of the job must never overwrite issues for the newer one. Test in Task 9.
5. **Token insert with no caret** (the field was never focused, or is empty): the token goes at the end; with a selection, it replaces the selection. Test in Task 6.

---

## Phase 0: environment

### Task 0: Make the test suites runnable

Running the suites needs packages installed from PyPI and npm. In this session the permission check blocked `pip install`, so the user must allow it or run it themselves.

- [ ] **Step 1:** Ask the user to run, or approve: `python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt` and `npm --prefix ui ci`.
- [ ] **Step 2:** Run `.venv/bin/python -m pytest -q`. Expected: all pass. Run `npm --prefix ui test -- --silent` and `npm --prefix ui run typecheck`. Expected: all pass. Record the counts in the task report; any failure here is pre-existing and must be reported before Task 1.

---

## Phase 1: plain-language inputs (1.5.0)

### Task 1: Server routes `schedule/next` and `timerange/resolve`

**Files:**
- Modify: `app/search_orchestrator/bin/so/api.py` (routes list in `_routes()`, new handlers next to `me`)
- Modify: `app/search_orchestrator/bin/so/gateway.py` (Protocol + `SplunkGateway`), `tests/fakes.py` (FakeGateway)
- Test: `tests/test_api.py`, `tests/test_gateway_parsing.py`, new fixture `tests/fixtures/timeparser.json`

**Interfaces:**
- Produces (REST):
  - `POST schedule/next` body `{cron: str, timezone: str|null, count?: int 1..5 (default 3)}` → `200 {slots: int[], timezone_status: <cron.tz_status result>}`; `400 bad_cron` with the `CronError` text; `400 bad_request` for `count` outside 1..5.
  - `POST timerange/resolve` body `{earliest: str, latest: str, scheduled_time: int}` → `200 {earliest: int|null, latest: int}`. Empty `earliest` → `null` (all time). Empty `latest` → `scheduled_time`. Splunk rejecting a value → `400 bad_time` with `{field: "earliest"|"latest"}` and Splunk's message.
  - Both: `403 forbidden` unless `ctx.allowed(authz.can_edit, None)` or admin.
- Produces (gateway): `parse_times(user: str, times: List[str], now_epoch: int) -> Dict[str, int]` — `GET /services/search/timeparser` with `time` repeated, `now=now_epoch`, `output_time_format=%s`, `output_mode=json`; raises `GatewayError(status=400)` naming the bad value. Pure parser `parse_timeparser(body) -> Dict[str, int]` at module level.

- [ ] **Step 1: Write failing tests** in `tests/test_api.py`:
  - `test_schedule_next_daily`: cron `0 1 * * *`, timezone `UTC`, clock 1762390800 (2025-11-06 01:00 UTC) → `slots == [1762477200, 1762563600, 1762650000]`.
  - `test_schedule_next_bad_cron`: cron `61 * * * *` → 400, `code == "bad_cron"`.
  - `test_schedule_next_count_bounds`: `count: 6` → 400 `bad_request`.
  - `test_schedule_next_run_only_user_forbidden`: a user with only `orchestrator_run` → 403.
  - `test_timerange_resolve_previous_day`: FakeGateway maps `(-1d@d, now=1762390800)` → 1762300800 and `(@d, …)` → 1762387200; reply `{earliest: 1762300800, latest: 1762387200}`.
  - `test_timerange_resolve_empty_values`: `earliest: "", latest: ""` → `{earliest: None, latest: 1762390800}`, and the gateway is not called.
  - `test_timerange_resolve_bad_value`: gateway raises for `-1x` → 400 `bad_time`, `field == "earliest"`.
  - In `tests/test_gateway_parsing.py`, `test_parse_timeparser` against `tests/fixtures/timeparser.json`, which has the shape `{"-1d@d": "1762300800", "@d": "1762387200"}`.
- [ ] **Step 2:** Run `.venv/bin/python -m pytest tests/test_api.py -k "schedule or timerange" tests/test_gateway_parsing.py -k timeparser -q`. Expected: FAIL (route not found / name not defined).
- [ ] **Step 3: Implement** `schedule_next(ctx, body)` and `resolve_timerange(ctx, body)` in `api.py` and register them at `r"schedule/next"` and `r"timerange/resolve"`. `schedule_next` uses `cronmod.parse`, `cronmod.next_slot(spec, after, tz, NEXT_RUN_MAX_DAYS)` repeated from the previous slot + 1, and `cronmod.tz_status`. `parse_times` and `parse_timeparser` go in `gateway.py`; FakeGateway gets a `times` dict keyed `(value, now)`.
- [ ] **Step 4:** Rerun the Step 2 command. Expected: PASS. Then `.venv/bin/python -m pytest -q`. Expected: all pass.
- [ ] **Step 5: Server check.** The fixture shape is a guess. The user runs on the 10.6.1.1 server: `curl -k -u <user> "https://localhost:8089/services/search/timeparser?time=-1d@d&time=@d&now=1762390800&output_time_format=%25s&output_mode=json"`. Replace `tests/fixtures/timeparser.json` with the real body, adjust `parse_timeparser`, rerun Step 4. If `now` is ignored, stop and report: the readout in Task 4 can't be built that way.
- [ ] **Step 6: Commit** `feat(api): schedule/next and timerange/resolve for the builder's readouts`.

### Task 2: Durations with units

**Files:**
- Create: `ui/src/features/builder/duration.ts`
- Modify: `ui/src/features/builder/StepPanel.tsx` (`DurationField`), `ui/src/features/builder/JobTabs.tsx` (`SettingsTab` uses `DurationField`)
- Test: `ui/src/__tests__/duration.test.tsx`, `ui/src/__tests__/StepPanel.test.tsx`

**Interfaces:**
- Produces: `type DurationUnit = 'minutes' | 'hours' | 'days'`; `splitDuration(seconds: number): { amount: number; unit: DurationUnit }` (largest unit that divides exactly; else minutes, rounded only if `seconds % 60 !== 0`, flagged `{ exact: false }`); `toSeconds(amount: number, unit: DurationUnit): number`; `formatDuration(seconds: number): string` ("24 hours", "90 minutes", "1 day").
- `DurationField` props unchanged; the label loses "(minutes)".

- [ ] **Step 1: Write failing tests:** `splitDuration(86400)` → `{amount: 1, unit: 'days'}`; `splitDuration(5400)` → `{amount: 90, unit: 'minutes'}`; `splitDuration(7200)` → `{amount: 2, unit: 'hours'}`; `splitDuration(61)` → `{amount: 1, unit: 'minutes', exact: false}`; `toSeconds(3, 'hours') === 10800`; `formatDuration(3600) === '1 hour'`. Component: a step with `give_up_after: 86400` shows Number `1` and unit `Days`; changing the unit to Hours calls `onChange(3600)`; typing `0` shows `At least 1 minute.` and doesn't call `onChange`; an empty amount calls `onChange(null)` and the placeholder shows the inherited value as `formatDuration`.
- [ ] **Step 2:** Run `npm --prefix ui test -- duration StepPanel`. Expected: FAIL.
- [ ] **Step 3: Implement** `duration.ts`; rebuild `DurationField` as `ControlGroup` with `controlsLayout="fillJoin"` holding `Number` (min 0, step 1) and `Select` (Minutes, Hours, Days). A non-exact value keeps its seconds until the amount or unit is edited. Replace `formatMinutes` uses with `formatDuration` and delete `formatMinutes`.
- [ ] **Step 4:** Rerun Step 2. Expected: PASS. Then `npm --prefix ui test -- --silent && npm --prefix ui run typecheck`.
- [ ] **Step 5: Commit** `feat(builder): durations take a unit`.

### Task 3: Schedule presets, readable summary, next runs, time zone picker

**Files:**
- Create: `ui/src/features/builder/schedule.ts`, `ui/src/features/builder/ScheduleEditor.tsx`
- Modify: `ui/src/features/builder/TriggersTab.tsx`, `ui/src/api/client.ts`, `ui/src/features/builder/BuilderPage.tsx` (`BuilderApi` + `defaultApi`), `ui/src/__tests__/builderFixtures.tsx` (`fakeApi`)
- Test: `ui/src/__tests__/schedule.test.tsx`, `ui/src/__tests__/TriggersTab.test.tsx`

**Interfaces:**
- Consumes: `POST schedule/next` (Task 1).
- Produces:
  - `type SchedulePreset = { kind: 'hourly'; minute: number } | { kind: 'daily'; hour: number; minute: number } | { kind: 'weekly'; days: number[]; hour: number; minute: number } | { kind: 'monthly'; dayOfMonth: number; hour: number; minute: number } | { kind: 'custom'; cron: string }` (weekday 0 = Sunday, as in cron).
  - `toCron(p: SchedulePreset): string`; `fromCron(cron: string): SchedulePreset` (exact shapes only: `M * * * *`, `M H * * *`, `M H * * D[,D…]`, `M H DOM * *`, with single numbers; anything else is `custom`); `describeSchedule(cron: string): string`.
  - `client.nextSlots(cron: string, timezone: string | null, count?: number): Promise<{ slots: number[]; timezone_status: unknown }>`; `BuilderApi.nextSlots` with the same signature.
  - `timeZoneOptions(current: string | undefined): string[]` — `Intl.supportedValuesOf('timeZone')`, plus `current` if missing, sorted.

- [ ] **Step 1: Write failing tests:**
  - `fromCron('0 1 * * *')` → `{kind:'daily', hour:1, minute:0}`; `toCron` of it → `'0 1 * * *'`.
  - `fromCron('30 6 * * 1')` → weekly `days:[1]`; `fromCron('0 2 1 * *')` → monthly; `fromCron('15 * * * *')` → hourly.
  - `fromCron('*/15 * * * *')`, `fromCron('0 1 * * 1-5')`, `fromCron('0 1 * 1 *')` → `custom` with the cron unchanged.
  - `describeSchedule('0 1 * * *') === 'Every day at 01:00'`; `'30 6 * * 1,3'` → `'Every Monday and Wednesday at 06:30'`; `'0 2 1 * *'` → `'On day 1 of every month at 02:00'`; `'15 * * * *'` → `'Every hour at 15 minutes past'`; custom → `'Custom schedule: */15 * * * *'`.
  - `timeZoneOptions('Etc/Unknown')` contains `'Etc/Unknown'` and `'Europe/Oslo'`.
  - TriggersTab: a job with trigger `0 1 * * 1-5` opens with RadioBar on Custom and Text value `0 1 * * 1-5`; a render and then a save without edits leaves `triggers` deep-equal. Picking Daily and setting time `02:30` dispatches cron `30 2 * * *`. The next-runs line shows the three slots from `fakeApi.nextSlots`, formatted in the job time zone, under a `DefinitionList` term "Next runs". A `bad_cron` reply shows the server message as the Custom field's `error`.
- [ ] **Step 2:** Run `npm --prefix ui test -- schedule TriggersTab`. Expected: FAIL.
- [ ] **Step 3: Implement.** `ScheduleEditor` per cron trigger: `RadioBar` (Hourly, Daily, Weekly, Monthly, Custom); time as `Text` `HH:MM` (reuse the preview time field's parse/normalise-on-blur behaviour from `PreviewBar.tsx`); weekdays as `Multiselect`; day of month as `Number` 1–31 with help "Months without this day are skipped." when > 28; Custom shows the cron `Text` with today's help text. Summary text under the editor: `describeSchedule(cron)` + ", in <zone>". Next runs fetched debounced 400 ms after a change, with the latest request winning. Time zone becomes a `ComboBox` of `timeZoneOptions`, with an empty value meaning the server's zone (placeholder kept, label "Time zone"). "Add schedule" adds `0 1 * * *` as before.
- [ ] **Step 4:** Rerun Step 2. Expected: PASS. Full UI suite and typecheck pass.
- [ ] **Step 5: Commit** `feat(builder): schedules from presets with a readable summary and next runs`.

### Task 4: Time range presets with a readout

**Files:**
- Create: `ui/src/features/builder/timeRange.ts`, `ui/src/features/builder/TimeRangeField.tsx`
- Modify: `ui/src/features/builder/StepPanel.tsx` (replaces the Earliest/Latest pair), `ui/src/api/client.ts`, `BuilderPage.tsx` (`BuilderApi`), `builderFixtures.tsx`
- Test: `ui/src/__tests__/timeRange.test.tsx`, `ui/src/__tests__/StepPanel.test.tsx`

**Interfaces:**
- Consumes: `POST timerange/resolve` (Task 1); `scheduledTime` already held in `BuilderPage` state (the preview "as if scheduled at").
- Produces:
  - `TIME_RANGE_PRESETS: { key: string; label: string; earliest: string; latest: string }[]`, exactly: `previous_hour` "The hour before" `-1h@h`/`@h`; `previous_day` "The day before" `-1d@d`/`@d`; `previous_week` "The week before (Monday to Sunday)" `-1w@w1`/`@w1`; `previous_month` "The month before" `-1mon@mon`/`@mon`; `last_24h` "The 24 hours before" `-24h`/`now`.
  - `timeRangeChoice(earliest?: string, latest?: string): string` — preset key, `'all_time'` when both are empty, else `'custom'`.
  - `client.resolveTimeRange(earliest: string, latest: string, scheduledTime: number): Promise<{ earliest: number | null; latest: number }>`; `BuilderApi.resolveTimeRange` likewise.
  - `TimeRangeField` props: `{ idPrefix: string; earliest?: string; latest?: string; scheduledTime: number; timezone?: string; resolve: BuilderApi['resolveTimeRange']; onChange: (earliest: string, latest: string) => void }`.

- [ ] **Step 1: Write failing tests:** `timeRangeChoice('-1d@d', '@d') === 'previous_day'`; `timeRangeChoice('', '') === 'all_time'`; `timeRangeChoice('-2d@d', '@d') === 'custom'`. Component: choosing "The day before" calls `onChange('-1d@d', '@d')`; the readout shows "For a run scheduled Thu 6 Nov 01:00, this searches Wed 5 Nov 00:00 to Thu 6 Nov 00:00" from the mocked resolve (times formatted in the job zone); `all_time` shows the warning text "Searches all time. Pick a range unless the search sets its own." as a `Message type="warning"`; Custom reveals Earliest and Latest `Text` fields with their current values; a `bad_time` reply puts Splunk's message on the named field's `error`. Not shown for `type: 'previous'` steps (today's behaviour).
- [ ] **Step 2:** Run `npm --prefix ui test -- timeRange StepPanel`. Expected: FAIL.
- [ ] **Step 3: Implement.** A `Select` labelled "Time range" (presets, "All time", "Custom"), help "Relative to the run's scheduled time, not when the step starts." The Custom fields sit in the same `ControlGroup` row. The readout is a `Typography variant="body"` line under it, resolved debounced 400 ms with the latest request winning, and a "Learn more about time ranges" `Link` (added in Task 13; leave a `TODO(Task 13)` only if Task 13 isn't done yet, removed by Task 13).
- [ ] **Step 4:** Rerun Step 2. Expected: PASS. Full UI suite and typecheck pass.
- [ ] **Step 5: Commit** `feat(builder): time range presets with the window they search`.
- [ ] **Step 6: Phase 1 release.** Version 1.5.0 per Global Constraints; CHANGELOG entry listing Tasks 1–4 in the file's existing style. Commit `release: 1.5.0`. Push `git push -u origin usability`.

---

## Phase 2: guided job building (1.6.0)

### Task 5: Job templates

**Files:**
- Create: `ui/src/features/builder/templates.ts`, `ui/src/features/builder/TemplatePicker.tsx`
- Modify: `ui/src/features/builder/BuilderPage.tsx`, `ui/src/pages/builder/index.tsx` (reads `?template=`)
- Test: `ui/src/__tests__/templates.test.tsx`, `ui/src/__tests__/BuilderPage.test.tsx` (new)

**Interfaces:**
- Produces: `interface JobTemplate { key: 'rollup' | 'serial' | 'parallel' | 'blank'; title: string; description: string; build: () => JobDefinition }`; `JOB_TEMPLATES: JobTemplate[]` in that order; `templateByKey(key: string | null): JobTemplate | null`. `BuilderPage` gets prop `template?: string | null`.
- Template contents (exact):
  - `rollup` "Daily, weekly and monthly rollup", "A daily summary, then a weekly rollup on Mondays and a monthly one on the 1st, each waiting for the one before." Steps `daily` "Daily summary" (`-1d@d`/`@d`), `weekly` "Weekly rollup" (`-7d@d`/`@d`, run_when preset `mondays`), `monthly` "Monthly rollup" (`-1mon@mon`/`@mon`, run_when `first_of_month`); all `inline`, SPL `` ```Replace with your search``` `` followed by a newline and `| makeresults`; edges daily→weekly→monthly `on_success`; trigger cron `0 1 * * *`.
  - `serial` "One search after another", "Step 2 starts when step 1 succeeds." Steps `first`, `second`, edge `on_success`, trigger `0 2 * * *`, both `previous_day` range.
  - `parallel` "Run searches side by side, then combine", "Two searches run at once; a third works on both their results." Steps `left`, `right` (inline, `previous_day`), `combined` (`type: 'previous'`, SPL `| stats count`), edges left→combined and right→combined `on_success`, trigger `0 2 * * *`.
  - `blank` "Blank job", "Start with an empty canvas." → `blankJob()`.
- [ ] **Step 1: Write failing tests:** each template's `build()` passes `findIssues` with no `error`-level issue; `rollup` has 3 steps, 2 edges, cron `0 1 * * *`; `build()` returns a new object each call. BuilderPage with no `jobId` and no `template` shows the picker (heading "Start a new job", 4 cards); clicking "Daily, weekly and monthly rollup" closes it and shows 3 steps on the canvas, with one undo entry that returns to the picker-free blank job; with `template="rollup"` the picker is skipped; with `jobId` the picker never shows.
- [ ] **Step 2:** Run `npm --prefix ui test -- templates BuilderPage`. Expected: FAIL.
- [ ] **Step 3: Implement.** `TemplatePicker` is a `CardLayout` of `Card`s (`Card.Header title subtitle`, `onClick` choosing the template); each card's header is the accessible name. It renders in place of the tabs until a choice is made. Choosing dispatches the reducer's existing `load` action, then selects the first step.
- [ ] **Step 4:** Rerun Step 2. Expected: PASS. Full UI suite and typecheck pass.
- [ ] **Step 5: Commit** `feat(builder): start a new job from a template`.

### Task 6: "Insert value" token picker

**Files:**
- Create: `ui/src/features/builder/tokens.ts`, `ui/src/features/builder/InsertToken.tsx`
- Modify: `StepPanel.tsx` (SPL `TextArea`), `EdgePanel.tsx` (expression `Text`), `ActionsEditor.tsx` (message fields)
- Test: `ui/src/__tests__/tokens.test.tsx`, `ui/src/__tests__/StepPanel.test.tsx`

**Interfaces:**
- Consumes: `parentsOf(edges, id)` from `graphLogic.ts`; live preview fields from `usePreviews` (`previews.previews[stepId]` result `fields`, when present).
- Produces:
  - `interface TokenOption { token: string; label: string; description: string }`; `interface TokenGroup { title: string; options: TokenOption[] }`.
  - `availableTokens(job: JobDefinition, stepId: string | null, previewFields: Record<string, string[]>): TokenGroup[]` — groups "This run" (`$run.id$`, `$run.scheduled_time$`, then `$run.param.<name>$` per param), then one group per *ancestor* step (all upstream, transitively; not only parents) in topological order with `$<id>.sid$`, `$<id>.resultCount$`, `$<id>.status$` and `$<id>.first.<field>$` per preview field. `stepId === null` (job-level actions) lists every step.
  - `insertAt(text: string, selection: { start: number; end: number } | null, token: string): { text: string; caret: number }`.
  - `InsertToken` props `{ groups: TokenGroup[]; onInsert: (token: string) => void }`: a `Dropdown` with toggle `Button appearance="subtle" label="Insert value"` and a `Menu` with `Menu.Heading` per group and `Menu.Item description` per option.
- [ ] **Step 1: Write failing tests:** for `rollupJob()`, `availableTokens(job, 'monthly', {})` has groups "This run", "Daily summary", "Weekly rollup" (no "Monthly rollup"); with `previewFields {daily: ['host']}` the Daily group includes `$daily.first.host$`. `insertAt('ab', {start:1,end:1}, '$x$')` → `{text:'a$x$b', caret:4}`; `insertAt('abc', {start:0,end:3}, '$x$')` → `'$x$'`; `insertAt('ab', null, '$x$')` → `'ab$x$'`; `insertAt('', null, '$x$')` → `'$x$'`. StepPanel: choosing "Result count" under Daily summary on the monthly step inserts `$daily.resultCount$` into the SPL.
- [ ] **Step 2:** Run `npm --prefix ui test -- tokens StepPanel`. Expected: FAIL.
- [ ] **Step 3: Implement.** Track the field's selection through the `TextArea`/`Text` `inputRef` on `select`/`keyup`/`click`; after insert, refocus and set the caret. Use the picker in the three places listed under Files.
- [ ] **Step 4:** Rerun Step 2. Expected: PASS. Full UI suite and typecheck pass.
- [ ] **Step 5: Commit** `feat(builder): insert tokens from a list`.

### Task 7: Setup checklist

**Files:**
- Create: `ui/src/features/builder/readiness.ts`, `ui/src/features/builder/SetupChecklist.tsx`
- Modify: `BuilderPage.tsx`, `JobTabs.tsx` (controlled `activeTab` + `onTabChange` props)
- Test: `ui/src/__tests__/readiness.test.tsx`

**Interfaces:**
- Produces:
  - `type TabId = 'steps' | 'triggers' | 'params' | 'actions' | 'access' | 'settings'` (exported from `JobTabs.tsx`; `JobTabs` gets props `activeTab: TabId; onTabChange: (t: TabId) => void`).
  - `interface ChecklistItem { key: 'name' | 'steps' | 'searches' | 'schedule' | 'notify'; label: string; done: boolean; optional: boolean; tab: TabId }`.
  - `readiness(job: JobDefinition, issues: Issue[]): ChecklistItem[]`, in this order and wording: "Give the job a name" (`name`; `tab: 'steps'`, since the name field sits above the tabs); "Add a step" (≥1 step); "Write each step's search" (every step has non-empty `spl`, or `saved_search_ref` for saved-search steps); "Choose when it runs" (`optional: true`, done if any cron or completion trigger; label suffix " (optional; you can also start it by hand)"); "Choose who hears about failures" (`optional: true`, done unless `issues` has code `no_failure_notification`; tab `actions`).
- [ ] **Step 1: Write failing tests:** `blankJob()` → all five not done; `rollupJob()` with no issues → all done; a step with `spl: ''` makes "searches" not done; an issue `no_failure_notification` makes "notify" not done. Component: shows "2 of 5 done"; clicking an undone item's "Go to …" `Link` calls `onTabChange` with its tab; the whole checklist is hidden when every item is done and stays hidden for the rest of the session.
- [ ] **Step 2:** Run `npm --prefix ui test -- readiness`. Expected: FAIL.
- [ ] **Step 3: Implement.** A `List` with `CheckCircle` (done) or `Circle` (not done) icons that have screen-reader text "Done"/"Not done", rendered above the tabs for new jobs and for loaded jobs that aren't fully ready. Not a `StepBar` (that is for linear flows and isn't interactive).
- [ ] **Step 4:** Rerun Step 2. Expected: PASS. Full UI suite and typecheck pass.
- [ ] **Step 5: Commit** `feat(builder): a setup checklist until the job is ready`.
- [ ] **Step 6: Phase 2 release.** Before release, the owner reviews screenshots of the template picker and checklist in both themes (owner rule against generic-looking screens). Version 1.6.0, CHANGELOG, commit `release: 1.6.0`, push to `origin`.

---

## Phase 3: feedback and safety (1.7.0)

### Task 8: Issue counts on tabs and a save error list that jumps

**Files:**
- Create: `ui/src/features/builder/issueTabs.ts`, `ui/src/features/builder/IssueSummary.tsx`
- Modify: `JobTabs.tsx`, `BuilderPage.tsx`
- Test: `ui/src/__tests__/issueTabs.test.tsx`

**Interfaces:**
- Consumes: `TabId` (Task 7).
- Produces: `tabForIssue(issue: Issue): TabId`, decided by this table, first match wins: `issue.step` set → `steps`; codes `bad_cron`, `bad_trigger`, `bad_timezone`, `timezone_fallback`, `job_chain_cycle` → `triggers`; `bad_param` → `params`; `bad_action`, `unknown_destination`, `no_failure_notification` → `actions`; anything else → `steps`. `issueCounts(issues: Issue[]): Partial<Record<TabId, number>>` counting `error` level only. `IssueSummary` props `{ issues: Issue[]; onGo: (issue: Issue) => void }`.
- [ ] **Step 1: Write failing tests:** the table above, one assertion per row; `issueCounts` ignores warnings. Component: a save with two errors shows a `Message type="error"` titled "Fix 2 problems before saving" listing each message with a "Go to <step name or tab name>" link; clicking it calls `onGo`; BuilderPage's `onGo` switches tab and, for a step issue, selects that step.
- [ ] **Step 2:** Run `npm --prefix ui test -- issueTabs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pass `count={issueCounts(issues)[tabId]}` to each `TabBar.Tab` (omit when 0). Replace the save-error notice with `IssueSummary`.
- [ ] **Step 4:** Rerun Step 2. Expected: PASS. Full UI suite and typecheck pass.
- [ ] **Step 5: Commit** `feat(builder): tabs count their problems and save errors link to them`.

### Task 9: Automatic validation (removes the Validate button)

**Files:**
- Create: `ui/src/features/builder/useAutoValidate.ts`
- Modify: `BuilderPage.tsx`
- Test: `ui/src/__tests__/useAutoValidate.test.tsx`

**Interfaces:**
- Consumes: `BuilderApi.validateJob`.
- Produces: `useAutoValidate(job: JobDefinition, validate: BuilderApi['validateJob'], opts?: { delayMs?: number; enabled?: boolean }): { issues: Issue[]; checkedJob: JobDefinition | null; checking: boolean }` — default `delayMs` 800; a reply is used only if its request was for the latest job object passed in.
- [ ] **Step 1: Write failing tests** (Jest fake timers): one edit → one call after 800 ms; three edits within 800 ms → one call with the last job; **stale reply:** request A (slow) then request B (fast); B resolves, then A resolves — the hook's `issues` are B's. `enabled: false` never calls. A rejected call keeps the previous issues and sets no error.
- [ ] **Step 2:** Run `npm --prefix ui test -- useAutoValidate`. Expected: FAIL.
- [ ] **Step 3: Implement** the hook and wire it in place of `onValidate`'s state (`serverIssues`, `checkedJob`). Remove the Validate button. Save still runs a fresh validate first, as today. Show "Checking…" as `Typography` next to Save while `checking`.
- [ ] **Step 4:** Rerun Step 2. Expected: PASS. Full UI suite and typecheck pass (update tests that clicked Validate).
- [ ] **Step 5: Commit** `feat(builder): check the job as it is edited`.

### Task 10: Unsaved-changes guard

**Files:**
- Modify: `BuilderPage.tsx`, `ui/src/features/builder/reducer.ts` (adds `saved` marker)
- Test: `ui/src/__tests__/reducer.test.tsx`, `ui/src/__tests__/BuilderPage.test.tsx`

**Interfaces:**
- Produces: reducer state field `savedJob: JobDefinition` set on `load` and on a new action `{ type: 'saved'; job: JobDefinition }`; `isDirty(state): boolean` (deep-compares `job` with `savedJob` via `JSON.stringify` of `client.toDefinition`).
- [ ] **Step 1: Write failing tests:** after `load`, `isDirty` is false; after an edit, true; after undoing back to the loaded job, false; after `saved`, false. BuilderPage: when dirty, a `beforeunload` event has `defaultPrevented === true`; when clean, it hasn't.
- [ ] **Step 2:** Run `npm --prefix ui test -- reducer BuilderPage`. Expected: FAIL.
- [ ] **Step 3: Implement**, dispatching `saved` after a successful create or update.
- [ ] **Step 4:** Rerun Step 2. Expected: PASS. Full UI suite and typecheck pass.
- [ ] **Step 5: Commit** `feat(builder): warn before leaving with unsaved changes`.
- [ ] **Step 6: Phase 3 release.** Version 1.7.0, CHANGELOG, commit `release: 1.7.0`, push to `origin`.

---

## Phase 4: pages, help and words (1.8.0)

### Task 11: Jobs page: empty state, summary line, search

**Files:**
- Create: `ui/src/features/jobs/jobSummary.ts`, `ui/src/features/jobs/JobsEmpty.tsx`
- Modify: `ui/src/features/jobs/JobsTable.tsx`, `ui/src/features/jobs/JobsPage.tsx`
- Test: `ui/src/__tests__/JobsTable.test.tsx`, `ui/src/__tests__/jobSummary.test.tsx`

**Interfaces:**
- Consumes: `describeSchedule` (Task 3), `JOB_TEMPLATES` (Task 5).
- Produces: `jobSummary(job: Job): string` — parts joined by " · ": first cron trigger's `describeSchedule` (or "Started by hand" with no cron or completion trigger, or "After <job name or id> succeeds/completes" for a completion trigger), then "N step(s)". `filterJobs(jobs: Job[], query: string): Job[]` — case-insensitive match on name, id, owner and description.
- [ ] **Step 1: Write failing tests:** `jobSummary(rollupJob())` → `'Every day at 01:00 · 3 steps'`; no triggers and 1 step → `'Started by hand · 1 step'`. `filterJobs` matches `'ROLL'` against name `Summary rollups`. Table: the summary line renders under each name in muted text; typing in the `Search` labelled "Find jobs" filters rows; no matches shows "No jobs match "<query>"." Empty state (no jobs, `can_build`): heading "Build your first job", the four template cards linking to `pageHref('builder', {template: key})`, and for `can_admin` the line "Check the install first: run | orchestrate selftest in Search." with a `Link` to `/app/search/search?q=%7C%20orchestrate%20selftest`. Without `can_build`: "No jobs you can run yet. Ask a job owner to add one of your roles under Access." The page's primary button label becomes "Create job".
- [ ] **Step 2:** Run `npm --prefix ui test -- JobsTable jobSummary`. Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse `TemplatePicker` from Task 5 with a `hrefFor(key)` prop instead of `onChoose` when given.
- [ ] **Step 4:** Rerun Step 2. Expected: PASS. Full UI suite and typecheck pass.
- [ ] **Step 5: Commit** `feat(jobs): an empty state with templates, a summary per job and search`.

### Task 12: Runs "Needs attention" filter and run-page next steps

**Files:**
- Create: `ui/src/features/run/nextStep.ts`
- Modify: `ui/src/features/runs/RunsTable.tsx`, `ui/src/pages/runs/index.tsx`, `ui/src/components/RunBanner.tsx`, `ui/src/features/run/RunHeader.tsx`
- Test: `ui/src/__tests__/RunsTable.test.tsx`, `ui/src/__tests__/RunHeader.test.tsx`, `ui/src/__tests__/nextStep.test.tsx`

**Interfaces:**
- Produces: state filter option value `'attention'` ("Needs attention") listed first after "All states"; it fetches without a `state` filter and keeps runs with state `blocked` or `failed`, or `held === true`. `nextStepText(run: RunDetail): string | null` with exactly:
  - held: "Later runs of this job are waiting for this one. Re-run it from the failed step to fix it, or dismiss it to let them start."
  - blocked: "<step name> failed and nothing after it can start. Fix the cause, then re-run from <step name>."
  - failed, not held: "This run failed. Re-run it from <first failed step name> if its results are still needed."
  - anything else: `null`.
- [ ] **Step 1: Write failing tests:** one per `nextStepText` case; the filter keeps a held succeeded-run and drops a plain succeeded run; RunHeader renders the text inside the existing banner `Message` and the "Dismiss" button reads "Dismiss run".
- [ ] **Step 2:** Run `npm --prefix ui test -- RunsTable RunHeader nextStep`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Rerun Step 2. Expected: PASS. Full UI suite and typecheck pass.
- [ ] **Step 5: Commit** `feat(runs): find runs that need attention and say what to do next`.

### Task 13: Help page and "Learn more" links

**Files:**
- Create: `ui/src/pages/help/index.tsx`, `ui/src/features/help/HelpPage.tsx`, `ui/src/components/LearnMore.tsx`, `ui/src/splunk/default/data/ui/views/help.xml`, `ui/src/splunk/appserver/templates/help.html` (copy `runs.html`, title "Help | Search Orchestrator"), `ui/src/md.d.ts` (`declare module '*.md' { const text: string; export default text; }`), `ui/jest/rawTransform.js` (returns `module.exports = <JSON-string of file>`)
- Modify: `ui/webpack.config.js` (rule `{ test: /\.md$/, type: 'asset/source' }`), `ui/jest.config.js` (`transform: { '\\.md$': '<rootDir>/jest/rawTransform.js', '\\.[jt]sx?$': 'babel-jest' }`, add `'md'` to `moduleFileExtensions`), `ui/src/splunk/default/data/ui/nav/default.xml` (add `<view name="help" />` last), `TimeRangeField.tsx`, `StepPanel.tsx`, `JobTabs.tsx`, `AccessTab.tsx`
- Test: `ui/src/__tests__/HelpPage.test.tsx`

**Interfaces:**
- Produces: `slugify(heading: string): string` (lowercase, spaces → `-`, drop characters other than `a-z0-9-`, the same as GitHub's anchors, so the guide's existing `[link](#from-previous-steps)` anchors work); `helpHref(anchor: string): string` = `pageHref('help') + '#' + anchor`; `LearnMore` props `{ anchor: string; topic: string }` rendering `Link` "Learn more about <topic>" with `openInNewContext`.
- `HelpPage` renders `docs/user-guide.md` (imported as `../../../../docs/user-guide.md`) with `Markdown`, a `headingRenderer` that sets `id={slugify(text)}`, and scrolls to `location.hash` on load.
- LearnMore placements: time range (`time-range` → anchor `steps`), Results of earlier steps (`from-previous-steps`), saved search steps (`steps`), tokens (`tokens`), "When a step gives up" (`hold-and-continue`, or the guide's actual heading slug for that section), Access "who may run" (the guide's actual slug for that section). Before wiring, read the guide's headings and use their real slugs.
- [ ] **Step 1: Write failing tests:** `slugify('From previous steps') === 'from-previous-steps'`; `slugify('Make steps safe to re-run') === 'make-steps-safe-to-re-run'`; HelpPage renders an `h2` with `id="tokens"`; `LearnMore` renders a link to `…/help#tokens`.
- [ ] **Step 2:** Run `npm --prefix ui test -- HelpPage`. Expected: FAIL.
- [ ] **Step 3: Implement.** Remove the `TODO(Task 13)` from Task 4.
- [ ] **Step 4:** Rerun Step 2. Expected: PASS. Then `npm --prefix ui run build` and confirm `ui/stage/appserver/static/pages/help.js` and `ui/stage/default/data/ui/views/help.xml` exist. Run `scripts/appinspect.sh` if the user has AppInspect available. Expected: no new failures.
- [ ] **Step 5: Commit** `feat(help): an in-app help page and learn-more links`.

### Task 14: Wording pass and docs

**Files:**
- Modify: UI text across `ui/src/features/**`, `ui/src/components/StatusText.tsx`; server issue messages in `app/search_orchestrator/bin/so/model.py` and `api.py`; `docs/user-guide.md`, `docs/admin-guide.md`, `app/search_orchestrator/README.md`
- Test: existing tests that assert on changed text; `tests/test_model.py`, `tests/test_api.py` where messages are asserted

**Required changes (exact):**

| Where | Today | New |
|---|---|---|
| Step type option | From previous steps | Results of earlier steps |
| Step type help (new) | — | "Works on the rows the steps before it found, with no search of its own." |
| "Input (added for you)" | Input (added for you) | Reads results from |
| Saved search help | Runs directly if it is your private search with dispatchAs = owner; otherwise through a wrapper, without its own summary indexing and actions. | If this is your own private search, it runs as saved. Otherwise its own alerts and summary indexing don't run; add collect to the step if you need them. |
| Step id help | Used in tokens such as $daily.sid$. | Short name used in tokens, such as $daily.sid$. Lowercase letters, numbers and _. |
| After give-up options | Hold later runs / Continue with later runs | Wait for this run to be fixed / Start later runs anyway |
| After give-up help | Hold keeps later runs of this job waiting until the run is re-run or dismissed. | Waiting stops a rollup running over a missing day. Starting anyway keeps the schedule but can leave gaps. |
| Skip status | Skipped (not taken) | Skipped (branch not taken) |
| Depends on help | Runs after these steps succeed. Steps that would make a loop are not listed. | Starts after these steps succeed. Steps that would make a loop aren't listed. |
| Remove step modal body | (current) | "<step name> and its connections are removed. Undo brings them back." |

**Rules for everything else:** apply Global Constraints' wording rules to every user-facing string in `ui/src/features/**` and to every `_issue(...)` message in `model.py`/`api.py`: no internal names (`dispatchAs`, `wrapper`, `sid` outside token examples, `KV Store`), an error says what to do, sentence case, contractions allowed. Issue `code`s never change.

- [ ] **Step 1:** Update tests that assert on the strings in the table to the new text. Run `npm --prefix ui test -- --silent` and `.venv/bin/python -m pytest -q`. Expected: FAIL only on those assertions.
- [ ] **Step 2:** Make the changes. Update `docs/user-guide.md` for every UI change in this plan (templates, schedule presets, time range presets, token picker, checklist, automatic checking, Results of earlier steps, Help page), and set the version line in both guides and the app README to 1.8.0.
- [ ] **Step 3:** Run both suites and typecheck. Expected: PASS.
- [ ] **Step 4: Commit** `docs+ui: plain-language wording and guides for 1.8.0`.
- [ ] **Step 5: Phase 4 release.** Version 1.8.0, CHANGELOG, commit `release: 1.8.0`. Run `scripts/package.sh 1.8.0`; the owner installs it on the 10.6.1.1 server and does the final screen check in both themes. Push to `origin` and open a PR from `usability` into `main` **on `lyderhansen/search_orchestrator`** (`gh pr create --repo lyderhansen/search_orchestrator`).
