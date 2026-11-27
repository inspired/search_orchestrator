/* The builder's state: the job being edited and undo/redo history. Positions a person chose
 * are saved in job.layout; every other node is placed by the flow layout. */
import { toDefinition } from '../../api/client';
import type { Action, Edge, JobDefinition, StepDef, StepOutput, Trigger } from '../../api/types';
import { actionsOf, changeLineOutcome, disconnectJob, dropActionKey, parseAction, parseCond, removeActionJob, removeNodesJob } from './flowEdits';
import { pasteResult } from './clipboard';
import type { Clip } from './clipboard';
import { nextStepId, renameActions, renameStepTokens, renameTokens } from './stepRename';
import { renameTriggerSteps, setTriggerStep, syncTriggerSteps } from './triggerSteps';
import { insertJob, remapLayout, removeStepJob, removeTriggerJob, renameStepKeys, setActions, spliceJob, spotRightOf } from './flowEdits';
import { tidyJob, withNodes, withPlacedNode } from './flowEdits';
import { expandForPlaced, groupEdit } from './groups';
import type { GroupAction } from './groups';
import { wouldCycle } from './graphLogic';
import type { Pos } from './graphLogic';
import {
    EDGE_CONDITION_FOR_PORT,
    HOOK_FOR_PORT,
    actionKey,
    buildGraph,
    canConnect,
    condKey,
    stepKey,
    triggerKey,
} from './nodeModel';
import type { ActionScope, NodeKind, PortId } from './nodeModel';
import type { Outcome } from './outcomes';
import { FAMILY_OF } from './nodeStyle';
import { outputSpl } from './outputs';
import { generatedInputSpl } from './previewLogic';

interface Snapshot {
    job: JobDefinition;
}

export interface BuilderState extends Snapshot {
    /** What the server has: the loaded job, or the blank job for one never saved. */
    savedJob: JobDefinition;
    past: Snapshot[];
    future: Snapshot[];
    /** The field the last edit changed: typing into one field is a single undo step. */
    lastKey?: string;
}

export type BuilderAction =
    | { type: 'load'; job: JobDefinition }
    /** A template replaces the blank job as one undo step (load would clear history). */
    | { type: 'applyTemplate'; job: JobDefinition }
    /** A save went through: `job` (the definition sent) is now what the server has. */
    | { type: 'saved'; job: JobDefinition }
    | { type: 'addStep'; step?: Partial<StepDef> }
    /** Puts a copied clip into the job as one undo step (callers select `pasteResult(...).keys`). */
    | { type: 'paste'; clip: Clip; at: Pos; compact?: boolean }
    | { type: 'removeStep'; id: string }
    /** Any mix of steps, actions, triggers and conditions, as one undo step; `job` is ignored. */
    | { type: 'removeNodes'; keys: string[] }
    | { type: 'updateStep'; id: string; changes: Partial<StepDef> }
    | { type: 'connect'; from: string; to: string; condition?: Edge['condition'] }
    | { type: 'disconnect'; from: string; to: string }
    | { type: 'updateEdge'; from: string; to: string; changes: Partial<Edge> }
    /** Saved positions merge into job.layout.nodes: one undo step per drop. */
    | { type: 'moveNodes'; positions: Record<string, Pos> }
    /** With `keys`, re-places only those nodes, keeping the selection's top-left corner. */
    | { type: 'tidyLayout'; keys?: string[]; compact?: boolean }
    /** With `at`, `shown` (the positions on screen) is saved too, so other nodes stay put. */
    | {
          type: 'addNode';
          kind: NodeKind;
          at?: Pos;
          from?: { key: string; port: PortId };
          shown?: Record<string, Pos>;
          /** Without `at`: place the node in the first free spot right of this node. */
          rightOf?: string;
          /** Nodes are drawn compact, so spots and layouts use compact sizes. */
          compact?: boolean;
      }
    /** Changes the outcome of a line (its key is a FlowLink.key). */
    | { type: 'changeOutcome'; link: string; outcome: Outcome }
    /** Puts step `node` on the step-to-step line `link`: one undo step. */
    | { type: 'splice'; node: string; link: string; at?: Pos; shown?: Record<string, Pos> }
    /** Adds a new step of `kind` on the step-to-step line `link` (a line menu's "Insert a node"): one undo step. */
    | { type: 'insertNode'; kind: NodeKind; link: string; at?: Pos; shown?: Record<string, Pos> }
    | { type: 'updateAction'; scope: ActionScope; index: number; changes: Partial<Action> }
    | { type: 'moveAction'; scope: ActionScope; index: number; toScope: ActionScope; hook: Action['hook'] }
    | { type: 'removeAction'; scope: ActionScope; index: number }
    | { type: 'updateTrigger'; index: number; changes: Partial<Trigger> }
    | { type: 'removeTrigger'; index: number }
    | { type: 'connectPort'; from: string; port: PortId; to: string }
    /** The Simple view's edits: the whole job, as one undo step (edits with the same `key`
     * in a row, such as typing in one field, merge). */
    | { type: 'setJob'; job: JobDefinition; key?: string }
    /** Trigger `index` no longer starts `step`. */
    | { type: 'disconnectTrigger'; index: number; step: string }
    | { type: 'setJobField'; field: keyof JobDefinition; value: unknown }
    /** Groups (backdrops) in job.layout.groups; each is one undo step; typing a title, width or height in the panel is one. */
    | GroupAction
    | { type: 'undo' }
    | { type: 'redo' };

