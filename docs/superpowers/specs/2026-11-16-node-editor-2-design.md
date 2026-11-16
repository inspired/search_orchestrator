# Search Orchestrator: node editor, round 2

Date: 2026-11-16. Status: owner approved the direction; ready to plan.

Builds on `2026-11-16-node-editor-design.md` (released as 1.9.0 and 1.10.0). Every rule there and in the earlier specs still holds: sentence case; buttons start with a verb; errors say what is wrong and how to fix it; destructive actions confirmed in a `Modal` titled with a question; no `Badge`, `Chip` or filled pill for run or step status; colours only from theme tokens; everything doable with the pointer is doable with the keyboard; no change to how the engine runs a job.

Calls marked *(my call)* are Claude's; the owner can change them.

## 1. Intent

After trying 1.10.0 the owner found the six output ports per node too small to hit ("its very small") and wants one handle that offers the choices, with the chosen outcomes visible afterwards. The owner also picked ten editor improvements from a list of eleven, and wants the run page's Graph view to show a running job live, animated (option B of the mockups).

**Success:** connecting "when this fails, email ops" takes one click on a big handle (or one drag), never a hunt for a 12 px circle; large jobs stay manageable (select many, group, compact, copy between jobs); and someone watching a run sees which step is working, which lines fired and what is next, without reading a table.

## 2. Goals, non-goals, anti-goals

Goals:
- One `+` output handle per node with a list of outcomes (section 3).
- Outcomes in use shown as labelled tabs on the node and as labels on lines.
- The ten picked improvements (section 4).
- A live, animated run graph (section 5).

Non-goals:
- **Find a node (Ctrl/Cmd+F).** The owner left it unselected.
- **"Disable step" in the right-click menu.** It would need the engine to skip steps, so it is left out *(my call)*.
- Real-time collaboration; pushing run updates from the server (the run page keeps polling every 5 s while active).

Anti-goals:
- Motion that can't be turned off: every animation respects `prefers-reduced-motion` and falls back to the calm version.
- Losing the keyboard path: anything the `+` menu, drag, multi-select or right-click does must also work from the keyboard.
- Copy and paste that silently changes behaviour: pasted steps get new ids and any token that pointed at an old id is rewritten (the same rename logic as today).

## 3. The `+` handle

Replaces the six ports (Succeeded, Failed, Finished either way, Started, Delayed, If…) on search, transform, write and Whole job nodes. Condition nodes keep their single "Then" output, drawn as the same `+` style.

