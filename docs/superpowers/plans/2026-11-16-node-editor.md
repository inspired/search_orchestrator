# Node Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the builder's step canvas into a Resolve/Nuke-style node editor where triggers, actions and conditions are nodes, hooks are output ports, nodes are placed freely, and each node family has its own colour and shape.

**Architecture:** The node graph is derived from the existing job definition by a pure function (`nodeModel.ts`); every canvas edit is a reducer action on the job definition, so the engine and the stored format stay as they are, plus one new `layout` field (node positions) and an optional step `output` field. A shared style module holds the palette, shapes and ports, used by the builder canvas and the run page.

**Tech Stack:** React 18 + TypeScript, `@splunk/react-ui` 5.18 (SUIT), `@splunk/themes` (categorical palette A), `@dagrejs/dagre`, Jest + RTL; Python server (`bin/so`), pytest.

**Spec:** `docs/superpowers/specs/2026-11-16-node-editor-design.md`

## Global Constraints

- Every rule of `docs/superpowers/specs/2026-11-10-usability-design.md` section 2 holds: sentence case everywhere; buttons start with a verb; errors say what is wrong and how to fix it; destructive actions confirmed in a `Modal` titled with a question; no `Badge`, `Chip` or filled pill for run or step status.
- Colours only from theme tokens (`useSplunkTheme()`): node families use exactly the tokens in spec section 4; no hex literals in components or style modules.
- Shapes, port order, glyphs and port-to-edge/hook mapping exactly as spec sections 3 and 4.
- No change to `engine.py`, `actions.py`, `hidden.py`, the alert action or run semantics. Server changes only in `model._shape_issues` and `api._definition` (Task 1).
- No new npm or Python dependencies.
- Everything doable with the pointer is doable with the keyboard plus the properties panel.
- Opening and saving an old job without moving anything must not add `layout` or change any other field.
- Commands: `python -m pytest -q` (repo root); `cd ui && npx jest` and `cd ui && npm run typecheck`. All three green at the end of every task.
- Commit after each task with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push only to `origin` (lyderhansen); never to `upstream`.

## Review Focus

1. A job saved before 1.9.0 (no `layout`) opens laid out by dagre, `isDirty` is false, and a save sends no `layout` key. Test in Task 4.
2. Removing or renaming a step that has actions, conditions and saved positions leaves no orphan layout keys, the step's actions go with it, and one Undo restores everything. Test in Task 4.
3. Moving an action from a step to the Whole job (or between hooks) keeps every other field of the action unchanged. Test in Task 4.
4. A condition made from the If… port has an empty expression; the resulting error selects the condition node from the save list instead of doing nothing. Test in Task 9.
5. A hand-edited or stale `layout` (keys for deleted nodes, NaN, strings) never crashes the canvas: unknown keys are ignored and bad positions fall back to automatic placement. Tests in Tasks 1 and 5.

---

## Phase 1 — release 1.9.0: the node editor

### Task 1: Server accepts `layout` and step `output`

**Files:**
- Modify: `app/search_orchestrator/bin/so/model.py` (`_shape_issues`)
- Modify: `app/search_orchestrator/bin/so/api.py` (`_definition`, near line 684)
- Test: `tests/test_model.py`, `tests/test_api.py`

**Interfaces:**
- Produces: `layout = {"nodes": {key: {"x": number, "y": number}}}` and step `output = {"kind": "summary_index"|"lookup", ...}` accepted and stored; `_definition` drops `layout`.

- [ ] **Step 1: Write failing tests** in `tests/test_model.py`:
  - `test_layout_and_output_shapes_are_accepted`: `job(...)` with `layout={"nodes": {"step:a": {"x": 10, "y": -5.5}, "job": {"x": 0, "y": 0}}}` and step `a` with `output={"kind": "summary_index", "index": "summary", "source": "", "add_run_id": True}` → no `bad_shape` issue.
  - `test_bad_layout_or_output_is_bad_shape`: each of `layout=[]`, `layout={"nodes": []}`, `layout={"nodes": {"k": {"x": "1", "y": 0}}}`, `{"x": True, "y": 0}`, `{"x": float("nan"), "y": 0}`, `{"x": 2_000_000, "y": 0}`, 1001 keys, step `output="x"`, `output={"kind": "csv"}`, `output={"kind": "lookup", "name": 5}` → exactly one `bad_shape` issue; layout messages contain `"Tidy up"`.
  In `tests/test_api.py`: `test_moving_nodes_is_not_a_changed_definition` — save a job, start and fail a run, save again changing only `layout`, rerun step `b` with no `definition` → not 409 (mirror `test_rerun_requires_definition_choice_when_changed` at line 379).
