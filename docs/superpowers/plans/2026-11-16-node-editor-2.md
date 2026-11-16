# Node Editor Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the six small output ports with one `+` handle (click → When list, drag → choose on drop), add ten editor improvements, block previews that would write data, and animate running jobs on the run page's Graph view.

**Architecture:** The job definition stays the single source of truth; every canvas gesture becomes a reducer action. New behaviour lives in small pure modules (outcomes, splice, clipboard, align, groups, writing-command detection, run-flow state) with thin components on top; `FlowCanvas.tsx` (642 lines today) is split so gestures, menus and overlays are separate files. The only server change is a shape check for `layout.groups`.

**Tech Stack:** React 18 + TypeScript, `@splunk/react-ui` 5.18 (SUIT), `@splunk/themes`, `@dagrejs/dagre`, Jest + RTL; Python server (`bin/so`), pytest.

**Spec:** `docs/superpowers/specs/2026-11-16-node-editor-2-design.md` (round 1: `docs/superpowers/specs/2026-11-16-node-editor-design.md`)

## Global Constraints

- Sentence case everywhere; buttons start with a verb; errors say what is wrong and how to fix it; destructive actions confirmed in a `Modal` titled with a question; no `Badge`, `Chip` or filled pill for run or step status.
- Colours only from theme tokens (`useSplunkTheme()`); no hex literals in components or style modules.
- Everything doable with the pointer is doable with the keyboard (plus the properties panel).
- Every animation respects `prefers-reduced-motion: reduce` (no pulse, spinner or flowing dashes; colours, timers and text stay).
- No change to `engine.py`, `actions.py`, `hidden.py` or run semantics. Server change only in `model._shape_issues` (Task 12).
- Opening and saving a job without editing must not add `layout` or change any field. `layout` is never `null`; it is kept when it holds `groups` even with no `nodes`.
- No new npm or Python dependencies.
- Commands: `python3 -m pytest -q` (repo root); `cd ui && NODE_OPTIONS= npx jest`; `cd ui && NODE_OPTIONS= npm run typecheck`; `cd ui && NODE_OPTIONS= npm run build`. All green at the end of every task.
- Commit after each task, message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push only to `origin` (lyderhansen).
- No file the plan touches grows past ~600 lines; split along the plan's file list.

## Review Focus

1. A click on `+` that moves 1–3 px is still a click (opens the When list), not a drag; a drag released on the source node itself does nothing. Test in Task 4.
2. Splicing a node into a data line and undoing restores the exact edges, outcome and positions. Test in Task 3.
3. Paste into another job: ids that collide are renamed, tokens inside pasted SPL follow the rename, and nothing pasted connects to an existing node. Test in Task 8.
4. A group whose nodes were deleted, or a group from a hand-edited layout with bad numbers, never crashes the canvas; the server rejects bad shapes. Tests in Task 12.
5. On the run page, a poll that arrives mid-animation (state changes from running to succeeded) updates lines and text without the follow-pan fighting a user who has panned. Test in Task 15.

---

## Phase 1 — release 1.11.0: connecting

### Task 1: Previews never run writing commands

**Files:** Create `ui/src/features/builder/writingCommands.ts`; modify `previewLogic.ts` (`previewRefusal`), `OutputPanel.tsx`/`StepPanel.tsx` (dimmed Preview with reason); test `ui/src/__tests__/writingCommands.test.tsx`, `previewLogic.test.tsx`.

**Interfaces:** Produces `export const WRITING_COMMANDS = ['collect','outputlookup','outputcsv','tscollect','mcollect','meventcollect','sendemail','delete'] as const; export function writingCommand(spl: string): string | null` (the first writing command used as a command, else null).