- **The handle:** one round `+`, 26 px, on the right edge, vertically centred, always visible. Hover and focus give it a ring in `focusColor`.
- **Click (no movement):** opens the **When** list next to the handle: ✓ Succeeds, ✗ Fails, ∞ Finishes either way, ▶ Starts, ⏱ Is delayed, ◇ If a condition is true. Each row shows how many lines already use it ("2 lines"). Started and Is delayed say "actions only"; the Whole job list has no "If". Choosing one opens the node search (today's quick-add, filtered with `targetKinds`). The chosen node is created **to the right of this node**, at the first free spot (260 px right, stepping down 80 px past other nodes), and connected with that outcome. Escape at any point cancels.
- **Hold and drag:** a line follows the pointer.
  - Dropped on a node: the When list opens at the drop point with only the outcomes `canConnect` allows for that target; choosing one connects. If exactly one outcome is allowed, it connects without asking *(my call)*.
  - Dropped on empty canvas: one popup with the When list on top and the node search below; the new node lands where the line was dropped.
- **Outcome tabs:** every outcome that has at least one line shows as a tab on the node's right edge above the `+`, labelled with its glyph and word ("✓ Succeeds", "✗ Fails"), with a ring in the outcome colour. Lines leave from their tab. Dragging from a tab starts a new line with that outcome already chosen (no list).
- **Line labels:** each line carries a small label at its midpoint with the glyph and word ("✗ Fails"; for conditions the expression, shortened). Labels hide below 70 % zoom *(my call)* and always show on the selected line. Clicking a label selects the line and opens a small menu: change outcome (the same list, only allowed ones), insert a node, remove the line. Changing the outcome of a step→action line is `moveAction` with the new hook; of a step→step line, `updateEdge` with the new condition (If… turns it into a condition node).
- **Conditions:** an If… line is drawn as today, step → diamond → target. The source node shows a "◇ If" tab; the label sits on the diamond → target line and shows the expression, shortened. On the step → diamond line, "Change outcome" turns the condition back into a plain line with the chosen outcome (the expression is dropped, one undo step) *(my call)*.
- **Keyboard:** with a node focused, Enter selects it and `+`/`Shift+Enter` opens the When list *(my call: Enter keeps meaning "select")*; arrow keys move in the list, Enter chooses, then the node search takes over. A focused line's menu opens with Enter.
- The legend and the user guide's ports table are rewritten for the handle, tabs and labels.

## 4. Editor improvements

1. **Select and move several nodes.** Shift+click adds to or removes from the selection; dragging a box on empty canvas with Shift held selects every node inside (plain drag still pans) *(my call)*. Ctrl/Cmd+A selects all. A multi-selection moves together (one undo step), Delete removes all of them after one confirm Modal ("Remove 4 nodes?"), and "Tidy up selection" re-runs automatic placement only for them. The properties panel shows "4 nodes selected" with Align, Distribute and Remove.
2. **Drop a node onto a line to insert it.** While a single node **that has no lines yet** is dragged over a step→step line, the line highlights; dropping splices the node in: `A → B` becomes `A → N → B`, keeping the original outcome on `A → N` and using Succeeds on `N → B` *(my call)*. For a data line, B now reads N's results — that is the point of inserting. Because this changes when B runs, the splice is one undo step and a short message says what changed ("Weekly rollup now runs after Filter hosts succeeds. Undo brings back the old line.") *(my call)*. Only allowed where `canConnect` allows both halves (a search-type node between two steps; actions, triggers and nodes that already have lines can't be inserted; condition lines can't be split). The quick-add from a line's menu ("Insert a node") does the same.
3. **Right-click menu.** On a node: Rename, Duplicate, Copy, Preview (search-type nodes), Add a line (opens the When list), Remove. On a multi-selection: Duplicate, Copy, Align, Distribute, Group, Remove. On a line: change outcome, insert a node, remove. On empty canvas: Add node here, Paste, Tidy up. The same menu opens with the Menu key or Shift+F10 on the focused item. Built with SUIT `Menu`.
4. **Duplicate, copy and paste.** Ctrl/Cmd+D duplicates the selection 40 px down-right. Ctrl/Cmd+C copies it to the clipboard as JSON (`{"so_clipboard": 1, "steps": [...], "edges": [...], "job_actions": [...], "triggers": [...], "positions": {...}}`) with an in-memory fallback when the clipboard API is not allowed. Ctrl/Cmd+V pastes at the pointer (or the view centre), in the same or another job. Pasted steps get new ids (`nextStepId`), edges and tokens among the pasted steps are rewritten to the new ids, edges to steps that were not copied are dropped, actions travel with their step; job-level actions and triggers are copied only when the Whole job node or trigger nodes were in the selection. Pasted nodes are never connected to existing nodes. A pasted step that lost its input (a Results of earlier steps, Summary index or Lookup node whose source wasn't copied), or that refers to a parameter, destination or saved search the target job doesn't have, is flagged by the normal checks, and a message says so ("Pasted 3 nodes; 1 needs a line into it") *(my call)*. A paste is one undo step and selects what was pasted.
5. **Preview result on the node.** After a preview, a search-type node shows "1 204 rows · 3.2 s" under its name and a thin bar whose length is its row count relative to the largest previewed count on the canvas (in the family colour, not a status colour). A failed preview shows "Preview failed: <first line of the error>" in `statusColorHigh` text with the failure icon.
6. **Groups (backdrops).** A titled, tinted frame behind nodes. Made from a selection (right-click → Group, or Ctrl/Cmd+G) or from the toolbar. Membership is spatial, as in Nuke: a node belongs to a group while its box is inside the frame. Dragging the title bar moves the frame and its nodes (one undo step); dragging the corner resizes it. Title is editable (double-click or the panel); colour is one of the seven categorical tokens at low opacity. **Collapse** shrinks the group to a single block showing its title and "6 nodes"; lines to and from outside nodes attach to the block; expand restores. Removing a group never removes its nodes. Groups are stored in `layout.groups` (section 6) and so never change run behaviour. The run page draws groups too, always expanded, whatever was saved *(my call)*, so running steps are never hidden.
7. **Alignment guides and grid.** A faint 20 px dot grid, toggled in the toolbar ("Show grid", remembered per browser). While dragging, guides appear when the node's left, centre or right (or top, middle, bottom) lines up with another node within 6 px, and the node snaps to it. Align (left, centre, right, top, middle, bottom) and Distribute (horizontally, vertically) work on a selection.
8. *(Find a node: not selected.)*
9. **Compact nodes.** A toolbar toggle ("Compact nodes", remembered per browser) draws every node as icon + name only, about 140×32; ports become the `+` alone. Hover or selection shows the full node as an overlay. Layout uses the compact sizes while the toggle is on.
10. **Auto-pan while dragging.** Dragging a node, a line or a selection box within 40 px of the canvas edge scrolls the canvas toward that edge, faster the closer the pointer is.
11. **Bigger canvas.** The canvas fills the window height below the page header (minimum 480 px) and the properties panel scrolls beside it. A **Full screen** toolbar button (and F11 is left to the browser) shows the canvas and panel over the whole page; Escape leaves it.

## 5. The live run graph (option B)

On the run page's Graph tab, while the run is active (`queued`, `running`, `paused`, `blocked`):

- **Progress strip** above the graph: run state in words with its icon, elapsed time ticking every second on the client between polls, a thin progress bar and "3 of 5 steps finished" (succeeded, failed and skipped steps count as finished) *(my call)*, and "Updates every 5 s".
- **Running steps:** a `focusColor`-blue outline, a spinner and a client-ticked timer ("0:31") in the node corner, and a gentle pulse.
- **Lines:** lines into a running step "flow" toward it (animated dashes, 3 px, blue). Lines that fired are solid in their outcome's colour. Lines that will not fire this run (the source finished with another outcome, or the target was skipped as not taken) are faded and dashed. Lines whose source has not finished stay as drawn in the builder.
- **Row counts on lines:** a finished search step's `result_count` rides on its outgoing data lines ("1 204 rows →").
- **Steps:** finished steps show their outcome and duration ("✓ Succeeded · 1 m 2 s"); waiting steps are dimmed and say what they wait for ("Waiting for Weekly rollup"); skipped steps are faded with today's skip wording.
- **Actions:** "Sending…" (pending with attempts, no `next_at` in the future), "Retrying in 30 s" (pending with `next_at` in the future, counted down), "Sent", "Failed", "Not sent yet".
- **Follow:** the canvas pans to keep running steps in view unless the user has panned or zoomed since the page loaded; a "Follow the run" toolbar button turns it back on.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, no pulse, spinner or flowing dashes; colours, timers and text stay.
- A finished run shows the final picture with no animation.

## 6. Server changes

- `model._shape_issues`: `layout` may also hold `groups`: a list of at most 200 objects with `id` (string, ≤ 40), `title` (string, ≤ 80), `color` (one of `categoricalA1`…`categoricalA7`), `x`, `y`, `w`, `h` (finite numbers, ±1 000 000, `w`/`h` > 0) and optional `collapsed` (bool). Anything else is `bad_shape` with "a group in layout is broken; remove it and save again".
- The client keeps `layout` when it holds groups but no node positions (today an empty `nodes` drops `layout`).
- No other server change. Copy and paste is client-side.

## 7. Releases

- **1.11.0, connecting:** the `+` handle, When list, outcome tabs, line labels and line menu; drop a node onto a line; auto-pan; bigger canvas and full screen; previews never write (section 9); legend and docs.
- **1.12.0, editing at scale:** multi-select, right-click menu, duplicate/copy/paste, alignment guides and grid, compact nodes, groups (with the server change), preview result on nodes.
- **1.13.0, the live run graph.**

## 8. Left to the builder

Exact pixel sizes beyond those given, animation timings, how the When list and line menu are built (SUIT `Menu` or a positioned listbox like QuickAdd), group tint opacity, and test structure.

## 9. Previews never write (owner decision)

Owner: "yes, include it in 1.11.0". On top of 1.10.0's refusal for Summary index and Lookup nodes, a preview is refused when the step's search, or the search of any step it would run first in a live preview, contains a writing command: `collect`, `outputlookup`, `outputcsv`, `tscollect`, `mcollect`, `meventcollect`, `sendemail` or `delete`, as a command after a pipe (case-insensitive, also inside subsearches `[ ... ]`). The check is in the browser (`previewLogic.ts`), the message is "Previews don't write to indexes or lookups; remove <command> to preview this step." and the Preview button is dimmed with that reason. Saved searches and macros are not expanded, so they are not caught; the user guide says so.
