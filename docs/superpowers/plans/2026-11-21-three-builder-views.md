# Three Builder Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The job builder offers Simple, Standard and Advanced views of the same job, and Create job opens a blank job with no template picker.

**Architecture:** Standard reuses `FlowCanvas` with a filtered graph, `standardGraph(job)`, which has only the step nodes and step-to-step lines; a condition becomes one line with a label. Triggers move to a new Triggers tab built from `TriggerPanel`, and a step's actions move to a new `StepActions` section in `NodePanel`. Every edit goes through the existing reducer actions, so switching views never changes the job.

**Tech Stack:** React 18, TypeScript, @splunk/react-ui, Jest + Testing Library (in `ui/`).

**Spec:** `docs/superpowers/specs/2026-11-21-three-builder-views-design.md`

## Global Constraints

- **UI only.** No changes to the job model, the API or the engine.
- **Views never change the job.** Switching views dispatches nothing. Every edit uses the existing `BuilderAction`s (`addNode`, `updateAction`, `removeAction`, `connect`, `updateEdge`, `disconnect`, `updateTrigger`, `removeTrigger`, `setJob`, `moveNodes`, `tidyLayout`).
- **Menus respect turned-off building blocks** (`activeCatalog`) and show `BetaTag` for `isBeta` kinds.
- **Labels:**
  - The view switch reads `Simple`, `Standard`, `Advanced`.
  - The first tab is `Steps` in Simple and Standard, and `Flow` in Advanced.
  - The new tab is `Triggers`.
  - Line labels: `✗ Fails`, `∞ Either way`, and `◇ <conditionShort>`.
  - The locked-Simple message: `Simple can't show this job: <reasons joined by ", ">. Use Standard or Advanced.`
- **Every feature change also updates** `docs/user-guide.md`, `helpIllustrations.tsx` and `Architecture.tsx` (the project rule).
- **Tests** run from `ui/`: `NODE_OPTIONS= npx jest` and `NODE_OPTIONS= npx tsc --noEmit -p .`.

## Review Focus

1. **A job with an expression condition between two steps.** Standard shows one line labelled `◇ …`, and clicking it opens EdgePanel for that edge. (Task 2 test `standardGraph draws an expression edge as one if-line`; Task 3 test `clicking a condition line opens its EdgePanel`.)
2. **A trigger with no `steps` list against one with `steps: []`.** The Starts field shows what `startedBy` returns, and changing it uses only `setTriggerStep`. (Task 4 test `Starts shows startedBy and toggles through setTriggerStep`.)
3. **An approval step.** Its action When list includes `Asks for approval` (the `approval` port), and a search step's doesn't. (Task 3 test `approval step offers Asks for approval`.)
4. **Turned-off blocks.** They are missing from Add step, Add action, Add schedule and Add after another job. (Task 3 test `Add step hides turned-off kinds`; Task 4 test `Add after another job hidden when turned off`.)
5. **Round trip.** Editing in Standard, switching to Advanced and back leaves the definition deep-equal, and `layout.nodes` keeps the positions of non-step nodes. (Task 3 test `switching views keeps the definition and layout`.)

---

### Task 1: Three views and the Simple lock

**Files:**
- Modify: `ui/src/features/simple/useBuilderView.tsx`
- Modify: `ui/src/features/builder/BuilderPage.tsx`: the `view === 'simple'` branch and `onOpenFlow`
- Modify: `ui/src/features/simple/SimpleView.tsx`: its `onOpenFlow` prop is renamed `onOpenAdvanced`
- Test: `ui/src/__tests__/builderView.test.tsx` (new)

**Interfaces:**
- Produces: `export type BuilderView = 'simple' | 'standard' | 'advanced'`.
- Produces: `useBuilderView(job: JobDefinition): [BuilderView, (v: BuilderView) => void]`.
  - A stored `'flow'` reads as `'advanced'`. With nothing stored, the view is `'standard'`.
  - A stored `'simple'` reads as `'standard'` when `readSimple(job).reasons.length > 0`.