- [ ] **Step 1: Failing tests.** `writingCommand('index=a | collect index=s')` → `'collect'`; `'| OutputLookup x.csv'` → `'outputlookup'`; `'index=a [ search index=b | outputcsv f ]'` → `'outputcsv'`; `'index=a | eval collect=1'` → null; `'index=a "| collect"'` (inside a quoted string) → null; `'| makeresults | delete'` → `'delete'`; `''` → null. `previewRefusal` for an inline step whose SPL has `| collect` → `"Previews don't write to indexes or lookups; remove collect to preview this step."`; in live mode a step whose upstream inline step has `| outputlookup` → `"Previews don't write to indexes or lookups; <upstream name> runs outputlookup first."`; a `saved_search` step is not inspected.
- [ ] **Step 2: Run** `cd ui && NODE_OPTIONS= npx jest writingCommands previewLogic` — FAIL.
- [ ] **Step 3: Implement.** Tokenise enough to skip double-quoted strings; a command is the first word after `|` (at top level or after `[`). Use it in `previewRefusal` after the existing `output` checks. Preview buttons show the reason as `disabled="dimmed"` + help text, like OutputPanel does today.
- [ ] **Step 4: Run** jest + typecheck — PASS.
- [ ] **Step 5: Commit** `feat(builder): previews never run commands that write data`.

### Task 2: Outcome model, tabs and line labels (pure)

**Files:** Create `ui/src/features/builder/outcomes.ts`; modify `nodeStyle.ts` (replace `portOffset` with `handleOffset`, `tabOffset`), `flowCanvasGeometry.ts` (`linkEnds` uses tabs), `nodeModel.ts` only if a helper is missing; tests `outcomes.test.tsx`, `nodeStyle.test.tsx`, `flowCanvasGeometry.test.tsx`.