- [ ] **Step 2: Run** `python -m pytest -q tests/test_model.py tests/test_api.py -k "layout or output or moving_nodes"` — expect FAIL.
- [ ] **Step 3: Implement.** In `_shape_issues`: layout message `"layout is broken; use Tidy up and save again"`; limits 1000 keys, finite `int`/`float` (not `bool`) with `abs(v) <= 1_000_000`; `output` must be a dict, `kind` in `("summary_index", "lookup")`, every other value `str` or `bool`, message `"step output must be a summary index or lookup; open the node and set it again"`. In `api._definition` also drop `"layout"`.
- [ ] **Step 4: Run** full `python -m pytest -q` — PASS.
- [ ] **Step 5: Commit** `feat(server): store node layout and step output, ignore layout when comparing definitions`.

### Task 2: Node model (pure)

**Files:**
- Create: `ui/src/features/builder/nodeModel.ts`
- Modify: `ui/src/api/types.ts` (add `layout?: { nodes: Record<string, { x: number; y: number }> }` to `JobDefinition`; add `output?: StepOutput` to `StepDef`, `StepOutput = { kind: 'summary_index'; index: string; source?: string; add_run_id?: boolean } | { kind: 'lookup'; name: string; append?: boolean }`)
- Test: `ui/src/__tests__/nodeModel.test.tsx`

**Interfaces:**
- Produces (exact names):
```ts
export type NodeKind = 'trigger_cron' | 'trigger_completion' | 'search' | 'saved_search' | 'previous'
  | 'summary_index' | 'lookup' | 'condition' | 'email' | 'webhook' | 'slack' | 'event'
  | 'alert_action' | 'start_job' | 'job';
export type PortId = 'success' | 'failure' | 'always' | 'start' | 'delayed' | 'if' | 'then';
export type ActionScope = 'job' | string; // 'job' or a step id
export const JOB_KEY = 'job';
export const stepKey: (id: string) => string;                // 'step:<id>'
export const triggerKey: (i: number) => string;              // 'trigger:<i>'
export const actionKey: (scope: ActionScope, i: number) => string; // 'action:job:<i>' | 'action:<stepId>:<i>'
export const condKey: (from: string, to: string) => string;  // 'cond:<from>><to>'
export interface FlowNode { key: string; kind: NodeKind; label: string; detail: string;
  stepId?: string; trigger?: number; action?: { scope: ActionScope; index: number }; edge?: { from: string; to: string }; }
export interface FlowLink { key: string; from: string; port: PortId | null; to: string;
  kind: 'edge' | 'action' | 'trigger' | 'condition'; data: boolean; }
export interface FlowGraph { nodes: FlowNode[]; links: FlowLink[]; }
export function buildGraph(job: JobDefinition): FlowGraph;
export function nodeKindOfStep(step: StepDef): NodeKind;
export function nodeKindOfAction(a: Action): NodeKind;      // webhook + preset 'slack' -> 'slack'
export function outputPorts(kind: NodeKind): PortId[];
export const HOOK_FOR_PORT: Record<PortId, Action['hook'] | null>;
export const EDGE_CONDITION_FOR_PORT: Record<PortId, Edge['condition'] | null>;
export function portForHook(hook: Action['hook']): PortId;
export function portForEdge(e: Edge): PortId;              // expression -> 'if'
export function canConnect(job: JobDefinition, from: string, port: PortId, to: string): { ok: true } | { ok: false; reason: string };
```

- [ ] **Step 1: Write failing tests** (`nodeModel.test.tsx`), using a job with a cron trigger, steps `a` (inline), `b` (previous, edge a→b on_success), `c` (saved_search, edge a→c expression `$a.resultCount$ > 0`), step `a` actions `[{hook:'on_failure', type:'email', to:'x@y'}]`, job actions `[{hook:'on_failure', type:'webhook', destination:'ops', preset:'slack'}]`:
  - `buildGraph` node keys equal, in this order: `trigger:0`, `job`, `step:a`, `step:b`, `step:c`, `cond:a>c`, `action:job:0`, `action:a:0`.
  - links: `trigger:0 → step:a` (kind `trigger`, port null; only to steps with no incoming edge); `step:a -success-> step:b` (kind `edge`, `data: true` because b is `previous`); `step:a -if-> cond:a>c` and `cond:a>c -then-> step:c` (kind `condition`, `data: false`); `job -failure-> action:job:0`; `step:a -failure-> action:a:0` (kind `action`).
  - `nodeKindOfAction` gives `slack` for the job webhook; `email` for the step action.
  - `outputPorts('search')` is `['success','failure','always','start','delayed','if']`; `outputPorts('job')` is `['success','failure','always','start','delayed']`; `outputPorts('condition')` is `['then']`; trigger and action kinds return `[]`.
  - `HOOK_FOR_PORT`: success→on_success, failure→on_failure, always→on_complete, start→on_start, delayed→on_delayed, if/then→null. `EDGE_CONDITION_FOR_PORT`: success→on_success, failure→on_failure, always→always, if→expression, others null.
  - `canConnect`: step port success → another step ok; step `start` → step is `{ok:false}` with reason `"Started and Delayed lines can only go to an action"`; success → `step:a` itself or one closing a cycle → reason containing `"loop"`; step success → `action:job:0` ok (moves it); `trigger:0` as `from` → not ok; `job` port `if` → not ok; to `job` or a trigger → not ok.
  - a job with no `layout`, no triggers, no actions: `buildGraph` gives `job` plus step nodes only, no throw; a link to a missing step id is dropped.
