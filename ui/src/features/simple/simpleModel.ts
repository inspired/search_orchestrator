/* The Simple view's reading of a job, and its edits. Simple shows a job as a chain of
 * searches that run top to bottom (each starts when the one above succeeds), each with a
 * list of "then" items: a Summary index or Lookup step hanging off it, or an action that
 * fires when it succeeds (optionally only when it found results). Around the chain: one
 * trigger, one "if a step fails" action and one "when done, start job" action. Everything
 * Simple writes is ordinary steps, edges and actions, so Flow shows the same job. A job
 * using anything else (conditions, approval, branches, more triggers ...) is read but not
 * edited here: `readSimple` says why. */
import type { Action, Edge, JobDefinition, StepDef, StepOutput } from '../../api/types';
import { removeStepJob } from '../builder/flowEdits';
import { outputSpl } from '../builder/outputs';
import { nextStepId } from '../builder/stepRename';

export type ThenKind = 'summary_index' | 'lookup' | 'email' | 'slack' | 'teams' | 'pagerduty' | 'servicenow' | 'event';

export type Then =
    | { kind: 'summary_index' | 'lookup'; stepId: string; output: StepOutput; onlyIfResults: boolean }
    | { kind: Exclude<ThenKind, 'summary_index' | 'lookup'>; index: number; action: Action; onlyIfResults: boolean };

export interface SimpleStep {
    step: StepDef;
    thens: Then[];
}

export interface SimpleJob {
    chain: SimpleStep[];
    /** Why Simple can't edit this job; empty when it can. */
    reasons: string[];
    /** Index in `job.actions` of the "if a step fails" action, or -1. */
    failure: number;
    /** Index in `job.actions` of the "when done, start job" action, or -1. */
    whenDone: number;
}

export const THEN_LABEL: Record<ThenKind, string> = {
    summary_index: 'Save to summary index',
    lookup: 'Save to lookup',
    email: 'Email',
    slack: 'Post to Slack',
    teams: 'Post to Teams',
    pagerduty: 'Page PagerDuty',
    servicenow: 'Open a ServiceNow incident',
    event: 'Write an event',
};

const isOutput = (s: StepDef) => Boolean(s.output);
const hitsExpr = (id: string) => `$${id}.resultCount$ > 0`;

function actionKind(a: Action): Exclude<ThenKind, 'summary_index' | 'lookup'> | null {
    if (a.type === 'email') {
        return 'email';
    }
    if (a.type === 'event') {
        return 'event';
    }
    if (a.type === 'webhook') {
        const p = a.preset as string | undefined;
        return p === 'teams' || p === 'pagerduty' || p === 'servicenow' ? p : 'slack';
    }
    return null;
}

