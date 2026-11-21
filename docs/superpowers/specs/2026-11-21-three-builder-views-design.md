# Three builder views: Simple, Standard and Advanced

## Intent

The job builder has two views today: **Simple** (searches in order) and **Flow** (the node editor). In the node editor, triggers, conditions, actions and approvals are all nodes, so a canvas gets crowded and there is a lot to do in it. Mikael's original editor (inspired/main 1.7.1) was easier: a canvas with only the steps, and the rest in tabs and the step's side panel.

The user wants three views of the same job:

| View | What it is |
|---|---|
| **Simple** | Steps in order, as today. |
| **Standard** | The simplicity of Mikael's editor (steps on the canvas, the rest in tabs and panels) with everything Advanced can do. |
| **Advanced** | Today's node editor (the Flow view, renamed). |

Optimally you can switch between all three. Standard and Advanced must always be interchangeable. Simple can't show every job: once a job uses something Simple can't show, Simple is locked for it, and choosing it says why.

Also: **Create job** goes straight to a blank job. The template picker is removed; the example jobs do that job now.

## Goals

- Standard edits every job Advanced can, with nothing lost or changed when switching back and forth.
- Standard's canvas shows only steps and the lines between them.
- Switching views never changes the job definition. All three views edit the same `JobDefinition` through the same reducer actions.
- Simple is locked, with the reasons shown, for jobs it can't show.
- Create job opens a blank job with no popup.

## Non-goals

- Restoring Mikael's 1.7.1 code as is. His `TriggersTab`, `ScheduleEditor` form and panels predate today's job model. Standard is built from today's components.
- Giving Simple more features.
- Changes to the job model, the API or the engine. This is UI only.

## Anti-goals (a failure even if it works)

- Standard silently dropping or rewriting something Advanced made: an action, a condition, a trigger's chosen steps, groups or node positions.
- Standard feeling like the node editor, with trigger, action or condition nodes on its canvas.
- Two copies of the same panel logic to keep in step. Standard reuses Advanced's panels.

## Approaches

1. **Same job, fewer nodes (chosen).** Standard draws only step nodes and their lines. Triggers, actions and job actions live in tabs and the step panel, reusing `TriggerPanel`, `ActionFields`/`ActionPanel`, `EdgePanel`, `StepPanel`, `OutputPanel`, `ApprovalPanel` and `JobActionsTab`. One model and one reducer, so switching is free.
2. **Bring back Mikael's 1.7.1 editor and extend it.** It would look exactly like the original, but it means two editors to maintain, and his components don't know today's model (actions as nodes, conditions on lines, approval, write steps, trigger lines). Rejected.
3. **Advanced with a "hide non-step nodes" toggle.** The cheapest option, but it still feels like the node editor and doesn't give the tabbed simplicity. Rejected.

## Design

### Switching views

- The builder's first tab holds a three-way switch: **Simple · Standard · Advanced**. It replaces the Simple/Flow switch (`ViewSwitch`, `useBuilderView`, `so.builder.view`). A stored `flow` value reads as `advanced`.
- **Simple locked:** when `readSimple(job).reasons` is non-empty, the Simple button shows a lock and its tooltip says "Simple can't show this job". Clicking it does not switch. It shows a message listing the reasons ("Simple can't show this job: an approval step, more than one trigger. Use Standard or Advanced."). While in Simple, nothing can make a job un-simple, so a job can't become locked while you're in Simple.
- **The view that opens:** the remembered choice, if any. Otherwise Standard. A remembered Simple that is locked for this job opens Standard instead. *(My call: Standard is the main view.)*

### Standard: tabs

The tab bar: **Steps** (the canvas) · **Triggers** · Job actions · Parameters · Access · Settings · Source · History.

- The first tab is labelled **Steps** in Standard and Simple, and **Flow** in Advanced. *(My call.)*
- **The Triggers tab shows only in Standard.** Simple shows its single trigger at the top as today, and Advanced has trigger nodes. *(My call.)*
- Issue counts on tabs (`issueTabs.ts`): trigger issues count on Triggers in Standard, and on Steps/Flow otherwise.