- Produces: `ViewSwitch({ view, onView, lockedReasons }: { view: BuilderView; onView: (v: BuilderView) => void; lockedReasons: string[] })`.
  - With `lockedReasons` non-empty, the Simple button has `aria-disabled="true"` and a lock icon, and clicking it does not call `onView`.
  - Instead, it shows a `Message type="warning"` with the exact locked-Simple text.

- [ ] **Step 1: Write the failing tests.**
  - `stored flow opens advanced`
  - `nothing stored opens standard`
  - `stored simple opens standard for a job Simple can't show`. Use a job with an approval step.
  - `locked Simple shows the reasons and stays`. Expect `Simple can't show this job: an approval step. Use Standard or Advanced.` and `onView` not called.
  - `switch offers Simple, Standard and Advanced`
- [ ] **Step 2:** Run `NODE_OPTIONS= npx jest builderView`. Expect FAIL.
- [ ] **Step 3: Implement the view hook and the switch.**
  - In BuilderPage, `'standard'` renders the same branch as `'advanced'` for now. Task 3 splits it.
  - Pass `lockedReasons={readSimple(state.job).reasons}`.
- [ ] **Step 4:** Run the whole jest suite. Expect PASS. Update existing tests that click the `Flow` view button to click `Advanced`.
- [ ] **Step 5:** Commit: `feat(builder): Simple, Standard and Advanced views; Simple locked with reasons`.

### Task 2: The Standard graph

**Files:**
- Create: `ui/src/features/builder/standardGraph.ts`
- Test: `ui/src/__tests__/standardGraph.test.ts` (new)

**Interfaces:**
- Consumes: `buildGraph`, `stepKey`, `STEP_KINDS`, `portForEdge` and `FlowGraph` from `nodeModel.ts`; `conditionShort` from `conditions.ts`; `startedBy` from `triggerSteps.ts`.
- Produces: `standardGraph(job: JobDefinition): FlowGraph`.
  - It keeps only the nodes whose `kind` is in `STEP_KINDS`.
  - Every valid edge becomes one link `{ key: \`${stepKey(from)}-${port}->${stepKey(to)}\`, kind: 'edge' }`. For a non-expression edge, `port` is `portForEdge(e)`; for an expression edge, it is `'if'`.
  - There are no trigger, action or condition nodes or links.
  - Each step node's `detail` is `stepTypeLabel` followed by markers joined with ` · `:
    - `⚡` when some trigger's `startedBy` includes it;
    - `✉ N` for N `actions`;
    - `⌛` when `step.deadline` or `step.delayed_after` is set. Use the field names in `StepDef`.
- Produces: `standardLineLabels(job: JobDefinition): Record<string, string>`. It maps each expression edge's link key to `◇ ${conditionShort(e) || 'Write a condition'}`.

- [ ] **Step 1: Write the failing tests.**
  - `standardGraph keeps only steps`. A job with 2 triggers, 3 steps and step and job actions gives `nodes.map(n=>n.kind)` with only step kinds and length 3.
  - `standardGraph draws an expression edge as one if-line`. Expect `links` to equal `[{ key: 'step:a-if->step:b', from: 'step:a', to: 'step:b', port: 'if', kind: 'edge', data: false }]`, and `standardLineLabels(job)['step:a-if->step:b']` to start with `◇ `.
  - `failure and always lines keep their ports`
  - `markers show trigger, actions and deadline`. Expect `detail` to contain `⚡`, `✉ 2` and `⌛`.