- [ ] **Step 2: Run** `cd ui && npx jest nodeModel` — FAIL.
- [ ] **Step 3: Implement** `nodeModel.ts`. Labels: steps use `stepLabel` from `GraphView.tsx`; trigger cron label `Schedule`, detail `describeSchedule(cron)` from `schedule.ts`; completion label `After another job`, detail `<job> <on>`; action labels `Email`, `Webhook`, `Slack`, `Event to an index`, `Alert action`, `Start another job`, detail = its main field (`to`, `destination`, `index`, `action`, `job`); `job` label `Whole job`; condition label `If…`, detail its expression or `Write a condition`.
- [ ] **Step 4: Run** jest + typecheck — PASS.
- [ ] **Step 5: Commit** `feat(builder): derive a node graph from the job definition`.

### Task 3: Node styles and shapes

**Files:**
- Create: `ui/src/features/builder/nodeStyle.ts`, `ui/src/features/builder/NodeShape.tsx`
- Test: `ui/src/__tests__/nodeStyle.test.tsx`

**Interfaces:**
- Consumes: `NodeKind`, `PortId` (Task 2).
- Produces:
```ts
export type Family = 'trigger' | 'search' | 'transform' | 'condition' | 'notify' | 'write' | 'chain' | 'job';
export type Shape = 'stadium' | 'rounded' | 'cut' | 'diamond' | 'flag' | 'cylinder' | 'parallelogram' | 'double';
export const FAMILY_OF: Record<NodeKind, Family>;
export const FAMILY_STYLE: Record<Family, { shape: Shape; colorToken: string; label: string }>;
export const PORT_STYLE: Record<PortId, { glyph: string; label: string; colorToken: string }>;
export function nodeSize(kind: NodeKind): { w: number; h: number };
export function shapePath(shape: Shape, w: number, h: number): string; // SVG path, origin top-left
export function portOffset(kind: NodeKind, port: PortId, visible: PortId[]): { x: number; y: number };
export function inputOffset(kind: NodeKind): { x: number; y: number } | null; // null: no input
// NodeShape.tsx
export function NodeShape(props: { node: FlowNode; theme: Theme; selected?: boolean; stroke?: string; status?: React.ReactNode }): JSX.Element;
export function PortHandle(props: { port: PortId; x: number; y: number; theme: Theme; connected: boolean }): JSX.Element;
```

- [ ] **Step 1: Write failing tests:** `FAMILY_OF` maps search/saved_search→search; previous→transform; summary_index/lookup/event→write; email/webhook/slack/alert_action→notify; start_job→chain; trigger_*→trigger; condition→condition; job→job. `FAMILY_STYLE` shapes and tokens exactly: trigger stadium `categoricalA1Strong`; search rounded `categoricalA2Strong`; transform cut `categoricalA3Strong`; condition diamond `categoricalA4Strong`; notify flag `categoricalA5Strong`; write cylinder `categoricalA7Strong`; chain parallelogram `categoricalA6Strong`; job double `borderColorStrong`. `PORT_STYLE` glyphs `✓ ✗ ∞ ▶ ⏱ ◇` and labels `Succeeded`, `Failed`, `Finished either way`, `Started`, `Delayed`, `If…`, plus `then` `→` `Then`; tokens success `statusColorNormal`, failure `statusColorHigh`, delayed `statusColorMedium`, others `contentColorMuted`. Every `shapePath` starts with `M` and is closed (`Z`). `inputOffset` is null for trigger kinds and `job`. Rendering `NodeShape` for an `email` node inside an `<svg>` with a theme stub shows the label and the family stripe uses the stub's `categoricalA5Strong` value.
- [ ] **Step 2: Run** `npx jest nodeStyle` — FAIL.
- [ ] **Step 3: Implement.** Stripe 4 px on the left inside the shape, body `backgroundColorSection`, text `contentColorDefault`, family icon from `@splunk/react-icons` coloured with the family token; Saved search draws a second inner stripe. Selected: `focusColor` outline.
- [ ] **Step 4: Run** jest + typecheck — PASS.
- [ ] **Step 5: Commit** `feat(builder): colours, shapes and ports for each node family`.

### Task 4: Reducer: layout and node edits

**Files:**
- Modify: `ui/src/features/builder/reducer.ts`
- Test: `ui/src/__tests__/reducer.test.tsx`

