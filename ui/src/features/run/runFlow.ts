/* Pure run-flow state for the live graph: what each line, count and label shows for a run's step statuses. */
import type { ConditionStatus, Edge, JobDefinition, StepStatus } from '../../api/types';
import { conditionKind } from '../builder/conditions';
import { stepLabel } from '../builder/GraphView';
import { JOB_KEY, type FlowGraph, type FlowLink } from '../builder/nodeModel';
import type { ActionState } from './actionStates';

export type LineState = 'fired' | 'flowing' | 'wont' | 'pending';
type Steps = Record<string, StepStatus | undefined>;

const FINISHED = ['succeeded', 'failed', 'skipped'];
const isFinished = (s?: StepStatus): boolean => !!s && FINISHED.includes(s.state);
const isActive = (s?: StepStatus): boolean => !!s && (s.state === 'running' || s.state === 'starting');
const notTaken = (s?: StepStatus): boolean => !!s && s.state === 'skipped' && s.skip_kind === 'not_taken';
// A step waiting for a decision runs nothing: the line into it stays pending, never flowing.
const awaiting = (s?: StepStatus): boolean => !!s && s.state === 'awaiting_approval';

/** States the live graph draws as waiting (dimmed, no spinner), a step awaiting approval among them. */
export function looksWaiting(state: string): boolean {
    return ['waiting', 'ready', 'skipped', 'awaiting_approval'].includes(state);
}
const idOf = (key: string): string => (key.startsWith('step:') ? key.slice(5) : '');

/** Whether a source's finish meets a condition, as the engine's edge() decides it (state.py):
 * a skipped source satisfies `always`, and `on_success` only when it was skipped by its cadence
 * (run_when); a failed source never satisfies `on_success` (its target stays unresolved). */
function met(src: StepStatus | undefined, cond: string): LineState {
    if (!isFinished(src)) {
        return 'pending';
    }
    const state = src!.state;
    if (state === 'skipped' && src!.skip_kind === 'not_started') {
        return 'wont'; // a branch the run's trigger didn't start runs nothing (state.py)
    }
    if (cond === 'always') {
        return 'fired';
    }
    if (state === 'succeeded') {
        return cond === 'on_success' ? 'fired' : 'wont';
    }
    if (state === 'failed') {
        return cond === 'on_failure' ? 'fired' : 'wont';
    }
    return cond === 'on_success' && src!.skip_kind === 'run_when' ? 'fired' : 'wont';
}

function withTarget(base: LineState, target?: StepStatus): LineState {
    if (notTaken(target) && base !== 'pending') {
        return 'wont';
    }
    if (awaiting(target)) {
        return base === 'wont' ? 'wont' : 'pending';
    }
    return base === 'fired' && isActive(target) ? 'flowing' : base;
}

/** The state of every line, by link key. `actions` (from actionStates) tells which action lines have fired.
 * `conditions` (the run's SPL condition results, by `<from>><to>`): a condition being checked is
 * pending, met fires, not met or failed won't fire. `ended`: the run is over, so a condition still
 * unchecked never will be. */
