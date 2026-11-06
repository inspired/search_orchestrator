/* The builder's state: the job being edited, where its nodes sit on the canvas, and
 * undo/redo history. Positions are layout only and are not saved with the job. */
import type { Action, Edge, JobDefinition, StepDef } from '../../api/types';
import { autoLayout, NODE_H, Pos, Positions, wouldCycle } from './graphLogic';

interface Snapshot {
    job: JobDefinition;
    positions: Positions;
}

export interface BuilderState extends Snapshot {
    past: Snapshot[];
    future: Snapshot[];
    /** The field the last edit changed: typing into one field is a single undo step. */
    lastKey?: string;
}

export type BuilderAction =
    | { type: 'load'; job: JobDefinition }
    | { type: 'addStep'; step?: Partial<StepDef>; position?: Pos }
    | { type: 'removeStep'; id: string }
    | { type: 'moveStep'; id: string; x: number; y: number }
    | { type: 'layout' }
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
    return { job: normal, positions: autoLayout(normal.steps, normal.edges), past: [], future: [] };
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

function edits(state: BuilderState, job: JobDefinition, positions: Positions = state.positions, key?: string): BuilderState {
    if (key && key === state.lastKey) {
        return { ...state, job, positions, future: [], lastKey: key };
    }
    const past = [...state.past, { job: state.job, positions: state.positions }].slice(-HISTORY);
    return { job, positions, past, future: [], lastKey: key };
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

const same = (e: Pick<Edge, 'from' | 'to'>, from: string, to: string) => e.from === from && e.to === to;

export function reducer(state: BuilderState, action: BuilderAction): BuilderState {
    const { job, positions } = state;
    const steps = job.steps || [];
    const edgeList = job.edges || [];
    switch (action.type) {
        case 'load':
            return initialState(action.job);
        case 'addStep': {
            const id = action.step?.id || nextStepId(steps);
            const step: StepDef = { id, name: '', type: 'inline', spl: '', ...action.step };
            const lowest = Object.values(positions).reduce((m, p) => Math.max(m, p.y), -Infinity);
            const position = action.position || { x: 20, y: lowest === -Infinity ? 20 : lowest + NODE_H + 40 };
            return edits(state, { ...job, steps: [...steps, step] }, { ...positions, [id]: position });
        }
        case 'removeStep': {
            const rest = { ...positions };
            delete rest[action.id];
            return edits(
                state,
                {
                    ...job,
                    steps: steps.filter((s) => s.id !== action.id),
                    edges: edgeList.filter((e) => e.from !== action.id && e.to !== action.id),
                },
                rest
            );
        }
        case 'moveStep':
            return edits(state, job, { ...positions, [action.id]: { x: action.x, y: action.y } });
        case 'layout':
            return edits(state, job, autoLayout(steps, edgeList));
        case 'updateStep': {
            const newId = action.changes.id;
            const renamed = newId !== undefined && newId !== action.id;
            if (renamed && steps.some((s) => s.id === newId)) {
                return state;
            }
            const nextSteps = steps.map((s) => (s.id === action.id ? { ...s, ...action.changes } : s));
            if (!renamed) {
                const key = fieldKey('step', action.id, ...Object.keys(action.changes).sort());
                return edits(state, { ...job, steps: nextSteps }, positions, key);
            }
            const to = newId as string;
            const swap = (id: string) => (id === action.id ? to : id);
            const nextPositions = { ...positions, [to]: positions[action.id] };
            delete nextPositions[action.id];
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
                },
                nextPositions
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
                positions,
                fieldKey('edge', action.from, action.to, ...Object.keys(action.changes).sort())
            );
        case 'setJobField':
            return edits(state, { ...job, [action.field]: action.value } as JobDefinition, positions, fieldKey('job', action.field));
        case 'undo': {
            const prev = state.past[state.past.length - 1];
            if (!prev) {
                return state;
            }
            return { ...prev, past: state.past.slice(0, -1), future: [{ job, positions }, ...state.future], lastKey: undefined };
        }
        case 'redo': {
            const next = state.future[0];
            if (!next) {
                return state;
            }
            return { ...next, past: [...state.past, { job, positions }], future: state.future.slice(1), lastKey: undefined };
        }
        default:
            return state;
    }
}