- [ ] **Step 2:** Run `NODE_OPTIONS= npx jest standardGraph`. Expect FAIL.
- [ ] **Step 3:** Implement `standardGraph.ts`.
- [ ] **Step 4:** Run `NODE_OPTIONS= npx jest standardGraph`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(builder): steps-only graph for the Standard view`.

### Task 3: The Standard canvas and step actions

**Files:**
- Create: `ui/src/features/builder/StepActions.tsx`
- Modify: `ui/src/features/builder/BuilderPage.tsx`: the Standard branch
- Modify: `ui/src/features/builder/NodePanel.tsx`: the `standard?: boolean` prop
- Test: `ui/src/__tests__/StandardView.test.tsx` (new)

**Interfaces:**
- Consumes: `standardGraph` and `standardLineLabels` (Task 2); `BuilderView` (Task 1); `outputPorts`, `HOOK_FOR_PORT`, `stepKey` and `nodeKindOfAction` from `nodeModel.ts`; `ActionFields` from `ActionsEditor.tsx`; `retryText` from `ActionPanel.tsx`; `activeCatalog` and `isBeta` from `nodeCatalog.ts`.
- Produces: `StepActions({ job, stepId, destinations, alertActions, tokenGroups, issues, dispatch }): JSX.Element`.
  - It lists `step.actions`, each row showing its When label and a summary.
  - **Add action** opens two Selects:
    - **When:** the ports of `outputPorts(nodeKindOfStep(step))` with a non-null `HOOK_FOR_PORT`, labelled as `WhenMenu` does.
    - **Kind:** the action kinds in `activeCatalog()`.
  - Adding dispatches `{ type: 'addNode', kind, from: { key: stepKey(stepId), port } }`.
  - Editing a row shows `ActionFields`, which dispatch `updateAction` with `scope: stepId`.
  - **Remove** confirms, then dispatches `removeAction`.
- **In BuilderPage**, when `view === 'standard'`, render `FlowCanvas` with:
  - `graph={standardGraph(job)}`, `lineLabels={standardLineLabels(job)}` and the same `positions`;
  - `onDropOnNode` dispatching `connect` with `condition: 'on_success'`;
  - no `onPlus` and no `onDropOnCanvas`.
- **The toolbar** has an **Add step** menu of the `STEP_KINDS` in `activeCatalog()`. It dispatches `addNode` with no `from`, then selects the new step.
- **Positions:** `onMove` only ever receives step keys, and `tidyLayout` is passed `keys` of the step nodes only.
- **NodePanel** gets `graph={standardGraph(job)}` and `standard`. For a step node, it renders `StepActions` under the step's panel.

- [ ] **Step 1: Write the failing tests.**
  - `Standard draws steps but no trigger or action nodes`. Query by the node test ids FlowCanvas already uses.
  - `clicking a condition line opens its EdgePanel`
  - `Add action on a step adds it with the chosen When`. Expect dispatched job `steps[0].actions[0].hook === 'on_failure'`.
  - `approval step offers Asks for approval`. A search step's When list doesn't include it.
  - `Add step hides turned-off kinds`. Use `setTurnedOff(['lookup'])`.
  - `switching views keeps the definition and layout`. Render BuilderPage with a job, click Standard then Advanced, save through the mock API, and expect the saved job `toEqual` the loaded one, `layout` included.
- [ ] **Step 2:** Run `NODE_OPTIONS= npx jest StandardView`. Expect FAIL.
- [ ] **Step 3:** Implement `StepActions`, the BuilderPage Standard branch and NodePanel `standard`.
- [ ] **Step 4:** Run `NODE_OPTIONS= npx jest` and `npx tsc --noEmit -p .`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(builder): Standard canvas with steps only and step actions in the panel`.

### Task 4: The Triggers tab

**Files:**
- Create: `ui/src/features/builder/TriggersTab.tsx`
- Modify: `ui/src/features/builder/JobTabs.tsx`: `TabId` gets `'triggers'`, and there is a `view: BuilderView` prop
- Modify: `ui/src/features/builder/issueTabs.ts`: `tabForIssue(issue, view)` and `issueCounts(issues, view)`
- Test: `ui/src/__tests__/TriggersTab.test.tsx` (new)

**Interfaces:**
- Consumes: `TriggerPanel` and `TriggerPanelProps`; `rootSteps`, `startedBy` and `setTriggerStep` from `triggerSteps.ts`; `activeCatalog`.
- Produces: `TriggersTab({ job, jobs, dispatch, nextSlots, schedulePreview, savedJobId, onOpenSettings })`.
  - It has one card per trigger, each with a `TriggerPanel` (whose `onRequestRemove` confirms, then dispatches `removeTrigger`).
  - Each card has a **Starts** `Multiselect` over `rootSteps(job)` with values `startedBy(job, t)`. Every change dispatches `{ type: 'setJob', job }` from `setTriggerStep`.
  - The buttons **Add schedule** (`addNode` kind `trigger_cron`) and **Add after another job** (`addNode` kind `trigger_completion`) show only when the kind is in `activeCatalog()`.