**Interfaces:**
- Consumes: Task 2 keys and types.
- Produces new `BuilderAction` members (exact):
```ts
| { type: 'moveNodes'; positions: Record<string, Pos> }        // merge into job.layout.nodes; one undo step
| { type: 'tidyLayout' }                                         // delete job.layout; one undo step
| { type: 'addNode'; kind: NodeKind; at?: Pos; from?: { key: string; port: PortId } }
| { type: 'updateAction'; scope: ActionScope; index: number; changes: Partial<Action> }
| { type: 'moveAction'; scope: ActionScope; index: number; toScope: ActionScope; hook: Action['hook'] }
| { type: 'removeAction'; scope: ActionScope; index: number }
| { type: 'updateTrigger'; index: number; changes: Partial<Trigger> }
| { type: 'removeTrigger'; index: number }
| { type: 'connectPort'; from: string; port: PortId; to: string }  // applies canConnect; no-op if not ok
```
  and `export function addNodeKey(job: JobDefinition, kind: NodeKind, from?: { key: string; port: PortId }): string` — the key `addNode` will create (callers select it).
- `addNode` rules: step kinds add a step (`nextStepId`; `previous` gets SPL `| stats count` like `addStepFrom`); with `from` a step port, connect with that port's edge condition (`if` → expression edge with `expression: ''`). Action kinds add `{ hook, type, ...defaults }` where hook = the `from` port's hook, else `on_failure` for notify kinds and `on_success` for others, scope = `from` step or `job` (`slack` = `webhook` with `preset: 'slack'`). Trigger kinds append `{type:'cron', cron:'0 6 * * *', enabled:true}` or `{type:'completion', job:'', on:'success', enabled:true}`. `at` is written to `layout.nodes[newKey]` in the same edit.
- Layout keys are kept consistent on every edit: rename step (via `updateStep` id change) moves `step:`, `action:<id>:*` and `cond:` keys; `removeStep` drops them; `removeAction`/`moveAction`/`removeTrigger` drop the removed key and shift later indexes down; `disconnect` of an expression edge drops its `cond:` key. A `layout` whose `nodes` becomes empty is deleted.

- [ ] **Step 1: Write failing tests**, including Review Focus 1–3:
  - `initialState(oldJob)` (no layout): `isDirty` false; `toDefinition(state.job)` has no `layout` key.
  - `moveNodes` then `undo` restores the job exactly; `tidyLayout` removes `layout`.
  - remove step `a` that has `action:a:0` and `cond:a>c` keys and actions: no key starting `step:a`, `action:a:`, `cond:a>` remains; one `undo` restores job and layout.
  - rename `a`→`load`: keys `step:load`, `action:load:0`, `cond:load>c` hold the old positions.
  - `moveAction` of `{hook:'on_failure', type:'email', to:'x', subject:'s'}` from `a` to `job` with hook `on_complete`: job action equals `{hook:'on_complete', type:'email', to:'x', subject:'s'}`; step `a` has no actions; position moved from `action:a:0` to `action:job:<n>`.
  - `removeAction` index 0 of two shifts `action:job:1`'s position to `action:job:0`.
  - `addNode` email from `{key:'step:a', port:'failure'}` at `{x:5,y:6}` → step a gets `{hook:'on_failure', type:'email', to:''}`, `layout.nodes['action:a:<i>']` = `{x:5,y:6}`, and `addNodeKey` returned that key; one undo removes both.
  - `addNode` search from `{key:'step:a', port:'if'}` → new step and edge `{from:'a', to:<id>, condition:'expression', expression:''}`.
  - `connectPort` that `canConnect` rejects leaves state identical (same object).
- [ ] **Step 2: Run** `npx jest reducer` — FAIL.
- [ ] **Step 3: Implement** in `reducer.ts`, keeping the existing `edits()` history behaviour (each new action is one undo step; `moveNodes` must not merge with the previous `moveNodes` unless `lastKey` logic already treats it as the same field — make each drop its own step).
- [ ] **Step 4: Run** jest + typecheck — PASS.
- [ ] **Step 5: Commit** `feat(builder): reducer edits for nodes, actions, triggers and saved positions`.

### Task 5: Flow layout

**Files:**
- Create: `ui/src/features/builder/flowLayout.ts`
- Test: `ui/src/__tests__/flowLayout.test.tsx`

**Interfaces:**
- Consumes: `FlowGraph`, `nodeSize` (Tasks 2, 3); `Pos`, `Positions` from `graphLogic.ts`.
- Produces: `export function layoutFlow(graph: FlowGraph, saved?: Record<string, unknown>): Positions` (top-left of every node key) and `export function graphBounds(graph: FlowGraph, pos: Positions): { x: number; y: number; width: number; height: number }`.