### Standard: the Triggers tab

- One card per trigger, in order. Each card is today's `TriggerPanel`: the schedule editor with next runs and same-minute clashes, the busy-times strip, after another job, enabled, and remove with confirmation.
- Each card also has **Starts**: a multiselect of the steps with no line into them, which is `Trigger.steps`. Empty means every such step, which is today's meaning. This is how Standard sets what Advanced draws as trigger lines. It uses `triggerSteps.ts`.
- Two buttons: **Add schedule** and **Add after another job**. Both respect building blocks that are turned off (`activeCatalog`).

### Standard: the canvas

- Nodes are the steps only: `STEP_KINDS` (search, saved search, previous, summary index, lookup, approval), drawn with today's `NodeShape`/`FlowNodeView` look.
- Lines are the job's `edges`:
  - On success: no label.
  - On failure: "✗ Fails".
  - Either way: "∞ Either way".
  - On a condition: "◇" with the short condition (`conditionShort`).
- **Clicking a line** opens `EdgePanel`: its outcome, condition, condition test and remove.
- **Adding a line:** drag from a step's handle onto another step. It starts as on success, which can be changed in `EdgePanel`. `canConnect` and `wouldCycle` are checked as today.
- **Small markers on a step** show what Standard moved off the canvas:
  - a trigger mark when a trigger starts it;
  - "✉ N" for its actions;
  - "⌛" when it has its own deadline or delay alert.
- **Adding a step:** an **Add step** menu in the toolbar lists the step kinds from `activeCatalog`, with Beta tags. The new step is selected and its panel opens.
- **Positions:** the step nodes use the same `layout.nodes` keys (`stepKey`) as Advanced, so a step stays where it was when you switch. A **Tidy** button lays out the steps alone. Groups and the positions of non-step nodes are kept untouched in the definition, and Standard doesn't draw them.
- **Kept from Advanced, where they make sense with steps only:** selection, copy and paste of steps, undo and redo, zoom and fit, the minimap, the running marks while following a run, and preview.

### Standard: the step side panel

- Today's panel for the step's kind: `StepPanel`, `OutputPanel` or `ApprovalPanel`.
- Below it, a new **Actions** section with this step's actions (`step.actions`):
  - Each row shows its **When** (Starts, Succeeds, Fails, Finishes either way, Is delayed, and for approval, Asks for approval) and what it does, as a short summary.
  - **Add action** offers a When and a kind (the action kinds from `activeCatalog`, with Beta tags).
  - Editing a row opens its fields with `ActionFields`, including retries.
  - Remove asks for confirmation.
  - The When choices are `outputPorts(kind)` that map to a hook (`HOOK_FOR_PORT`).
- The job's own actions stay on the **Job actions** tab, as today.

### Create job

- **Create job**, and the empty Jobs page, go straight to a blank job.
- `TemplatePicker`, `templates.ts` and the `?template=` parameter are removed, along with their tests.
- The empty Jobs page offers **Create job** and **Browse examples**.

### Docs (the standing rule)

- `docs/user-guide.md`: "Simple and Flow" becomes "Simple, Standard and Advanced", with a Standard section (the canvas, the Triggers tab, step actions, the lock on Simple) and no templates in "Build a job".
- `helpIllustrations.tsx`: an illustration for each new or renamed heading.
- `Architecture.tsx`: the builder's text names the three views.
- `CHANGELOG.md`: a new minor release.

## What's left to the builder

- Component structure: a new `StandardCanvas` with its geometry reused from `flowCanvasGeometry`/`FlowLines`, a `StepActions` section, and a `TriggersTab` built from `TriggerPanel`.
- The exact marker icons and the switch's look, within the existing styles.
- Which Advanced canvas gestures carry over beyond the list above.
- Tests: each view renders the same job; switching Standard ↔ Advanced leaves the definition deep-equal; Simple's lock and its message; Triggers tab Starts; adding and removing step actions; a line's label and its EdgePanel; Create job opens with no picker.