/** The job read as a chain of searches, and what keeps Simple from editing it. */
export function readSimple(job: JobDefinition): SimpleJob {
    const steps = job.steps || [];
    const edges = job.edges || [];
    const reasons: string[] = [];
    const byId = new Map(steps.map((s) => [s.id, s]));
    const name = (id: string) => byId.get(id)?.name || id;

    if (edges.some((e) => (e.condition || 'on_success') !== 'on_success')) {
        reasons.push('a line that runs on failure, either way or on a condition');
    }
    if (steps.some((s) => s.type === 'approval')) {
        reasons.push('an approval step');
    }
    const searches = steps.filter((s) => !isOutput(s) && s.type !== 'approval');
    const into = (id: string) => edges.filter((e) => e.to === id).map((e) => e.from);
    const outOf = (id: string) => edges.filter((e) => e.from === id).map((e) => e.to);
    const searchIds = new Set(searches.map((s) => s.id));
    searches.forEach((s) => {
        if (into(s.id).filter((x) => searchIds.has(x)).length > 1) {
            reasons.push(`${name(s.id)} waits for more than one step`);
        }
        if (outOf(s.id).filter((x) => searchIds.has(x)).length > 1) {
            reasons.push(`more than one step runs after ${name(s.id)}`);
        }
        if (s.run_when) {
            reasons.push(`${name(s.id)} has a Run when rule`);
        }
        (s.actions || []).forEach((a) => {
            if (a.hook !== 'on_success' || !actionKind(a)) {
                reasons.push(`${name(s.id)} has a ${a.hook.replace('on_', '')} action Simple doesn't show`);
            }
        });
    });
    steps.filter(isOutput).forEach((s) => {
        const from = into(s.id);
        if (from.length !== 1 || !searchIds.has(from[0])) {
            reasons.push(`${name(s.id)} reads from more than one step`);
        }
        if (outOf(s.id).length) {
            reasons.push(`steps run after ${name(s.id)}`);
        }
        if ((s.actions || []).length) {
            reasons.push(`${name(s.id)} has actions`);
        }
        if (s.run_when && !(from.length === 1 && s.run_when.kind === 'expression' && s.run_when.value === hitsExpr(from[0]))) {
            reasons.push(`${name(s.id)} has a Run when rule`);
        }
    });
    if ((job.triggers || []).length > 1) {
        reasons.push('more than one trigger');
    }

    let failure = -1;
    let whenDone = -1;
    (job.actions || []).forEach((a, i) => {
        if (a.hook === 'on_failure' && failure < 0 && actionKind(a)) {
            failure = i;
        } else if (a.hook === 'on_success' && a.type === 'start_job' && whenDone < 0) {
            whenDone = i;
        } else {
            reasons.push(`the whole job has a ${a.hook.replace('on_', '')} action Simple doesn't show`);
        }
    });

    // The chain, from the first search down; anything not on it is listed after.
    const firsts = searches.filter((s) => !into(s.id).some((x) => searchIds.has(x)));
    if (firsts.length > 1) {
        reasons.push('searches that run side by side');
    }
    const order: StepDef[] = [];
    const seen = new Set<string>();
    firsts.forEach((f) => {
        let cur: StepDef | undefined = f;
        while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            order.push(cur);
            const after: string[] = outOf(cur.id).filter((x) => searchIds.has(x));
            cur = after.length === 1 ? byId.get(after[0]) : undefined;
        }
    });
    searches.filter((s) => !seen.has(s.id)).forEach((s) => order.push(s));

    const chain = order.map((step) => {
        const thens: Then[] = [];
        outOf(step.id)
            .map((id) => byId.get(id))
            .filter((s): s is StepDef => Boolean(s && s.output))
            .forEach((s) =>
                thens.push({ kind: s.output!.kind, stepId: s.id, output: s.output!, onlyIfResults: Boolean(s.run_when && s.run_when.value === hitsExpr(step.id)) })
            );
        (step.actions || []).forEach((a, index) => {
            const kind = actionKind(a);
            if (kind && a.hook === 'on_success') {
                thens.push({ kind, index, action: a, onlyIfResults: a.only_if_results === true });
            }
        });
        return { step, thens };
    });
    return { chain, reasons: Array.from(new Set(reasons)), failure, whenDone };
}

/** The edges and trigger lists for searches in `order`: each on_success after the one above,
 * outputs kept on their search, and a trigger with a step list starting the first search. */
export function withChain(job: JobDefinition, order: string[]): JobDefinition {
    const searchIds = new Set(order);
    const kept = (job.edges || []).filter((e) => !(searchIds.has(e.from) && searchIds.has(e.to)));
    const chain: Edge[] = order.slice(1).map((id, i) => ({ from: order[i], to: id, condition: 'on_success' }));
    const triggers = (job.triggers || []).map((t) => (Array.isArray(t.steps) ? { ...t, steps: order.length ? [order[0]] : [] } : t));
    return { ...job, edges: [...kept, ...chain], triggers };
}

function chainIds(job: JobDefinition): string[] {
    return readSimple(job).chain.map((c) => c.step.id);
}

/** A new search at the end of the chain. */
export function addSearch(job: JobDefinition): { job: JobDefinition; id: string } {
    const steps = job.steps || [];
    const id = nextStepId(steps);
    const step: StepDef = { id, name: '', type: 'inline', spl: '', earliest: '-24h', latest: 'now' };
    const next = { ...job, steps: [...steps, step] };
    const order = [...chainIds(job), id];
    const withTrigger = order.length === 1 ? { ...next, triggers: (next.triggers || []).map((t) => (Array.isArray(t.steps) ? { ...t, steps: [id] } : t)) } : next;
    return { job: withChain(withTrigger, order), id };
}

