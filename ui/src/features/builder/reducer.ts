/* The builder's state: the job being edited and undo/redo history. Where steps sit on the
 * canvas is not state: the canvas lays the graph out from the steps and edges. */
import type { Action, Edge, JobDefinition, StepDef } from '../../api/types';
import { wouldCycle } from './graphLogic';
import { generatedInputSpl } from './previewLogic';

interface Snapshot {
    job: JobDefinition;
}

export interface BuilderState extends Snapshot {
    past: Snapshot[];
    future: Snapshot[];
    /** The field the last edit changed: typing into one field is a single undo step. */
    lastKey?: string;
}

export type BuilderAction =
    | { type: 'load'; job: JobDefinition }
    | { type: 'addStep'; step?: Partial<StepDef> }
    /** A From previous steps step reading `from`, added with its edge as one undo step. */
    | { type: 'addStepFrom'; from: string; id: string }
    | { type: 'removeStep'; id: string }
    | { type: 'updateStep'; id: string; changes: Partial<StepDef> }
    | { type: 'connect'; from: string; to: string; condition?: Edge['condition'] }
    | { type: 'disconnect'; from: string; to: string }
    | { type: 'updateEdge'; from: string; to: string; changes: Partial<Edge> }
    | { type: 'setJobField'; field: keyof JobDefinition; value: unknown }
    | { type: 'undo' }
    | { type: 'redo' };

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

export function initialState(job: JobDefinition): BuilderState {
    const normal = { ...job, steps: job.steps || [], edges: job.edges || [] };
    return { job: normal, past: [], future: [] };
}

/** The id addStep gives a new step: step_<n>, unused. */
export function nextStepId(steps: StepDef[]): string {
    const ids = new Set(steps.map((s) => s.id));
    let n = steps.length + 1;
    while (ids.has(`step_${n}`)) {
        n += 1;
    }
    return `step_${n}`;
}

function edits(state: BuilderState, job: JobDefinition, key?: string): BuilderState {
    if (key && key === state.lastKey) {
        return { ...state, job, future: [], lastKey: key };
    }
    const past = [...state.past, { job: state.job }].slice(-HISTORY);
    return { job, past, future: [], lastKey: key };
}

const fieldKey = (...parts: string[]) => parts.join('\u0000');

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Rewrites `$old.sid$`, `$old.resultCount$`, `$old.status$` and `$old.first.f$` (with an
 * optional `|default`) to the new id. Anything else, such as a literal `$` or `$old$`,
 * is left as it is (the token grammar of bin/so/tokens.py). */
export function renameTokens(text: string, from: string, to: string): string {
    const re = new RegExp(`\\$${escapeRe(from)}(\\.(?:sid|resultCount|status|first\\.[A-Za-z0-9_]+)(?:\\|[A-Za-z0-9_.:@ -]*)?\\$)`, 'g');
    return text.replace(re, (_m, rest: string) => `$${to}${rest}`);
}

/** Every string inside an action (subject, message, payload, params values ...). */
function renameInValue(value: unknown, from: string, to: string): unknown {
    if (typeof value === 'string') {
        return renameTokens(value, from, to);
    }
    if (Array.isArray(value)) {
        return value.map((v) => renameInValue(v, from, to));
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
            out[k] = renameInValue(v, from, to);
        });
        return out;
    }
    return value;
}

const renameActions = (actions: Action[] | undefined, from: string, to: string) =>
    actions ? (actions.map((a) => renameInValue(a, from, to)) as Action[]) : actions;

function renameStepTokens(step: StepDef, from: string, to: string): StepDef {
    const out = { ...step };
    if (typeof out.spl === 'string') {
        out.spl = renameTokens(out.spl, from, to);
    }
    if (out.run_when && out.run_when.kind === 'expression' && typeof out.run_when.value === 'string') {
        out.run_when = { ...out.run_when, value: renameTokens(out.run_when.value, from, to) };
    }
    if (out.actions) {
        out.actions = renameActions(out.actions, from, to);
    }
    return out;
}

/** Switching a "From previous steps" step to Search writes its generated input into the
 * SPL as `$step.sid$` tokens, so it keeps working. Switching to From previous steps drops
 * the time range, which it never uses. Leaving Saved search drops `read_previous`, which
 * is how a step saved with that removed option is moved over. Other type switches change
 * nothing else. */
function convertType(job: JobDefinition, before: StepDef, changed: StepDef): StepDef {
    let after = changed;
    if (before.type === 'saved_search' && after.type !== 'saved_search') {
        after = { ...after };
        delete after.read_previous;
    }
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

const same = (e: Pick<Edge, 'from' | 'to'>, from: string, to: string) => e.from === from && e.to === to;

export function reducer(state: BuilderState, action: BuilderAction): BuilderState {
    const { job } = state;
    const steps = job.steps || [];
    const edgeList = job.edges || [];
    switch (action.type) {
        case 'load':
            return initialState(action.job);
        case 'addStep': {
            const id = action.step?.id || nextStepId(steps);
            const step: StepDef = { id, name: '', type: 'inline', spl: '', ...action.step };
            return edits(state, { ...job, steps: [...steps, step] });
        }
        case 'addStepFrom': {
            if (!steps.some((s) => s.id === action.from) || steps.some((s) => s.id === action.id)) {
                return state;
            }
            const step: StepDef = { id: action.id, name: '', type: 'previous', spl: '' };
            const edge: Edge = { from: action.from, to: action.id, condition: 'on_success' };
            return edits(state, { ...job, steps: [...steps, step], edges: [...edgeList, edge] });
        }
        case 'removeStep':
            return edits(state, {
                ...job,
                steps: steps.filter((s) => s.id !== action.id),
                edges: edgeList.filter((e) => e.from !== action.id && e.to !== action.id),
            });
        case 'updateStep': {
            const newId = action.changes.id;
            const renamed = newId !== undefined && newId !== action.id;
            if (renamed && steps.some((s) => s.id === newId)) {
                return state;
            }
            const nextSteps = steps.map((s) => (s.id === action.id ? convertType(job, s, { ...s, ...action.changes }) : s));
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
                {
                    ...job,
                    steps: nextSteps.map((st) => renameStepTokens(st, action.id, to)),
                    edges: edgesOut,
                    actions: renameActions(job.actions, action.id, to),
                }
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
            return edits(state, { ...job, edges: edgeList.filter((e) => !same(e, action.from, action.to)) });
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
                    return next;
                }),
                },
                fieldKey('edge', action.from, action.to, ...Object.keys(action.changes).sort())
            );
        case 'setJobField':
            return edits(state, { ...job, [action.field]: action.value } as JobDefinition, fieldKey('job', action.field));
        case 'undo': {
            const prev = state.past[state.past.length - 1];
            if (!prev) {
                return state;
            }
            return { ...prev, past: state.past.slice(0, -1), future: [{ job }, ...state.future], lastKey: undefined };
        }
        case 'redo': {
            const next = state.future[0];
            if (!next) {
                return state;
            }
            return { ...next, past: [...state.past, { job }], future: state.future.slice(1), lastKey: undefined };
        }
        default:
            return state;
    }
}