export { nextStepId, renameTokens };

const HISTORY = 100;

export function blankJob(): JobDefinition {
    return {
        name: '',
        description: '',
        enabled: true,
        catchup: 'all',
        after_give_up: 'hold',
        triggers: [],
        params: [],
        steps: [],
        edges: [],
        actions: [],
        defaults: {},
        run_roles: [],
    };
}

const normalised = (job: JobDefinition): JobDefinition => ({ ...job, steps: job.steps || [], edges: job.edges || [] });

/** `savedJob` is what the server has; it is `job` unless the job is a template not yet saved. */
export function initialState(job: JobDefinition, savedJob: JobDefinition = job): BuilderState {
    return { job: normalised(job), savedJob: normalised(savedJob), past: [], future: [] };
}

/** Whether the job differs from what the server has. */
export function isDirty(state: BuilderState): boolean {
    return JSON.stringify(toDefinition(state.job)) !== JSON.stringify(toDefinition(state.savedJob));
}

function edits(state: BuilderState, edited: JobDefinition, key?: string): BuilderState {
    const job = syncTriggerSteps(edited);
    if (key && key === state.lastKey) {
        return { ...state, job, future: [], lastKey: key };
    }
    const past = [...state.past, { job: state.job }].slice(-HISTORY);
    return { ...state, job, past, future: [], lastKey: key };
}

const fieldKey = (...parts: string[]) => parts.join('\u0000');

/** An edit that places the nodes `keys`: a collapsed group they land inside is expanded in the
 * same undo step, so the node placed never disappears into it. */
const places = (state: BuilderState, next: JobDefinition, keys: string[]) => edits(state, expandForPlaced(state.job, next, keys));

/** Switching a "Results of earlier steps" step to Search writes its generated input into the
 * SPL as `$step.sid$` tokens, so it keeps working. Switching to Results of earlier steps drops
 * the time range, which it never uses. Other type switches change nothing else. */
function convertType(job: JobDefinition, before: StepDef, after: StepDef): StepDef {
    if (after.type === 'previous' && before.type !== 'previous') {
        const out = { ...after };
        delete out.earliest;
        delete out.latest;
        return out;
    }
    if (before.type !== 'previous' || after.type !== 'inline') {
        return after;
    }
    const input = generatedInputSpl(job, before.id);
    if (!input) {
        return after;
    }
    const tail = (after.spl || '').trimStart();
    return { ...after, spl: tail ? `${input} ${tail}` : input };
}

