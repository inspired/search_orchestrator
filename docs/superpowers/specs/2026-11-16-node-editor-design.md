# Search Orchestrator: node editor

Date: 2026-11-16. Status: approved to build (owner said "gå i gang"; the calls marked *(my call)* are Claude's and can be changed).

Builds on `2026-11-05-search-orchestrator-design.md` and `2026-11-10-usability-design.md`. Every rule there still holds, in particular: no `Badge`, `Chip` or filled pill for run or step status; sentence case; buttons start with a verb; errors say what is wrong and how to fix it; destructive actions are confirmed in a `Modal`.

## 1. Intent

The owner wants the builder to feel like the node editors in DaVinci Resolve and Nuke: everything that happens before, during and after a search is a node on the canvas, and lines between nodes say what happens when. Today only searches are nodes. Notifications, writes to indexes, starting other jobs and the schedule hide in the side panel and in tabs, behind a "When" menu. The owner's words: "alle muligheter man gjør etter et søk er ferdig/feilet skal ut til en annen node", with summary index and email as examples, and "flere av innstillingene bør trekkes ut fra side menyen og heller inn som egne noder". Different node kinds get different colours and shapes.

**Success:** a user builds "search → summary index, and email when it fails" by dragging two lines out of a search's ports onto new nodes, without opening a menu named "When"; and the whole job, its schedule and its notifications can be read from the canvas alone.

## 2. Goals, non-goals, anti-goals

Goals:
- Triggers, actions and conditions become nodes. Hooks become output ports.
- Nodes are placed freely and their positions are saved with the job.
- Each node family has its own colour and shape.
- Nuke-style speed: a quick-add search box, drag-from-port to add a connected node, Delete to remove.
- New output nodes: Summary index and Lookup.
- The run page shows the same graph, with step and action states.

Non-goals:
- No change to how the engine runs a job, retries, holds or sends actions. The node graph is a new view over today's job format plus a `layout` field.
- No real-time collaboration, no node groups or backdrops yet, no "wait for any" merge node (the engine has no such semantics).

Anti-goals (a failure even if it works):
- A canvas you can only use with a mouse. Every node and connection must be reachable and editable from the keyboard and the properties panel.
- Red and green as the only thing that tells success from failure. Ports carry a glyph and a label too.
- Colour used as run status. Category colour is an accent (stripe, icon, port ring); status keeps today's status colours and icons and is never a filled pill.
- Saving a job changes its behaviour because the user only moved nodes.

## 3. The node model

The graph is derived from the job definition by a pure function, and every edit on the canvas becomes a reducer action on the job definition. There is no second source of truth.

| Node family | What it is in the job | Node key (for `layout`) |
|---|---|---|
| Trigger: Schedule | a `triggers[i]` with `type: cron` | `trigger:<i>` |
| Trigger: After another job | a `triggers[i]` with `type: completion` | `trigger:<i>` |
| Search, Saved search | a step with `type` `inline` / `saved_search` | `step:<id>` |
| Results of earlier steps | a step with `type: previous` | `step:<id>` |
| Summary index, Lookup (new) | a step with `type: previous`, an `output` field and generated SPL (section 6) | `step:<id>` |
| Condition | an edge with `condition: expression` | `cond:<from>><to>` |
| Email, Webhook, Slack, Event to an index, Alert action, Start another job | an entry in `steps[].actions` or `job.actions` | `action:<stepId>:<i>` or `action:job:<i>` |
| Whole job | the job itself (its job-level actions hang off it) | `job` |

**Ports.** Every search-type node has one input on its left and these outputs on its right, top to bottom:

| Port | Glyph | Step → step edge | Step → action hook |
|---|---|---|---|
| Succeeded | ✓ | `on_success` | `on_success` |
| Failed | ✗ | `on_failure` | `on_failure` |
| Finished either way | ∞ | `always` | `on_complete` |
| Started | ▶ | (not allowed) | `on_start` |
| Delayed | ⏱ | (not allowed) | `on_delayed` |
| If… | ◇ | creates a Condition node, then `expression` | (not allowed) |

Started, Delayed and If… show only while the node is hovered or selected, or when they already have a line *(my call: keeps nodes compact)*. The Whole job node has the same outputs except If…; lines from it make job-level actions. Trigger nodes have no ports you can drag: they draw a fixed dashed line to every step with no dependencies, because that is what a trigger starts.

**Allowed lines.** Step port to step input: makes an edge (cycle check as today). Step or Whole job port to an action node: sets that action's scope and hook, which may move it from one step's `actions` to another's or to `job.actions`. Action, trigger and Whole job nodes have no input except: an action node's input accepts exactly one line. A line dropped on empty canvas opens the quick-add box with only nodes that line can go to, and connects the new node.

**Data lines versus signal lines.** A line into a Results of earlier steps, Summary index or Lookup node carries data (that step reads the results); it is drawn thicker and solid. Every other line is a signal and is drawn thinner *(my call)*.

## 4. Colours and shapes

Colours are Splunk's categorical palette A from `@splunk/themes` (`categoricalA1`…`A7` and their `Strong` variants), which already has a light and a dark value, so nodes look right in both themes. The node body uses the normal panel background. The category colour is a 4 px stripe on the left, the icon colour and the port rings, never a fill behind text.

| Family | Shape | Colour token |
|---|---|---|
| Triggers | stadium (fully rounded ends) | `categoricalA1Strong` (purple) |
| Search, Saved search | rounded rectangle; Saved search has a second inner stripe | `categoricalA2Strong` (blue) |
| Results of earlier steps | rectangle with cut corners | `categoricalA3Strong` (teal) |
| Condition | diamond | `categoricalA4Strong` (amber) |
| Notify: Email, Webhook, Slack, Alert action | rectangle with a notched left edge (a flag) | `categoricalA5Strong` (pink) |
| Write data: Summary index, Lookup, Event to an index | cylinder | `categoricalA7Strong` (orange) |
| Start another job | parallelogram | `categoricalA6Strong` (slate) |
| Whole job | wide rounded rectangle with a double outline | `borderColorStrong` (neutral) |

Port glyphs are drawn in `contentColorDefault` on a ring of the port's meaning colour (`statusColorNormal` green for ✓, `statusColorHigh` for ✗, `statusColorMedium` for ⏱, muted for ∞ and ▶). The palette, shapes and port table live in one module so the run page and the builder share them. A small legend ("Node types") can be opened from the canvas toolbar.

## 5. The editor

- **Layout direction:** left to right (Resolve), so the output ports stack on the right edge *(my call; today's graph is top to bottom)*.
- **Free placement:** drag a node to move it. Positions are saved in `layout`. A node with no saved position is placed by dagre; **Tidy up** (toolbar) re-runs dagre for every node, as one undo step. Moving nodes is one undo step per drag.
- **Quick-add:** an **Add node** button opens a searchable menu of every node kind, grouped by family. With the canvas focused, `Tab` (when the pointer is over the canvas) or `/` opens the same box at the pointer; type "email", Enter adds it *(my call: Tab only with the pointer over the canvas, so keyboard users still Tab through nodes; `/` always works)*.
- **Selection and keys:** click selects; `Delete`/`Backspace` asks to remove the selected node (Modal titled "Remove <name>?"); arrow keys nudge a selected node by 10 px; `F` frames the whole graph; existing pan and zoom stay.
- **Properties panel:** the right panel edits only the selected node. Step nodes keep today's StepPanel without its Actions section. Action nodes get the fields from today's ActionsEditor for one action, plus a **When** field ("Daily summary · Failed", "Whole job · Failed", …) as the keyboard way to move its line. Trigger nodes get today's trigger fields (schedule presets, next runs, job picker). Condition nodes get today's EdgePanel expression field. Whole job shows a short explanation and its outgoing lines.
- **Tabs:** the Steps tab becomes **Flow**. The **Triggers** and **Actions** tabs go away; Parameters, Access and Settings stay. The setup checklist, issue counts and the save error list point to the node (select it, open Flow) instead of to the removed tabs.
- **Minimap:** a small overview in the canvas corner once the graph is larger than the view *(phase 2)*.

## 6. New nodes

- **Summary index:** fields Index (required), Source (optional), and "Add the run id" (on by default). Stored as a `previous` step with `output: {"kind": "summary_index", "index", "source", "add_run_id"}` and generated SPL `| collect index=<index>[ source="<source>"][ marker="so_run=$run.id$"]`. The SPL shows read-only in the panel; "Edit as search" turns the node into a plain Results of earlier steps node (drops `output`).
- **Lookup:** fields Lookup name (required) and "Append instead of replace". `output: {"kind": "lookup", "name", "append"}`, SPL `| outputlookup[ append=true] <name>`.
- **Slack:** a Webhook action with `preset: slack`, shown with its own name and icon; it needs a webhook destination like today.
- Index, source and lookup names are checked on the client (`^[A-Za-z0-9_][A-Za-z0-9_.:-]*$`) and the SPL is the truth the server runs; the server only checks the shape of `output`.

## 7. Server changes

- `model._shape_issues`: `layout` must be `{"nodes": {<key>: {"x": number, "y": number}}}` with at most 1000 keys and finite numbers in ±1 000 000; a step's `output`, if present, must be an object with `kind` in (`summary_index`, `lookup`) and string or boolean fields. Anything else is a `bad_shape` error whose message says how to fix it ("layout is broken; use Tidy up and save again").
- `api._definition` ignores `layout`, so moving nodes never counts as a changed definition (rerun "latest" vs "original").
- Nothing in the engine, actions, hidden searches or the alert action reads `layout` or `output`.
- Templates (`templates.ts`) gain positions only through dagre; no stored layout is needed.

## 8. Run page

The run page draws the run's definition snapshot with the same nodes, shapes and saved positions (read-only, no ports to drag). Steps show their state as today. Action nodes show their action run's state from the run detail's action list (sent, failed, retrying, not sent) with the same status text and icons, never filled pills. Selecting a step still opens its attempts.

## 9. Releases

- **1.9.0, the node editor:** node model, colours and shapes, ports, trigger, action, condition and Whole job nodes, free placement and `layout`, quick-add, properties panel per node, Flow tab replacing Triggers and Actions, server shape checks.
- **1.10.0, more nodes and the run page:** Summary index, Lookup and Slack nodes; data versus signal lines; minimap and legend; the run page graph with action states; docs and Help updated.

## 10. Left to the builder

Exact pixel sizes, port spacing, the dagre spacing for left-to-right, icon choices from `@splunk/react-icons`, how the quick-add box is built (a SUIT `ComboBox` or `Menu` with a `Search` field), and test structure.