- [ ] **Step 1: Write failing tests:** no saved → every node has a position, left-to-right (`step:a.x < step:b.x` for edge a→b; trigger left of its step; action right of its source). Saved `{ 'step:a': {x:500,y:500} }` → `step:a` exactly there. A node with no saved position whose first incoming link's source is saved → placed 260 px right of that source, at the first y (step 80 from the source's y) not overlapping another placed node. Saved entries for unknown keys are ignored; entries with NaN, strings, missing `y` or `null` fall back to automatic placement; no throw (Review Focus 5).
- [ ] **Step 2: Run** `npx jest flowLayout` — FAIL.
- [ ] **Step 3: Implement** with dagre `rankdir: 'LR'` using `nodeSize` per node (condition nodes rank between their two steps).
- [ ] **Step 4: Run** jest + typecheck — PASS.
- [ ] **Step 5: Commit** `feat(builder): left-to-right layout that keeps saved positions`.

### Task 6: Flow canvas

**Files:**
- Create: `ui/src/features/builder/FlowCanvas.tsx`
- Port the keyboard, pan and zoom cases of `ui/src/__tests__/Canvas.test.tsx` into `FlowCanvas.test.tsx`; `Canvas.tsx` and its test are deleted in Task 9
- Test: `ui/src/__tests__/FlowCanvas.test.tsx`