**Interfaces:**
```ts
export type Outcome = Exclude<PortId, 'then'>;          // success | failure | always | start | delayed | if
export interface WhenOption { outcome: Outcome; label: string; glyph: string; count: number; note?: string; }
export function whenOptions(job: JobDefinition, from: string, to?: string | null): WhenOption[];
// from a node: outcomes it can emit (outputPorts minus 'then'); with `to`: only those canConnect allows.
// labels: 'Succeeds','Fails','Finishes either way','Starts','Is delayed','If a condition is true'; note 'actions only' for start/delayed when `to` is null.
export function usedOutcomes(graph: FlowGraph, key: string): PortId[];   // in outputPorts order, includes 'then' for conditions
export function linkLabel(job: JobDefinition, link: FlowLink): string;  // '✗ Fails', condition → its expression cut to 24 chars + '…', trigger → ''
export function lineMenuOutcomes(job: JobDefinition, link: FlowLink): Outcome[]; // outcomes the line may change to
// nodeStyle.ts
export function handleOffset(kind: NodeKind): { x: number; y: number };            // centre of '+', right edge, vertical centre
export function tabOffset(kind: NodeKind, index: number, count: number): { x: number; y: number }; // tab anchor; tabs stacked above the handle, 22 px apart
export const HANDLE_R = 13;
```
- [ ] **Step 1: Failing tests.** For the round-1 test job (steps a,b,c; a→b success; a→c expression; a's email on failure; job webhook slack on failure): `whenOptions(job,'step:a')` has 6 options with `count` 1 for success, failure and if; `whenOptions(job,'step:a','step:b')` excludes start/delayed; `whenOptions(job,'step:a','action:job:0')` has no 'if'; `whenOptions(job,'job')` has no 'if'. `usedOutcomes(graph,'step:a')` = `['success','failure','if']`. `linkLabel` of a→b = `'✓ Succeeds'`; of `cond:a>c`→c = the expression. `lineMenuOutcomes` of a step→action line excludes 'if'; of a step→cond line includes every step outcome (choosing one converts it). `handleOffset('search')` is on the right edge at mid-height; `tabOffset` indexes stack upward from the handle and never overlap it.
- [ ] **Step 2–4:** FAIL, implement, PASS (jest + typecheck). Remove `portOffset`/`visiblePorts` once no caller is left at the end of Task 4 — not here; keep them exported until then.
- [ ] **Step 5: Commit** `feat(builder): outcome model for the + handle, tabs and line labels`.

### Task 3: Reducer — change outcome, splice, place right of

**Files:** Modify `reducer.ts`; create `ui/src/features/builder/splice.ts`; modify `flowLayout.ts` (`freeSpotRightOf`); tests `reducer.test.tsx`, `splice.test.tsx`, `flowLayout.test.tsx`.

**Interfaces:**
```ts
| { type: 'changeOutcome'; link: string; outcome: Outcome }      // edge → updateEdge condition (if → expression ''), action → hook (moveAction same scope), step→cond line → plain edge (drops expression and cond key)
| { type: 'splice'; node: string; link: string; at?: Pos; shown?: Positions }  // A→B becomes A→N (old outcome) + N→B (on_success); one undo step
export function canSplice(job: JobDefinition, node: string, link: string): { ok: true } | { ok: false; reason: string };
export function spliceMessage(job: JobDefinition, node: string, link: string): string; // "Weekly rollup now runs after Filter hosts succeeds. Undo brings back the old line."
export function freeSpotRightOf(graph: FlowGraph, pos: Positions, key: string, kind: NodeKind): Pos; // 260 px right, stepping down 80 px past overlapping boxes
```
`addNode` gains optional `rightOf?: string` (uses `freeSpotRightOf` when `at` is absent) and keeps `shown` seeding from round 1.
- [ ] **Step 1: Failing tests.** `canSplice`: a search node with no lines onto a→b → ok; an action, a trigger, a node with any line, or a condition line → not ok with a reason. `splice` of new step n into a→b (a→b `on_failure`): edges become a→n `on_failure` and n→b `on_success`; b is `previous` → b now reads n (its input is n); one `undo` restores edges, cond keys and positions exactly (Review Focus 2). `changeOutcome` on a→b to failure sets condition; on a's email line to `always` sets hook `on_complete`; on `step:a→cond:a>c` to success makes a→c `on_success` and drops the expression and `cond:a>c` layout key. `freeSpotRightOf` returns x = source.x + 260 and the first y not overlapping.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(builder): change a line's outcome, splice a node into a line`.

### Task 4: Canvas — `+` handle, When list, tabs, drag-to-choose

**Files:** Create `ui/src/features/builder/WhenMenu.tsx` (positioned listbox like QuickAdd; optional embedded node search below the outcomes), `ui/src/features/builder/useCanvasGestures.ts` (pan, node drag, line drag, click-vs-drag; moved out of FlowCanvas), `ui/src/features/builder/PlusHandle.tsx`; modify `FlowCanvas.tsx`, `NodeShape.tsx` (drop `PortHandle` use), `QuickAdd.tsx` (export its list so WhenMenu can embed it); delete `portOffset`, `visiblePorts`, `PortHandle` when unused; tests `FlowCanvas.test.tsx`, `WhenMenu.test.tsx`.

**Interfaces (FlowCanvas props change):**
```ts
onConnect?: (from: string, outcome: PortId, to: string) => void;              // unchanged meaning
onPlus?: (from: string, screen: ScreenPoint) => void;                          // click on + : caller opens WhenMenu
onDropOnNode?: (from: string, to: string, screen: ScreenPoint, outcome?: PortId) => void; // drag from + (no outcome) or from a tab (outcome set)
onDropOnCanvas?: (from: string, at: Pos, screen: ScreenPoint, outcome?: PortId) => void;
```
Test ids: `plus-<key>`, `tab-<key>-<outcome>`.
- Behaviour per spec §3: 26 px `+` always visible on nodes with outcomes (not triggers, not actions); click (pointer moved < 4 px) → `onPlus`; drag from `+` → line follows; drop on a node → `onDropOnNode` without outcome (caller asks); drop on canvas → `onDropOnCanvas` without outcome; drag from a tab → same callbacks with `outcome`; tabs (`usedOutcomes`) stacked above `+`, labelled glyph + word, ring in the outcome token; lines leave from their tab (`tabOffset`); keyboard: `+` or Shift+Enter on a focused node → `onPlus`.
- WhenMenu: `{ open; at; options: WhenOption[]; withSearch?: { kinds: (o: Outcome) => NodeKind[] }; onChoose: (o: Outcome, kind?: NodeKind) => void; onClose }`; with `withSearch`, Enter on an outcome moves focus to the node list filtered by `kinds(outcome)`.
- [ ] **Step 1: Failing tests:** a click on `plus-step:a` calls `onPlus`, and a 3 px movement still counts as a click (Review Focus 1); drag from `plus-step:a` onto `node-step:b` calls `onDropOnNode('step:a','step:b',…)` with no outcome; release on `step:a` itself calls nothing; drag from `tab-step:a-failure` onto canvas calls `onDropOnCanvas` with `'failure'`; tabs render only for used outcomes with their labels; `+` key on a focused node calls `onPlus`; trigger and action nodes have no `plus-*`. WhenMenu: arrow keys + Enter choose; with search, choosing an outcome then typing "mail" + Enter calls `onChoose('failure','email')`; Escape closes.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(builder): one + handle with a When list instead of six ports`.

### Task 5: Line labels, line menu, splice by drag, auto-pan

**Files:** Create `ui/src/features/builder/LineLabel.tsx`, `ui/src/features/builder/LineMenu.tsx`, `ui/src/features/builder/autoPan.ts`; modify `FlowCanvas.tsx`, `useCanvasGestures.ts`, `flowCanvasGeometry.ts` (`linkAt(point)` hit-test); tests `FlowCanvas.test.tsx`, `autoPan.test.tsx`.

**Interfaces:** FlowCanvas props add `onLineMenu?: (link: string, screen: ScreenPoint) => void` and `onSplice?: (node: string, link: string) => void`; `canSplice` passed in as `canSpliceNode?: (node: string, link: string) => boolean`. `export function autoPanStep(pt: Pos, view: {w:number;h:number}): Pos` — within 40 px of an edge returns a pan delta toward it, up to 16 px per frame, scaled by closeness; else `{x:0,y:0}`.
- Labels at each line's midpoint (`linkLabel`), hidden below 70 % zoom except on the selected line; click on a label → select line and `onLineMenu`; Enter on a focused line → `onLineMenu`. LineMenu (caller-rendered) lists "Change to …" options from `lineMenuOutcomes`, "Insert a node", "Remove line".
- While dragging a node with no lines over a line where `canSpliceNode` is true, the line highlights (`focusColor`, 3 px); dropping calls `onSplice` instead of `onMove`.
- Auto-pan during node drag, line drag and (Task 7) box selection, via `requestAnimationFrame`.
- [ ] **Step 1: Failing tests:** labels visible at zoom 1 and hidden at 0.6 except selected; clicking a label calls `onLineMenu`; dragging a lineless node over `link-a>b` and releasing calls `onSplice('step:n','<link key>')`; dragging a node with lines over a line calls `onMove`; `autoPanStep` cases (inside 40 px left edge → negative x; centre → 0).
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(builder): line labels and menu, drop a node onto a line, auto-pan`.

### Task 6: Wire 1.11.0 into the page, bigger canvas, release

**Files:** Modify `BuilderPage.tsx` (create `ui/src/features/builder/useFlowMenus.ts` for the When/line-menu/quick-add state if BuilderPage would pass ~600 lines), `NodePanel.tsx`, `FlowCanvas.tsx` (height + full screen), `Legend.tsx`, `docs/user-guide.md`, `CHANGELOG.md`, `app/search_orchestrator/default/app.conf` (`version = 1.11.0` in `[id]` and `[launcher]`, `build = 6`), README and admin-guide version lines; tests `BuilderPage.test.tsx`, `Legend.test.tsx`.

- `onPlus` → WhenMenu with `whenOptions(job, from)` and node search; choose → `addNode {kind, from:{key,port:outcome}, rightOf: from, shown: positions}` and select the new node.
- `onDropOnNode` → if `whenOptions(job,from,to)` has one option, `connectPort` at once; else WhenMenu (no search) at the drop point → `connectPort`. Outcome given (from a tab) → `connectPort` directly.
- `onDropOnCanvas` → WhenMenu with search (or straight to QuickAdd when an outcome is given) → `addNode` with `at`.
- `onLineMenu` → LineMenu → `changeOutcome` / QuickAdd then `splice` / remove (`disconnect` for edges; action lines offer no remove — they offer "Move to…" via the action panel).
- `onSplice` → `splice` and show `spliceMessage` as an info `Message` with an Undo button for 10 s.
- Canvas height: fills `window.innerHeight` minus its top offset (min 480), updated on resize; **Full screen** toolbar button toggles a fixed overlay with canvas + properties panel; Escape leaves.
- Legend: replace the port list with the When outcomes and an example tab and `+`.
- Docs: rewrite the ports table in "The flow editor" for the `+` handle, tabs, line labels and menu, splice, auto-pan, full screen, and the preview rule (writing commands; saved searches and macros not checked). CHANGELOG 1.11.0.
- [ ] **Step 1: Failing tests:** clicking `+` on a step, choosing Fails, typing "email", Enter → saved job has `{hook:'on_failure', type:'email'}` on that step and the email node sits 260 px to the right; dropping `+` on a node with only one allowed outcome connects without a menu; changing a line from Succeeds to Fails via its label menu updates the edge; full screen button toggles and Escape leaves; no `layout` sent when nothing moved.
- [ ] **Step 2–4:** FAIL, implement; run pytest, jest, typecheck, build — PASS.
- [ ] **Step 5: Commit** `feat(builder): + handle and line menus in the Flow tab` then `release: 1.11.0`.

---

## Phase 2 — release 1.12.0: editing at scale

### Task 7: Multi-select

**Files:** Modify `FlowCanvas.tsx`/`useCanvasGestures.ts` (Shift+click, Shift+drag box, Ctrl/Cmd+A, group move), `reducer.ts` (`removeNodes`), `BuilderPage.tsx`, `NodePanel.tsx` (create `ui/src/features/builder/SelectionPanel.tsx`), `RemoveNodeModal.tsx`; tests.

**Interfaces:** `FlowSelection` gains `| { kind: 'nodes'; keys: string[] }` (2+ keys; one key stays `{kind:'node'}`). Reducer `| { type: 'removeNodes'; keys: string[] }` (one undo step, any mix of steps, actions, triggers, conditions; `job` ignored; removes in an order that keeps indexes valid). `tidyLayout` gains optional `keys?: string[]` (re-place only those with dagre, others keep positions).
- Shift+drag on empty canvas draws a box (auto-pan applies); nodes whose boxes intersect it are selected. Moving any selected node moves all (one `moveNodes`). Delete on a multi-selection → Modal "Remove 4 nodes?" body listing names → `removeNodes`. SelectionPanel: "4 nodes selected", buttons Tidy up selection, Remove (Align/Distribute arrive in Task 10).
- [ ] Steps 1–5 as usual. Tests: Shift+click toggles; box select; group drag one `onMove` with all keys; `removeNodes` of a step and an action of another step + undo; Ctrl+A selects all but `job`. Commit `feat(builder): select, move and remove several nodes`.

### Task 8: Duplicate, copy and paste

**Files:** Create `ui/src/features/builder/clipboard.ts`; modify `reducer.ts` (`paste`), `FlowCanvas.tsx` (keys Ctrl/Cmd+C/V/D), `BuilderPage.tsx`; tests `clipboard.test.tsx`, `reducer.test.tsx`.

**Interfaces:**
```ts
export interface Clip { so_clipboard: 1; steps: StepDef[]; edges: Edge[]; job_actions: Action[]; triggers: Trigger[]; positions: Record<string, Pos>; }
export function copySelection(job: JobDefinition, keys: string[], pos: Positions): Clip;
export function parseClip(text: string): Clip | null;           // validates shape; null for anything else
export function pasteResult(job: JobDefinition, clip: Clip, at: Pos): { job: JobDefinition; keys: string[]; message: string };
| { type: 'paste'; clip: Clip; at: Pos }                         // one undo step; caller selects result keys via pasteResult
```
- Copy: selected steps (with their actions), edges whose both ends are selected, condition nodes count via their edge, job actions only if `job` is selected, triggers only if trigger nodes are selected. Paste: new ids via `nextStepId` for every pasted step whose id is taken, SPL/expression/action tokens rewritten with `renameTokens`, edges remapped, never connected to existing nodes; positions offset so the clip's top-left lands at `at`; message "Pasted 3 nodes" plus "; 1 needs a line into it" when a pasted `previous` step has no incoming edge. Duplicate = copy + paste at +40,+40. Clipboard: `navigator.clipboard.writeText/readText` with an in-memory fallback when it throws or is missing.
- [ ] Steps 1–5. Tests per Review Focus 3, plus `parseClip('hello')` → null and a clip with a lookup step into a job whose step ids differ. Commit `feat(builder): duplicate, copy and paste nodes`.

### Task 9: Right-click menu

**Files:** Create `ui/src/features/builder/CanvasMenu.tsx`; modify `FlowCanvas.tsx` (`onContextMenu` + Menu key / Shift+F10), `BuilderPage.tsx`; tests `CanvasMenu.test.tsx`, `FlowCanvas.test.tsx`.

**Interfaces:** FlowCanvas prop `onContext?: (target: { kind: 'node'; key: string } | { kind: 'nodes'; keys: string[] } | { kind: 'link'; key: string } | { kind: 'canvas'; at: Pos }, screen: ScreenPoint) => void`. CanvasMenu items by target per spec §4.3 (Rename focuses the panel's name field; Preview only for search-type nodes; Group arrives with Task 12 — render it disabled-dimmed with "Groups arrive in 1.12.0" until then, or add it in Task 12).
- [ ] Steps 1–5. Tests: right-click on a node lists Rename, Duplicate, Copy, Preview, Add a line, Remove; Shift+F10 on a focused node opens the same; canvas menu has Add node here, Paste, Tidy up; Escape closes and returns focus. Commit `feat(builder): right-click menu on nodes, lines and the canvas`.

### Task 10: Grid, alignment guides, align and distribute

**Files:** Create `ui/src/features/builder/align.ts`; modify `FlowCanvas.tsx`/`useCanvasGestures.ts`, `SelectionPanel.tsx`, `CanvasMenu.tsx`; tests `align.test.tsx`.

**Interfaces:** `export function guidesFor(moving: Box, others: Box[], tol = 6): { dx: number; dy: number; lines: Guide[] }`; `export function align(boxes: Record<string, Box>, how: 'left'|'center'|'right'|'top'|'middle'|'bottom'): Record<string, Pos>`; `export function distribute(boxes, axis: 'x'|'y'): Record<string, Pos>`. Grid toggle "Show grid" (20 px dots, `localStorage` key `so.flow.grid`, wrapped in try/catch).
- [ ] Steps 1–5. Tests for each function's maths and that a drag within 6 px of another node's left edge snaps to it and shows a guide. Commit `feat(builder): grid, alignment guides, align and distribute`.

### Task 11: Compact nodes and preview results on nodes

**Files:** Modify `nodeStyle.ts` (`nodeSize(kind, compact?)`), `NodeShape.tsx`, `flowLayout.ts` (sizes follow compact), `FlowCanvas.tsx` (toggle "Compact nodes", `localStorage` `so.flow.compact`; hover overlay shows the full node), `usePreviews.ts`/`previewNote` (rows + seconds), `BuilderPage.tsx` (pass `previewBars`); tests.

**Interfaces:** FlowCanvas prop `previews?: Record<string, { rows?: number; seconds?: number; error?: string }>` by step id replaces `notes`; node shows "1 204 rows · 3.2 s" and a 3 px bar (width = rows / max rows on canvas, family colour) or "Preview failed: <first line>" in `statusColorHigh` with the failure icon. Number format uses the browser locale.
- [ ] Steps 1–5. Tests: compact size used in layout when on; bar widths proportional; failed text. Commit `feat(builder): compact nodes and preview results on nodes`.

### Task 12: Groups

**Files:** Server `app/search_orchestrator/bin/so/model.py` (`_shape_issues`), `tests/test_model.py`; UI `ui/src/api/types.ts` (`layout.groups`), create `ui/src/features/builder/groups.ts`, `ui/src/features/builder/GroupFrame.tsx`; modify `reducer.ts` (group actions, `withNodes` keeps layout when groups exist), `FlowCanvas.tsx`, `CanvasMenu.tsx`, `NodePanel.tsx` (group panel: title, colour, collapse, Remove group), `flowLayout.ts`/`nodeModel.ts` (collapsed lines attach to the block); tests.

**Interfaces:**
```ts
export interface Group { id: string; title: string; color: 'categoricalA1'|…|'categoricalA7'; x: number; y: number; w: number; h: number; collapsed?: boolean; }
export function membersOf(group: Group, graph: FlowGraph, pos: Positions): string[]; // node boxes fully inside
export function groupAround(keys: string[], pos: Positions, graph: FlowGraph, pad = 24): Pick<Group,'x'|'y'|'w'|'h'>;
| { type: 'addGroup'; group: Group } | { type: 'updateGroup'; id: string; changes: Partial<Group> }
| { type: 'moveGroup'; id: string; dx: number; dy: number; members: string[] }   // frame + members, one undo step
| { type: 'removeGroup'; id: string }
```
Server rule per spec §6 (≤200 groups; id ≤40, title ≤80 strings; colour in the seven names; finite numbers ±1e6; w,h > 0; collapsed bool), message `"a group in layout is broken; remove it and save again"`.
- Collapsed: members hidden, the frame drawn as a block (title, "6 nodes"), lines to/from outside nodes drawn to the block; the run page always draws groups expanded (Task 15).
- [ ] Steps 1–5. Tests: server good/bad shapes; `membersOf`; move group moves members; deleting all members leaves the group harmless; a layout with groups and no nodes is kept, not dropped; bad group data from a hand-edited job doesn't crash the canvas (Review Focus 4); collapse/expand. Commit `feat: groups (backdrops) in the flow editor`.

### Task 13: Release 1.12.0

**Files:** `docs/user-guide.md` (multi-select, copy/paste, right-click, grid and guides, compact nodes, preview on nodes, groups), `CHANGELOG.md`, app.conf `version = 1.12.0`, `build = 7`, README, admin guide.
- [ ] Edit docs; run pytest, jest, typecheck, build; commit `release: 1.12.0`.

---

## Phase 3 — release 1.13.0: the live run graph

### Task 14: Run-flow state (pure)

**Files:** Create `ui/src/features/run/runFlow.ts`; extend `actionStates.ts` (Sending…, Retrying in N s); tests `runFlow.test.tsx`, `actionStates.test.tsx`.

**Interfaces:**
```ts
export type LineState = 'fired' | 'flowing' | 'wont' | 'pending';
export function lineStates(def: JobDefinition, steps: Record<string, StepStatus | undefined>, graph: FlowGraph): Record<string, LineState>;
// fired: source finished with this line's outcome (or the condition passed: target not skipped as not_taken); flowing: fired and target running/starting; wont: source finished with another outcome, or target skipped not_taken; pending: source not finished.
export function progress(def: JobDefinition, steps): { finished: number; total: number };   // succeeded, failed, skipped count as finished
export function waitingFor(def, steps, stepId): string | null;   // "Waiting for Weekly rollup"
export function rowLabels(def, steps, graph): Record<string, string>; // data lines from finished steps with result_count → "1 204 rows →"
export function actionLiveText(entry, now: number): string;       // done 'Sent'; failed 'Failed'; pending next_at>now 'Retrying in 30 s'; pending attempts>0 'Sending…'; else 'Not sent yet'
```
- [ ] Steps 1–5 with tests for each state and edge case (condition lines, `always` lines after failure, skipped `run_when`). Commit `feat(run): run-flow state for the live graph`.

### Task 15: Live, animated run graph and release 1.13.0

**Files:** Modify `ui/src/features/run/RunGraph.tsx`, create `ui/src/features/run/RunProgress.tsx`, modify `FlowCanvas.tsx` (props `lineStates`, `lineLabels`, `running` keys, `follow` + `onUserView`), `ui/src/pages/run/index.tsx`; docs `docs/user-guide.md` ("The run graph"), `CHANGELOG.md`, app.conf `version = 1.13.0`, `build = 8`, README, admin guide; tests `RunGraph.test.tsx`, `RunProgress.test.tsx`, `FlowCanvas.test.tsx`.

- Per spec §5: progress strip (state + icon, elapsed ticking each second client-side, bar, "3 of 5 steps finished", "Updates every 5 s"); running nodes: blue `focusColor` outline, spinner, client-ticked timer, pulse; lines styled by `lineStates` (fired: solid outcome colour; flowing: 3 px blue animated dashes; wont: faded dashed; pending: as drawn); row labels on data lines; waiting text; action live text; follow the running steps unless the user panned/zoomed since load, with a "Follow the run" button to re-enable; groups always expanded; reduced motion disables pulse, spinner and dash animation (CSS `@media (prefers-reduced-motion: reduce)`); finished runs: no animation, final picture.
- [ ] **Step 1: Failing tests:** progress text; a running step shows the spinner and a timer that advances with fake timers; flowing line has the animation class; `prefers-reduced-motion` (mock `matchMedia`) removes it; after a user pan, a new poll with another running step does not move the view, and "Follow the run" re-enables it (Review Focus 5); finished run shows no animated elements.
- [ ] **Step 2–4:** FAIL, implement; docs and release edits; run pytest, jest, typecheck, build — PASS.
- [ ] **Step 5: Commit** `feat(run): live, animated run graph` then `release: 1.13.0`.