const STEP_NODE_KINDS: NodeKind[] = ['search', 'saved_search', 'previous', 'summary_index', 'lookup', 'approval'];
const ID_PREFIX: Partial<Record<NodeKind, string>> = { summary_index: 'summary', lookup: 'lookup', approval: 'approval' };
const newStepId = (steps: StepDef[], kind: NodeKind) => nextStepId(steps, ID_PREFIX[kind]);
const ACTION_DEFAULTS: Partial<Record<NodeKind, Omit<Action, 'hook'>>> = {
    email: { type: 'email', to: '' },
    event: { type: 'event', index: '' },
    alert_action: { type: 'alert_action', action: '', params: {} },
    start_job: { type: 'start_job', job: '' },
};

/** Where a new action goes: the step the line starts from, else the whole job. */
function actionScope(from?: { key: string; port: PortId }): ActionScope {
    return from && from.key.startsWith('step:') ? from.key.slice(5) : 'job';
}

/** The key the node `key` has after connectPort with `line`: a line onto an action from
 * another step or the whole job moves it to the end of that list, and later actions in its
 * old list move down a place. */
export function keyAfterConnect(job: JobDefinition, line: { from: string; port: PortId; to: string }, key: string): string {
    const target = parseAction(line.to);
    if (!target || !HOOK_FOR_PORT[line.port] || !canConnect(job, line.from, line.port, line.to).ok) {
        return key;
    }
    const scope = actionScope({ key: line.from, port: line.port });
    if (scope === target.scope || (scope !== 'job' && !(job.steps || []).some((s) => s.id === scope))) {
        return key;
    }
    if (key === line.to) {
        return actionKey(scope, actionsOf(job, scope).length);
    }
    const at = parseAction(key);
    if (at && at.scope === target.scope && at.index > target.index) {
        return actionKey(at.scope, at.index - 1);
    }
    return key;
}

/** The key addNode creates for the same inputs (callers select it); '' when addNode does nothing. */
export function addNodeKey(job: JobDefinition, kind: NodeKind, from?: { key: string; port: PortId }): string {
    if (STEP_NODE_KINDS.includes(kind)) {
        return stepKey(newStepId(job.steps || [], kind));
    }
    if (kind === 'trigger_cron' || kind === 'trigger_completion') {
        return triggerKey((job.triggers || []).length);
    }
    if (ACTION_DEFAULTS[kind]) {
        const scope = actionScope(from);
        return actionKey(scope, actionsOf(job, scope).length);
    }
    return '';
}

function addNodeJob(job: JobDefinition, kind: NodeKind, from?: { key: string; port: PortId }): JobDefinition | null {
    const steps = job.steps || [];
    if (STEP_NODE_KINDS.includes(kind)) {
        const id = newStepId(steps, kind);
        let step: StepDef = { id, name: '', type: 'inline', spl: '', earliest: '-24h', latest: 'now' };
        if (kind === 'saved_search') {
            step = { id, name: '', type: 'saved_search', saved_search_ref: '' };
        } else if (kind === 'approval') {
            // No search, time range, retries or max runtime: the server refuses an approval step with them.
            step = { id, type: 'approval', name: 'Approval', approval: {} };
        } else if (kind === 'previous') {
            step = { id, name: '', type: 'previous', spl: '| stats count' };
        } else if (kind === 'summary_index' || kind === 'lookup') {
            const output: StepOutput =
                kind === 'summary_index' ? { kind, index: '', add_run_id: true } : { kind, name: '' };
            step = { id, name: '', type: 'previous', spl: outputSpl(output), output };
        }
        let edges = job.edges || [];
        const src = from && from.key.startsWith('step:') ? from.key.slice(5) : null;
        const condition = from ? EDGE_CONDITION_FOR_PORT[from.port] : null;
        if (src && condition && steps.some((s) => s.id === src)) {
            const edge: Edge = { from: src, to: id, condition };
            if (condition === 'expression') {
                edge.expression = '';
            }
            edges = [...edges, edge];
        }
        const added = { ...job, steps: [...steps, step], edges };
        const fromTrigger = from && from.key.startsWith('trigger:') ? Number(from.key.slice(8)) : null;
        return fromTrigger !== null ? setTriggerStep(added, fromTrigger, id, true) || added : added;
    }
    if (kind === 'trigger_cron' || kind === 'trigger_completion') {
        const trigger: Trigger =
            kind === 'trigger_cron'
                ? { type: 'cron', cron: '0 6 * * *', enabled: true, steps: [] }
                : { type: 'completion', job: '', on: 'success', enabled: true, steps: [] };
        return { ...job, triggers: [...(job.triggers || []), trigger] };
    }
    const defaults = ACTION_DEFAULTS[kind];
    if (!defaults) {
        return null;
    }
    const scope = actionScope(from);
    if (scope !== 'job' && !steps.some((s) => s.id === scope)) {
        return null;
    }
    const hook = (from && HOOK_FOR_PORT[from.port]) || (FAMILY_OF[kind] === 'notify' ? 'on_failure' : 'on_success');
    return setActions(job, scope, [...actionsOf(job, scope), { hook, ...defaults } as Action]);
}