- **JobTabs:**
  - The first tab's label is `view === 'advanced' ? 'Flow' : 'Steps'`.
  - `Triggers` is listed after it only when `view === 'standard'`.
- **issueTabs:** trigger issues go to `'triggers'` when `view === 'standard'`, and to `'steps'` otherwise.

- [ ] **Step 1: Write the failing tests.**
  - `one card per trigger with its schedule editor`
  - `Starts shows startedBy and toggles through setTriggerStep`. Cover a trigger without `steps` and one with `steps: ['a']`.
  - `Add after another job hidden when turned off`
  - `Triggers tab only in Standard`. JobTabs with `view` advanced has no `Triggers` tab and its first tab is `Flow`.
  - `trigger issues count on Triggers in Standard`
- [ ] **Step 2:** Run `NODE_OPTIONS= npx jest TriggersTab`. Expect FAIL.
- [ ] **Step 3:** Implement it, and pass `view` from BuilderPage into JobTabs and `issueCounts`.
- [ ] **Step 4:** Run the whole suite and tsc. Expect PASS.
- [ ] **Step 5:** Commit: `feat(builder): Triggers tab in the Standard view`.

### Task 5: Create job without templates

**Files:**
- Delete: `ui/src/features/builder/TemplatePicker.tsx`, `ui/src/features/builder/templates.ts`, `ui/src/__tests__/templates.test.tsx`
- Modify: `ui/src/features/builder/BuilderPage.tsx`: remove the `template` prop, the picker and `templateByKey`
- Modify: `ui/src/pages/builder/index.tsx`: remove `?template=`
- Modify: `ui/src/features/jobs/JobsEmpty.tsx`: show **Create job** and **Browse examples** only
- Test: update `ui/src/__tests__/BuilderPage*.test.tsx` and `JobsEmpty`/`JobsTable` tests that expect the picker

- [ ] **Step 1:** Write the failing test `new job opens blank with no template picker`. Expect `queryByRole('dialog')` null and the default blank job's single search step present.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Remove the picker and templates. Then `grep -rn "template" ui/src` must show no references to the removed files.
- [ ] **Step 4:** Run the whole suite and tsc. Expect PASS.
- [ ] **Step 5:** Commit: `feat(builder): Create job opens a blank job; templates removed`.

### Task 6: Docs, help and release 1.47.0

**Files:**
- Modify: `docs/user-guide.md`:
  - "### Simple and Flow" becomes "### Simple, Standard and Advanced". Describe the views, the lock and the Triggers tab, and the Standard canvas, line labels and markers, and step actions.
  - Remove templates from "## Build a job".
- Modify: `ui/src/features/help/helpIllustrations.tsx`: the key `'simple-and-flow'` becomes `'simple-standard-and-advanced'`, drawing a three-way switch and a steps-only flow with a `◇` line label.
- Modify: `ui/src/features/help/Architecture.tsx`: the builder text names the three views.
- Modify: `CHANGELOG.md` and `app/search_orchestrator/default/app.conf` for 1.47.0, with the build number +1.

- [ ] **Step 1:** Make the edits.
- [ ] **Step 2:** Run `NODE_OPTIONS= npx jest HelpPage Architecture` and the full suite. Expect PASS.
- [ ] **Step 3:** Commit: `docs: three builder views; release 1.47.0`.
- [ ] **Step 4:** From `app/search_orchestrator/bin`, run pytest. Then run `scripts/package.sh 1.47.0` and `scripts/appinspect.sh dist/search_orchestrator-1.47.0.tgz`, and expect 0 errors and 0 failures. Install the package in FAKE-TSHRT and restart. Expect no `level=ERROR` lines after the restart.