**Interfaces:**
- Consumes: Tasks 2, 3, 5.
- Produces:
```ts
export type FlowSelection = { kind: 'node'; key: string } | { kind: 'link'; key: string } | null;
export interface FlowCanvasProps {
  graph: FlowGraph; positions: Positions; selected: FlowSelection; issues: Issue[];
  notes?: Record<string, { text: string; failed?: boolean } | null | undefined>; // by step id, as today
  readOnly?: boolean;
  status?: Record<string, { text: string; icon?: React.ReactNode; color?: string } | undefined>; // by node key (run page)
  onSelect: (sel: FlowSelection) => void;
  onMove?: (positions: Record<string, Pos>) => void;           // on drop only
  onConnect?: (from: string, port: PortId, to: string) => void;
  onDropOnCanvas?: (from: string, port: PortId, at: Pos) => void;
  onRequestRemove?: (key: string) => void;
  onQuickAdd?: (at: Pos) => void;
}
export default function FlowCanvas(props: FlowCanvasProps): JSX.Element;
```
- Behaviour (spec section 5): pan by dragging the background, wheel and buttons zoom (keep today's limits); drag a node to move it (calls `onMove` once on drop with the new top-left, snapped to 10 px); drag from a port: dropped on a node's body calls `onConnect`, dropped on empty canvas calls `onDropOnCanvas` with the canvas coordinate; Started, Delayed and If… ports show only when the node is hovered or selected or the port already has a link; trigger links drawn dashed and not selectable; links coloured by their port's token; `F` frames all nodes; arrows nudge the selected node by 10 px (`onMove`); `Delete`/`Backspace` on a selected node calls `onRequestRemove` (not for `job`); `/`, or `Tab` without Shift while the pointer is over the canvas, calls `onQuickAdd` at the pointer (or the view centre) and prevents default; nodes are focusable in graph order with `aria-label` "<family label> <label>, <detail>"; Enter selects; issue markers as today (`issuesByStep`). `readOnly` hides ports and disables moving.

- [ ] **Step 1: Write failing tests** for: renders one element per node with `data-testid="node-<key>"`; clicking a node calls `onSelect({kind:'node', key})`; pointer-drag of `node-step:a` by (100, 0) calls `onMove({ 'step:a': {x: old+100, y: old} })` once; drag from `port-step:a-failure` onto `node-step:b` calls `onConnect('step:a','failure','step:b')`; drop on empty canvas calls `onDropOnCanvas`; `/` calls `onQuickAdd`; `Tab` with pointer over the canvas calls `onQuickAdd`, `Shift+Tab` does not; `Delete` on selected `step:a` calls `onRequestRemove('step:a')` and on `job` does nothing; `ArrowRight` nudges by 10; `readOnly` renders no `port-*` elements; Started port hidden until hover.
- [ ] **Step 2: Run** `npx jest FlowCanvas` — FAIL.
- [ ] **Step 3: Implement**, reusing the pan/zoom code and `ArrowMarker`/`edgePath` idea from `Canvas.tsx`/`GraphView.tsx` (edges now leave a port on the right and enter the input on the left).
- [ ] **Step 4: Run** jest + typecheck — PASS (BuilderPage still imports `Canvas` until Task 9: keep `Canvas.tsx` until then, delete it in Task 9).
- [ ] **Step 5: Commit** `feat(builder): flow canvas with ports, free placement and keyboard control`.

### Task 7: Node catalog and quick-add

**Files:**
- Create: `ui/src/features/builder/nodeCatalog.ts`, `ui/src/features/builder/QuickAdd.tsx`
- Test: `ui/src/__tests__/QuickAdd.test.tsx`

**Interfaces:**
- Produces:
```ts
export interface CatalogEntry { kind: NodeKind; label: string; family: Family; keywords: string[]; description: string; }
export const CATALOG: CatalogEntry[]; // phase 1: trigger_cron, trigger_completion, search, saved_search, previous, email, webhook, event, alert_action, start_job
export function targetKinds(port: PortId | null, fromKind: NodeKind | null): NodeKind[];
export function searchCatalog(query: string, kinds?: NodeKind[]): CatalogEntry[];
export interface QuickAddProps { open: boolean; at: { left: number; top: number }; kinds?: NodeKind[]; onChoose: (kind: NodeKind) => void; onClose: () => void; }
export default function QuickAdd(props: QuickAddProps): JSX.Element | null;
```
- `targetKinds`: from `success|failure|always` → step kinds and action kinds; `start|delayed` → action kinds; `if` → step kinds; `then` → step kinds; null (no line) → everything in `CATALOG`.

- [ ] **Step 1: Write failing tests:** `searchCatalog('mail')` first entry `email`; `searchCatalog('summary')` is empty in phase 1; `targetKinds('delayed','search')` has no step kinds; QuickAdd open: input focused, typing "web" then Enter calls `onChoose('webhook')`; ArrowDown moves the highlight; Escape calls `onClose`; groups headed by family label; each option shows its description.
- [ ] **Step 2: Run** `npx jest QuickAdd` — FAIL.
- [ ] **Step 3: Implement** with SUIT `Popover` (or positioned `div`) + `Search` + `Menu`; labels sentence case.
- [ ] **Step 4: Run** jest + typecheck — PASS.
- [ ] **Step 5: Commit** `feat(builder): quick-add box for nodes`.

### Task 8: Properties panels for each node kind

**Files:**
- Create: `ui/src/features/builder/ActionPanel.tsx`, `ui/src/features/builder/TriggerPanel.tsx`, `ui/src/features/builder/JobNodePanel.tsx`
- Modify: `ui/src/features/builder/ActionsEditor.tsx` → export `ActionFields` (one action's type and type-specific fields, unchanged behaviour) and remove the list wrapper once unused; `ui/src/features/builder/StepPanel.tsx` (remove the "Step actions" section); `ui/src/features/builder/EdgePanel.tsx` (serves a selected step→step link and a condition node)
- Move: the time zone field from `TriggersTab.tsx` to the Settings tab in `JobTabs.tsx` (help: "Used by every schedule and Run when in this job.")
- Test: `ui/src/__tests__/ActionPanel.test.tsx`, `TriggerPanel.test.tsx` (port `TriggersTab.test.tsx` cases), update `ActionsEditor.test.tsx`, `StepPanel.test.tsx`

**Interfaces:**
- Consumes: Task 4 actions.
```ts
ActionPanel(props: { job: JobDefinition; scope: ActionScope; index: number; destinations; alertActions; tokenGroups;
  dispatch: React.Dispatch<BuilderAction>; onMoved: (key: string) => void; onRequestRemove: (key: string) => void })
TriggerPanel(props: { job: JobDefinition; index: number; jobs; nextSlots; dispatch; onRequestRemove: (key: string) => void; onOpenSettings: () => void })
JobNodePanel(props: { job: JobDefinition; onSelect: (key: string) => void })
```
- ActionPanel has a **When** `Select` listing every valid source × hook as `"<step label> · <port label>"` and `"Whole job · <port label>"`; changing it dispatches `moveAction` and calls `onMoved(newKey)`. Its fields are `ActionFields`. Button "Remove action" (destructive). Token groups come from `availableTokens(job, scope === 'job' ? null : scope, previewFields)` (the caller computes).
- TriggerPanel: schedule presets, next runs and the line "Times are in <tz or the server's time zone>." with a link button "Change time zone" calling `onOpenSettings`; completion fields as in TriggersTab; "Enabled" switch; "Remove trigger".
- JobNodePanel: one paragraph — "Lines from Whole job fire for the whole run. Without a Failed line, the fallback notification in Settings is used." — and a list of its outgoing actions as link buttons selecting them.

- [ ] **Step 1: Write failing tests:** ActionPanel When change from `Daily summary · Failed` to `Whole job · Finished either way` dispatches `{type:'moveAction', scope:'a', index:0, toScope:'job', hook:'on_complete'}`; email fields edit dispatch `updateAction`; TriggerPanel preset change dispatches `updateTrigger` with the preset's cron; StepPanel no longer renders "Step actions"; Settings tab renders the "Time zone" field.
- [ ] **Step 2: Run** the new/changed tests — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** jest + typecheck — PASS.
- [ ] **Step 5: Commit** `feat(builder): a properties panel for every node kind`.

### Task 9: Wire the Flow tab, issues and release 1.9.0

**Files:**
- Modify: `BuilderPage.tsx`, `JobTabs.tsx` (TabId becomes `'steps' | 'params' | 'access' | 'settings'`; `TAB_LABELS.steps = 'Flow'`), `issueTabs.ts`, `readiness.ts`, `SetupChecklist.tsx`, `IssueSummary.tsx` usage
- Delete: `Canvas.tsx`, `Canvas.test.tsx`, `TriggersTab.tsx`, `TriggersTab.test.tsx` (cases ported in Task 8), unused code in `ActionsEditor.tsx`
- Release: `CHANGELOG.md` (1.9.0 section), `app/search_orchestrator/default/app.conf` (`version = 1.9.0` in `[id]` and `[launcher]`, `build = 4`), `app/search_orchestrator/README.md`, `docs/user-guide.md`, `docs/admin-guide.md` version lines; `docs/user-guide.md` new section "The flow editor" (ports table, node colours and shapes, quick-add keys)
- Test: `BuilderPage.test.tsx`, `issueTabs.test.tsx`, `readiness.test.tsx`

**Interfaces:**
- Consumes everything above. Produces `export function nodeForIssue(job: JobDefinition, issue: Issue): string | null` in `issueTabs.ts`: `issue.step` → `stepKey(step)`, unless the code is `bad_expression`/`unknown_token` on a step that is the target of an expression edge whose expression is empty or invalid → that `condKey`; trigger codes (`bad_cron`, `bad_trigger`, `job_chain_cycle`) → `triggerKey(0)` if a trigger exists; action codes (`bad_action`, `unknown_destination`, `no_failure_notification`) → `JOB_KEY`; else null. `tabForIssue` maps `bad_timezone`/`timezone_fallback` → `settings`, `bad_param` → `params`, everything else → `steps`.
- BuilderPage: selection is `FlowSelection`; the toolbar has "Add node" (opens QuickAdd at the view centre), "Tidy up" (dispatches `tidyLayout`); `onDropOnCanvas` opens QuickAdd with `targetKinds(port, kind)` and on choose dispatches `addNode` with `from` and `at`, then selects `addNodeKey(...)`; the remove Modal title is `Remove <label>?` and its button `Remove step` / `Remove action` / `Remove trigger` / `Remove condition` by kind; the side panel picks StepPanel / ActionPanel / TriggerPanel / EdgePanel / JobNodePanel by selection; the empty-panel hint becomes "Select a node to edit it. Drag from a port on the right of a node to connect it, or press / to add a node."; readiness items that pointed to `triggers`/`actions` open Flow and select `triggerKey(0)` or `JOB_KEY` (or open QuickAdd with trigger kinds when there is no trigger).

- [ ] **Step 1: Write failing tests:** BuilderPage shows tabs `Flow, Parameters, Access, Settings` (no Triggers, no Actions); adding an email via QuickAdd after dropping a line from a step's Failed port results in a saved job whose step has `{hook:'on_failure', type:'email'}`; clicking a save-list error for an empty condition selects `cond:a>c` and shows the condition panel (Review Focus 4); a `no_failure_notification` warning's checklist item selects the Whole job node; `nodeForIssue` unit cases for each branch.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**, then release edits.
- [ ] **Step 4: Run** `python -m pytest -q`, `cd ui && npx jest`, `npm run typecheck`, `npm run build` — all PASS.
- [ ] **Step 5: Commit** `feat(builder): the Flow tab replaces Triggers and Actions` and `release: 1.9.0`.

---

## Phase 2 — release 1.10.0: more nodes and the run page

### Task 10: Summary index, Lookup and Slack nodes

**Files:**
- Create: `ui/src/features/builder/outputs.ts`, `ui/src/features/builder/OutputPanel.tsx`
- Modify: `nodeCatalog.ts` (add `summary_index`, `lookup`, `slack`), `reducer.ts` (`addNode` for these kinds), `BuilderPage.tsx` (panel choice), `StepPanel.tsx` (not used for output steps)
- Test: `ui/src/__tests__/outputs.test.tsx`, `OutputPanel.test.tsx`

**Interfaces:**
```ts
export const OUTPUT_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/;
export function outputSpl(o: StepOutput): string;
export function outputIssue(o: StepOutput): string | null; // client message or null
OutputPanel(props: { job; stepId; dispatch; onRequestRemove })
```
- `outputSpl`: `{kind:'summary_index', index:'summary'}` → `| collect index=summary marker="so_run=$run.id$"`; with `source:'daily rollup'` → `| collect index=summary source="daily rollup" marker="so_run=$run.id$"`; `add_run_id:false` drops the marker; `{kind:'lookup', name:'hosts.csv'}` → `| outputlookup hosts.csv`; `append:true` → `| outputlookup append=true hosts.csv`. Quotes in `source` are escaped `\"`.
- `outputIssue`: empty index → `"Type the summary index to write to"`; bad name → `"Use letters, numbers, _ . : or - in the index name"` (lookup: `"…in the lookup name"`).
- OutputPanel edits the fields, writes `output` and `spl` together through `updateStep`, shows the SPL read-only, and has "Edit as search" (drops `output`, keeps `spl`, node becomes Results of earlier steps). Slack = webhook with `preset: 'slack'` in ActionPanel, labelled "Slack".
- `addNode('summary_index', from)` creates a `previous` step with `output: {kind:'summary_index', index:'', add_run_id:true}` and the matching `spl`; the step id prefix `summary`; lookup prefix `lookup`.

- [ ] **Step 1: Write failing tests** for every `outputSpl`/`outputIssue` case above; OutputPanel typing an index updates both `output.index` and `spl`; "Edit as search" removes `output`; `searchCatalog('summary')` now returns `summary_index`; `nodeKindOfStep` returns `summary_index` for such a step.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** all — PASS.
- [ ] **Step 5: Commit** `feat(builder): summary index, lookup and Slack nodes`.

### Task 11: Data lines, legend and minimap

**Files:**
- Modify: `FlowCanvas.tsx`
- Create: `ui/src/features/builder/Legend.tsx`, `ui/src/features/builder/Minimap.tsx`
- Test: `FlowCanvas.test.tsx`, `Legend.test.tsx`

- Links with `data: true` drawn 3 px solid; signal links 1.5 px; trigger links dashed. Toolbar button "Show node types" toggles `Legend` (one row per family: shape swatch, colour, label, example kinds; port glyph list). `Minimap` (bottom-right, 160×100) shows when `graphBounds` exceeds the view; clicking it pans there; hidden from screen readers (`aria-hidden`), the "Frame all" button and `F` key are the accessible equivalent.

- [ ] **Step 1: Write failing tests:** a data link's path has `stroke-width` 3 and a signal link 1.5; Legend lists all 8 family labels; minimap absent for a 2-node graph and present when bounds exceed the view (mock sizes); clicking the minimap changes the pan transform.
- [ ] **Step 2–4:** run FAIL, implement, run PASS.
- [ ] **Step 5: Commit** `feat(builder): data lines, node legend and minimap`.

### Task 12: Run page uses the flow graph

**Files:**
- Modify: `ui/src/features/run/RunGraph.tsx`, `ui/src/pages/run/index.tsx` (pass the run's definition snapshot and its action rows)
- Create: `ui/src/features/run/actionStates.ts`
- Delete: `GraphView.tsx` exports no longer used (keep `stepLabel`, `stepTypeLabel` or move them to `nodeModel.ts`)
- Test: `ui/src/__tests__/actionStates.test.tsx`, `RunGraph.test.tsx`

**Interfaces:**
```ts
export function actionStates(definition: JobDefinition, rows: ActionRun[]): Record<string, { state: string; attempts?: number; error?: string }>;
RunGraph(props: { definition: JobDefinition; states: Record<string, StepStatus | undefined>; actions: ActionRun[]; onSelect?: (stepId: string) => void; selected?: string | null })
```
- Read `actions.py` (`indexed_actions`, `_entry`, the row fields) and map each row entry to its node key: the entry's `index` is the global index from `indexed_actions` (job actions first, then each step's in step order). If the row shape differs, map by `step_id` + `hook` + `type` and record the ruling. A node with several rows (several occurrences) shows the newest.
- RunGraph renders `FlowCanvas` `readOnly` with `layoutFlow(buildGraph(definition), definition.layout?.nodes)`, step status from `states` (today's `statusLabel`/`statusIcon`), action status text "Sent", "Failed", "Retrying", "Not sent yet" (no filled pills), and calls `onSelect(stepId)` only for step nodes.

- [ ] **Step 1: Write failing tests** for `actionStates` (job action index 0 and step action → correct keys; newest occurrence wins) and RunGraph (failed step shows "Failed"; a sent email node shows "Sent"; clicking an action node does not call `onSelect`).
- [ ] **Step 2–4:** run FAIL, implement, run PASS.
- [ ] **Step 5: Commit** `feat(run): the run page draws the job's flow with action states`.

### Task 13: Docs, Help and release 1.10.0

**Files:**
- Modify: `docs/user-guide.md` (summary index, lookup and Slack nodes, legend, minimap, run page graph; screenshots not required), `CHANGELOG.md` (1.10.0), version lines in `app.conf` (`version = 1.10.0` in `[id]` and `[launcher]`, `build = 5`), `app/search_orchestrator/README.md`, `docs/admin-guide.md`; the Help page renders the user guide, so check its headings render (`HelpPage.test.tsx` still passes).
- [ ] **Step 1:** Edit docs; keep the copy rules.
- [ ] **Step 2: Run** `python -m pytest -q`, `cd ui && npx jest`, `npm run typecheck`, `npm run build`, then `scripts/package.sh 1.10.0` and check the tgz contains every page bundle.
- [ ] **Step 3: Commit** `release: 1.10.0`.