/** The action with `changes` applied; a field set to undefined is removed, not stored. */
function withChanges(a: Action, changes: Partial<Action>): Action {
    const out: Record<string, unknown> = { ...a, ...changes };
    Object.keys(changes).forEach((k) => {
        if (changes[k] === undefined) {
            delete out[k];
        }
    });
    return out as Action;
}

const same = (e: Pick<Edge, 'from' | 'to'>, from: string, to: string) => e.from === from && e.to === to;

export function reducer(state: BuilderState, action: BuilderAction): BuilderState {
    const { job } = state;
    const steps = job.steps || [];
    const edgeList = job.edges || [];
    switch (action.type) {
        case 'load':
            return initialState(action.job);
        case 'applyTemplate':
            return edits(state, action.job);
        case 'setJob':
            return edits(state, action.job, action.key);
        case 'saved':
            return { ...state, savedJob: normalised(action.job) };
        case 'addStep': {
            const id = action.step?.id || nextStepId(steps);
            const step: StepDef = { id, name: '', type: 'inline', spl: '', ...action.step };
            return edits(state, { ...job, steps: [...steps, step] });
        }
        case 'paste': {
            const pasted = pasteResult(job, action.clip, action.at, action.compact);
            return places(state, pasted.job, pasted.keys);
        }
        case 'removeStep':
            return edits(state, removeStepJob(job, action.id));
        case 'removeNodes': {
            const next = removeNodesJob(job, action.keys);
            return next ? edits(state, next) : state;
        }
        case 'updateStep': {
            const newId = action.changes.id;
            const renamed = newId !== undefined && newId !== action.id;
            if (renamed && steps.some((s) => s.id === newId)) {
                return state;
            }
            const nextSteps = steps.map((s) => {
                if (s.id !== action.id) {
                    return s;
                }
                const merged = convertType(job, s, { ...s, ...action.changes });
                if (merged.output === undefined) {
                    delete merged.output;
                }
                return merged;
            });
            if (!renamed) {
                const key = fieldKey('step', action.id, ...Object.keys(action.changes).sort());
                return edits(state, { ...job, steps: nextSteps }, key);
            }
            const to = newId as string;
            const swap = (id: string) => (id === action.id ? to : id);
            const edgesOut = edgeList.map((e) => {
                const next = { ...e, from: swap(e.from), to: swap(e.to) };
                if (typeof next.expression === 'string') {
                    next.expression = renameTokens(next.expression, action.id, to);
                }
                return next;
            });
            return edits(
                state,
                renameStepKeys(
                    renameTriggerSteps(
                        {
                            ...job,
                            steps: nextSteps.map((st) => renameStepTokens(st, action.id, to)),
                            edges: edgesOut,
                            actions: renameActions(job.actions, action.id, to),
                        },
                        action.id,
                        to
                    ),
                    action.id,
                    to
                )
            );
        }
        case 'connect': {
            const ids = new Set(steps.map((s) => s.id));
            if (
                !ids.has(action.from) ||
                !ids.has(action.to) ||
                edgeList.some((e) => same(e, action.from, action.to)) ||
                wouldCycle(edgeList, action.from, action.to)
            ) {
                return state;
            }
            const edge: Edge = { from: action.from, to: action.to, condition: action.condition || 'on_success' };
            return edits(state, { ...job, edges: [...edgeList, edge] });
        }
        case 'disconnect':
            return edits(state, disconnectJob(job, action.from, action.to));
        case 'updateEdge':
            return edits(
                state,
                {
                ...job,
                edges: edgeList.map((e) => {
                    if (!same(e, action.from, action.to)) {
                        return e;
                    }
                    const next = { ...e, ...action.changes };
                    if (next.condition !== 'expression') {
                        delete next.expression;
                    }
                    if (next.condition !== 'expression' || !next.expression_kind || next.expression_kind === 'simple') {
                        delete next.expression_kind; // absent means a simple comparison
                    }
                    if (next.condition !== 'expression' || (next.expression_kind || 'simple') !== 'search') {
                        delete next.earliest;
                        delete next.latest;
                    }
                    delete next.hidden_search;
                    return next;
                }),
                },
                fieldKey('edge', action.from, action.to, ...Object.keys(action.changes).sort())
            );
        case 'moveNodes': {
            if (Object.keys(action.positions).length === 0) {
                return state;
            }
            return places(state, withNodes(job, { ...job.layout?.nodes, ...action.positions }), Object.keys(action.positions));
        }
        case 'tidyLayout': {
            const next = tidyJob(job, action.keys, action.compact);
            return next ? edits(state, next) : state;
        }
        case 'addNode': {
            const key = addNodeKey(job, action.kind, action.from);
            const next = addNodeJob(job, action.kind, action.from);
            if (!next || !key) {
                return state;
            }
            let { at, shown } = action;
            if (!at && action.rightOf) {
                ({ at, shown } = spotRightOf(job, next, action.rightOf, action.kind, shown, action.compact));
            }
            return at ? places(state, withPlacedNode(next, key, at, shown), [key]) : edits(state, next);
        }
        case 'splice': {
            const next = spliceJob(job, action.node, action.link, action.at, action.shown);
            return next ? places(state, next, action.at ? [action.node] : []) : state;
        }
        case 'insertNode': {
            const added = STEP_NODE_KINDS.includes(action.kind) ? addNodeJob(job, action.kind) : null;
            const key = addNodeKey(job, action.kind);
            const next = added && insertJob(job, added, action.kind, key, action.link, action.at, action.shown);
            return next ? places(state, next, action.at ? [key] : []) : state;
        }
        case 'changeOutcome': {
            const link = buildGraph(job).links.find((l) => l.key === action.link);
            if (link && link.kind === 'action') {
                const target = parseAction(link.to);
                const hook = HOOK_FOR_PORT[action.outcome];
                if (!target || !hook) {
                    return state;
                }
                return reducer(state, { type: 'moveAction', scope: target.scope, index: target.index, toScope: target.scope, hook });
            }
            const next = changeLineOutcome(job, action.link, action.outcome);
            return next ? edits(state, next) : state;
        }
        case 'updateAction': {
            const list = actionsOf(job, action.scope);
            if (!list[action.index]) {
                return state;
            }
            const next = list.map((a, i) => (i === action.index ? withChanges(a, action.changes) : a));
            return edits(
                state,
                setActions(job, action.scope, next),
                fieldKey('action', action.scope, String(action.index), ...Object.keys(action.changes).sort())
            );
        }
        case 'removeAction': {
            const next = removeActionJob(job, action.scope, action.index);
            return next ? edits(state, next) : state;
        }
        case 'moveAction': {
            const list = actionsOf(job, action.scope);
            const moved = list[action.index];
            if (!moved) {
                return state;
            }
            if (action.toScope === action.scope) {
                if (moved.hook === action.hook) {
                    return state;
                }
                const next = list.map((a, i) => (i === action.index ? { ...a, hook: action.hook } : a));
                return edits(state, setActions(job, action.scope, next));
            }
            if (action.toScope !== 'job' && !steps.some((s) => s.id === action.toScope)) {
                return state;
            }
            const oldPos = job.layout?.nodes?.[actionKey(action.scope, action.index)];
            let next = setActions(job, action.scope, list.filter((_, i) => i !== action.index));
            next = dropActionKey(next, action.scope, action.index);
            const target = actionsOf(next, action.toScope);
            next = setActions(next, action.toScope, [...target, { ...moved, hook: action.hook }]);
            if (oldPos) {
                next = withNodes(next, { ...next.layout?.nodes, [actionKey(action.toScope, target.length)]: oldPos });
            }
            return edits(state, next);
        }
        case 'updateTrigger': {
            const list = job.triggers || [];
            if (!list[action.index]) {
                return state;
            }
            const next = list.map((t, i) => (i === action.index ? { ...t, ...action.changes } : t));
            return edits(
                state,
                { ...job, triggers: next },
                fieldKey('trigger', String(action.index), ...Object.keys(action.changes).sort())
            );
        }
        case 'removeTrigger': {
            const next = removeTriggerJob(job, action.index);
            return next ? edits(state, next) : state;
        }
        case 'disconnectTrigger': {
            const next = setTriggerStep(job, action.index, action.step, false);
            return next ? edits(state, next) : state;
        }
        case 'connectPort': {
            if (!canConnect(job, action.from, action.port, action.to).ok) {
                return state;
            }
            if (action.to.startsWith('action:')) {
                const target = parseAction(action.to);
                const hook = HOOK_FOR_PORT[action.port];
                const scope = actionScope({ key: action.from, port: action.port });
                if (!target || !hook) {
                    return state;
                }
                return reducer(state, { type: 'moveAction', scope: target.scope, index: target.index, toScope: scope, hook });
            }
            const toId = action.to.slice(5);
            if (action.from.startsWith('trigger:')) {
                const next = setTriggerStep(job, Number(action.from.slice(8)), toId, true);
                return next ? edits(state, next) : state;
            }
            if (action.from.startsWith('cond:')) {
                const c = parseCond(action.from);
                const old = c && edgeList.find((e) => same(e, c.from, c.to));
                if (!c || !old || c.to === toId || edgeList.some((e) => same(e, c.from, toId))) {
                    return state;
                }
                const retargeted = { ...job, edges: edgeList.map((e) => (e === old ? { ...e, to: toId } : e)) };
                return edits(
                    state,
                    remapLayout(retargeted, (key) => (key === action.from ? condKey(c.from, toId) : key))
                );
            }
            const condition = EDGE_CONDITION_FOR_PORT[action.port];
            const src = action.from.slice(5);
            if (!condition || edgeList.some((e) => same(e, src, toId))) {
                return state;
            }
            const edge: Edge = { from: src, to: toId, condition };
            if (condition === 'expression') {
                edge.expression = '';
            }
            return edits(state, { ...job, edges: [...edgeList, edge] });
        }
        case 'addGroup':
        case 'updateGroup':
        case 'moveGroup':
        case 'removeGroup': {
            const next = groupEdit(job, action);
            // Typing one field of the panel (title, width or height) merges into one step; a canvas
            // resize ({w, h}), colour or collapse is its own.
            const field = action.type === 'updateGroup' ? Object.keys(action.changes).join() : '';
            const key = action.type === 'updateGroup' && ['title', 'w', 'h'].includes(field) ? fieldKey('group', action.id, field) : undefined;
            return next ? edits(state, next, key) : state;
        }
        case 'setJobField': {
            const next = { ...job, [action.field]: action.value } as JobDefinition;
            if (action.value === undefined) {
                delete next[action.field]; // an unset field is absent, not an undefined key
            }
            return edits(state, next, fieldKey('job', action.field));
        }
        case 'undo': {
            const prev = state.past[state.past.length - 1];
            if (!prev) {
                return state;
            }
            return { ...state, ...prev, past: state.past.slice(0, -1), future: [{ job }, ...state.future], lastKey: undefined };
        }
        case 'redo': {
            const next = state.future[0];
            if (!next) {
                return state;
            }
            return { ...state, ...next, past: [...state.past, { job }], future: state.future.slice(1), lastKey: undefined };
        }
        default:
            return state;
    }
}