/** The job without search `id` and its outputs; the searches around it join up. */
export function removeSearch(job: JobDefinition, id: string): JobDefinition {
    const order = chainIds(job).filter((x) => x !== id);
    const outputs = (job.steps || []).filter((s) => s.output && (job.edges || []).some((e) => e.from === id && e.to === s.id)).map((s) => s.id);
    let next = job;
    [...outputs, id].forEach((sid) => {
        next = removeStepJob(next, sid);
    });
    return withChain(next, order);
}

/** Search `id` moved one place up (-1) or down (+1). */
export function moveSearch(job: JobDefinition, id: string, dir: -1 | 1): JobDefinition {
    const order = chainIds(job);
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) {
        return job;
    }
    [order[i], order[j]] = [order[j], order[i]];
    return withChain(job, order);
}

/** A new "then" of `kind` on search `id`. */
export function addThen(job: JobDefinition, id: string, kind: ThenKind): JobDefinition {
    const steps = job.steps || [];
    if (kind === 'summary_index' || kind === 'lookup') {
        const out: StepOutput = kind === 'summary_index' ? { kind, index: 'summary', add_run_id: true } : { kind, name: '' };
        const sid = nextStepId(steps, kind === 'summary_index' ? 'save_summary' : 'save_lookup');
        const step: StepDef = { id: sid, name: THEN_LABEL[kind], type: 'previous', spl: outputSpl(out), output: out };
        return { ...job, steps: [...steps, step], edges: [...(job.edges || []), { from: id, to: sid, condition: 'on_success' }] };
    }
    const defaults: Record<string, Omit<Action, 'hook'>> = {
        email: { type: 'email', to: '' },
        slack: { type: 'webhook', preset: 'slack', destination: '' },
        teams: { type: 'webhook', preset: 'teams', destination: '' },
        pagerduty: { type: 'webhook', preset: 'pagerduty', destination: '' },
        servicenow: { type: 'webhook', preset: 'servicenow', destination: '' },
        event: { type: 'event', index: 'main' },
    };
    const action = { hook: 'on_success', ...defaults[kind] } as Action;
    return { ...job, steps: steps.map((s) => (s.id === id ? { ...s, actions: [...(s.actions || []), action] } : s)) };
}

/** The job without `then` of search `id`. */
export function removeThen(job: JobDefinition, id: string, then: Then): JobDefinition {
    if ('stepId' in then) {
        return removeStepJob(job, then.stepId);
    }
    return { ...job, steps: (job.steps || []).map((s) => (s.id === id ? { ...s, actions: (s.actions || []).filter((_, i) => i !== then.index) } : s)) };
}

/** `then` of search `id` changed: its output or action fields, or only-if-results. */
export function updateThen(job: JobDefinition, id: string, then: Then, change: { output?: StepOutput; action?: Partial<Action>; onlyIfResults?: boolean }): JobDefinition {
    if ('stepId' in then) {
        return {
            ...job,
            steps: (job.steps || []).map((s) => {
                if (s.id !== then.stepId) {
                    return s;
                }
                const out = change.output || s.output!;
                const only = change.onlyIfResults ?? then.onlyIfResults;
                const next: StepDef = { ...s, output: out, spl: outputSpl(out) };
                if (only) {
                    next.run_when = { kind: 'expression', value: hitsExpr(id) };
                } else {
                    delete next.run_when;
                }
                return next;
            }),
        };
    }
    return {
        ...job,
        steps: (job.steps || []).map((s) => {
            if (s.id !== id) {
                return s;
            }
            const actions = (s.actions || []).map((a, i) => {
                if (i !== then.index) {
                    return a;
                }
                const next = { ...a, ...(change.action || {}) } as Action;
                if (change.onlyIfResults !== undefined) {
                    if (change.onlyIfResults) {
                        next.only_if_results = true;
                    } else {
                        delete next.only_if_results;
                    }
                }
                return next;
            });
            return { ...s, actions };
        }),
    };
}

/** Sets (or with null removes) the job-level action at `index` (-1: none yet) with `hook`. */
export function setJobAction(job: JobDefinition, index: number, action: Action | null): JobDefinition {
    const list = job.actions || [];
    if (index < 0) {
        return action ? { ...job, actions: [...list, action] } : job;
    }
    return { ...job, actions: action ? list.map((a, i) => (i === index ? action : a)) : list.filter((_, i) => i !== index) };
}