export function lineStates(
    def: JobDefinition,
    steps: Steps,
    graph: FlowGraph,
    actions: Record<string, ActionState> = {},
    conditions: Record<string, ConditionStatus | undefined> = {},
    ended = false
): Record<string, LineState> {
    const out: Record<string, LineState> = {};
    const started = Object.keys(steps).some((k) => steps[k]);
    const condSource: Record<string, string> = {};
    const condTarget: Record<string, string> = {};
    graph.links.forEach((l) => {
        if (l.port === 'if') {
            condSource[l.to] = l.from;
        } else if (l.port === 'then') {
            condTarget[l.from] = l.to;
        }
    });
    graph.links.forEach((l: FlowLink) => {
        const target = steps[idOf(l.to)];
        if (l.kind === 'trigger') {
            out[l.key] = started && !awaiting(target) ? (isActive(target) ? 'flowing' : 'fired') : 'pending';
        } else if (l.kind === 'action') {
            if (actions[l.to]) {
                out[l.key] = 'fired';
                return;
            }
            const cond = l.port === 'failure' ? 'on_failure' : l.port === 'always' ? 'always' : 'on_success';
            const m = l.from === JOB_KEY ? 'pending' : met(steps[idOf(l.from)], cond);
            out[l.key] = m === 'fired' ? 'pending' : m;
        } else if (l.kind === 'condition') {
            // step -> cond -> target: both legs follow the target (an expression is only known by its outcome)
            const cond = l.port === 'if' ? l.to : l.from;
            const leg = { src: steps[idOf(condSource[cond] || '')], tgt: steps[idOf(condTarget[cond] || '')] };
            const finished = leg.src && (leg.src.state === 'succeeded' || leg.src.state === 'failed');
            const edgeKey = cond.slice('cond:'.length);
            const edge = (def.edges || []).find((e) => `${e.from}>${e.to}` === edgeKey);
            const spl = !!edge && conditionKind(edge) !== 'simple';
            const result = conditions[edgeKey];
            if (notTaken(leg.tgt)) {
                out[l.key] = 'wont';
            } else if (spl && finished && (!result || !['met', 'not_met', 'failed'].includes(result.state))) {
                // Being checked (or about to be); never again once the run ended or the target
                // was cancelled or abandoned.
                const over = ended || (!!result && result.state === 'cancelled') || (!!leg.tgt && ['cancelled', 'abandoned'].includes(leg.tgt.state));
                out[l.key] = over ? 'wont' : 'pending';
            } else if (spl && finished && result && result.state !== 'met') {
                out[l.key] = 'wont';
            } else if (!finished) {
                out[l.key] = isFinished(leg.src) ? 'wont' : 'pending';
            } else {
                out[l.key] = awaiting(leg.tgt) ? 'pending' : isActive(leg.tgt) ? 'flowing' : 'fired';
            }
        } else {
            const cond = l.port === 'failure' ? 'on_failure' : l.port === 'always' ? 'always' : 'on_success';
            out[l.key] = withTarget(met(steps[idOf(l.from)], cond), target);
        }
    });
    return out;
}

/** Finished (succeeded, failed or skipped, whatever the skip kind) against all steps. */
export function progress(def: JobDefinition, steps: Steps): { finished: number; total: number } {
    const list = def.steps || [];
    return { finished: list.filter((s) => isFinished(steps[s.id])).length, total: list.length };
}

/** "Waiting for A and B" for a waiting or ready step; null when nothing upstream is unfinished. */
export function waitingFor(def: JobDefinition, steps: Steps, stepId: string): string | null {
    const state = steps[stepId]?.state;
    if (state !== 'waiting' && state !== 'ready') {
        return null;
    }
    const byId = new Map((def.steps || []).map((s) => [s.id, s]));
    const seen = new Set<string>();
    const names: string[] = [];
    (def.edges || []).forEach((e: Edge) => {
        const up = byId.get(e.from);
        if (e.to === stepId && up && !seen.has(e.from) && !isFinished(steps[e.from])) {
            seen.add(e.from);
            names.push(stepLabel(up));
        }
    });
    if (names.length === 0) {
        return null;
    }
    if (names.length === 1) {
        return `Waiting for ${names[0]}`;
    }
    if (names.length === 2) {
        return `Waiting for ${names[0]} and ${names[1]}`;
    }
    return `Waiting for ${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** "1,204 rows →" on data lines whose source succeeded with a result count (the locale is the browser's unless given). */
export function rowLabels(_def: JobDefinition, steps: Steps, graph: FlowGraph, locale?: string): Record<string, string> {
    const fmt = new Intl.NumberFormat(locale);
    const out: Record<string, string> = {};
    graph.links.forEach((l) => {
        const src = steps[idOf(l.from)];
        if (l.data && src && src.state === 'succeeded' && typeof src.result_count === 'number') {
            out[l.key] = `${fmt.format(src.result_count)} ${src.result_count === 1 ? 'row' : 'rows'} →`;
        }
    });
    return out;
}
