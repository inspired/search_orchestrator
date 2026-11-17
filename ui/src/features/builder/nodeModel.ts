/* Pure node model: derives the node-editor graph from a job definition. The job definition
 * stays the only source of truth; keys below are also the keys of `layout.nodes`. */
import type { Action, Edge, JobDefinition, StepDef } from '../../api/types';
import { wouldCycle } from './graphLogic';
import { stepLabel, stepTypeLabel } from './GraphView';
import { describeSchedule } from './schedule';

export type NodeKind =
    | 'trigger_cron'
    | 'trigger_completion'
    | 'search'
    | 'saved_search'
    | 'previous'
    | 'summary_index'
    | 'lookup'
    | 'condition'
    | 'email'
    | 'webhook'
    | 'slack'
    | 'event'
    | 'alert_action'
    | 'start_job'
    | 'job';
export type PortId = 'success' | 'failure' | 'always' | 'start' | 'delayed' | 'if' | 'then';
export type ActionScope = 'job' | string; // 'job' or a step id

export const JOB_KEY = 'job';
export const stepKey = (id: string): string => `step:${id}`;
export const triggerKey = (i: number): string => `trigger:${i}`;
export const actionKey = (scope: ActionScope, i: number): string => `action:${scope}:${i}`;
export const condKey = (from: string, to: string): string => `cond:${from}>${to}`;

export interface FlowNode {
    key: string;
    kind: NodeKind;
    label: string;
    detail: string;
    stepId?: string;
    trigger?: number;
    action?: { scope: ActionScope; index: number };
    edge?: { from: string; to: string };
}

export interface FlowLink {
    key: string;
    from: string;
    port: PortId | null;
    to: string;
    kind: 'edge' | 'action' | 'trigger' | 'condition';
    data: boolean;
}

export interface FlowGraph {
    nodes: FlowNode[];
    links: FlowLink[];
}

export const HOOK_FOR_PORT: Record<PortId, Action['hook'] | null> = {
    success: 'on_success',
    failure: 'on_failure',
    always: 'on_complete',
    start: 'on_start',
    delayed: 'on_delayed',
    if: null,
    then: null,
};

export const EDGE_CONDITION_FOR_PORT: Record<PortId, Edge['condition'] | null> = {
    success: 'on_success',
    failure: 'on_failure',
    always: 'always',
    start: null,
    delayed: null,
    if: 'expression',
    then: null,
};

export function portForHook(hook: Action['hook']): PortId {
    switch (hook) {
        case 'on_failure':
            return 'failure';
        case 'on_complete':
            return 'always';
        case 'on_start':
            return 'start';
        case 'on_delayed':
            return 'delayed';
        default:
            return 'success';
    }
}

export function portForEdge(e: Edge): PortId {
    switch (e.condition) {
        case 'on_failure':
            return 'failure';
        case 'always':
            return 'always';
        case 'expression':
            return 'if';
        default:
            return 'success';
    }
}

export function nodeKindOfStep(step: StepDef): NodeKind {
    if (step.output?.kind === 'summary_index') {
        return 'summary_index';
    }
    if (step.output?.kind === 'lookup') {
        return 'lookup';
    }
    if (step.type === 'saved_search') {
        return 'saved_search';
    }
    return step.type === 'previous' ? 'previous' : 'search';
}

export function nodeKindOfAction(a: Action): NodeKind {
    switch (a.type) {
        case 'email':
            return 'email';
        case 'webhook':
            return a.preset === 'slack' ? 'slack' : 'webhook';
        case 'event':
            return 'event';
        case 'start_job':
            return 'start_job';
        default:
            return 'alert_action';
    }
}

const STEP_KINDS: NodeKind[] = ['search', 'saved_search', 'previous', 'summary_index', 'lookup'];

export function outputPorts(kind: NodeKind): PortId[] {
    if (kind === 'job') {
        return ['success', 'failure', 'always', 'start', 'delayed'];
    }
    if (kind === 'condition') {
        return ['then'];
    }
    if (STEP_KINDS.includes(kind)) {
        return ['success', 'failure', 'always', 'start', 'delayed', 'if'];
    }
    return [];
}

const ACTION_LABEL: Record<string, string> = {
    email: 'Email',
    webhook: 'Webhook',
    slack: 'Slack',
    event: 'Event to an index',
    alert_action: 'Alert action',
    start_job: 'Start another job',
};
const ACTION_FIELD: Record<string, string> = {
    email: 'to',
    webhook: 'destination',
    slack: 'destination',
    event: 'index',
    alert_action: 'action',
    start_job: 'job',
};

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function actionNode(a: Action, scope: ActionScope, index: number): FlowNode {
    const kind = nodeKindOfAction(a);
    return {
        key: actionKey(scope, index),
        kind,
        label: ACTION_LABEL[kind],
        detail: text(a[ACTION_FIELD[kind]]),
        action: { scope, index },
    };
}

export function buildGraph(job: JobDefinition): FlowGraph {
    const nodes: FlowNode[] = [];
    const links: FlowLink[] = [];
    const steps = job.steps || [];
    const edges = job.edges || [];
    const ids = new Set(steps.map((s) => s.id));
    const byId = new Map(steps.map((s) => [s.id, s]));

    (job.triggers || []).forEach((t, i) => {
        if (t.type === 'completion') {
            nodes.push({
                key: triggerKey(i),
                kind: 'trigger_completion',
                label: 'After another job',
                detail: t.job ? `When ${t.job} ${t.on === 'complete' ? 'finishes' : 'succeeds'}` : 'Pick a job',
                trigger: i,
            });
        } else {
            nodes.push({
                key: triggerKey(i),
                kind: 'trigger_cron',
                label: 'Schedule',
                detail: describeSchedule(t.cron || ''),
                trigger: i,
            });
        }
    });
    nodes.push({ key: JOB_KEY, kind: 'job', label: 'Whole job', detail: job.name || '' });
    steps.forEach((s) => {
        nodes.push({ key: stepKey(s.id), kind: nodeKindOfStep(s), label: stepLabel(s), detail: stepTypeLabel(s), stepId: s.id });
    });

    const valid = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    valid.forEach((e) => {
        const from = stepKey(e.from);
        const to = stepKey(e.to);
        if (e.condition === 'expression') {
            const ck = condKey(e.from, e.to);
            const expr = (e.expression || '').trim();
            nodes.push({ key: ck, kind: 'condition', label: 'If…', detail: expr || 'Write a condition', edge: { from: e.from, to: e.to } });
            links.push({ key: `${from}-if->${ck}`, from, port: 'if', to: ck, kind: 'condition', data: false });
            links.push({ key: `${ck}-then->${to}`, from: ck, port: 'then', to, kind: 'condition', data: false });
        } else {
            const port = portForEdge(e);
            links.push({ key: `${from}-${port}->${to}`, from, port, to, kind: 'edge', data: byId.get(e.to)?.type === 'previous' });
        }
    });

    const hasIncoming = new Set(valid.map((e) => e.to));
    (job.triggers || []).forEach((_, i) => {
        steps.forEach((s) => {
            if (!hasIncoming.has(s.id)) {
                links.push({ key: `${triggerKey(i)}->${stepKey(s.id)}`, from: triggerKey(i), port: null, to: stepKey(s.id), kind: 'trigger', data: false });
            }
        });
    });

    (job.actions || []).forEach((a, i) => {
        const n = actionNode(a, 'job', i);
        nodes.push(n);
        const port = portForHook(a.hook);
        links.push({ key: `${JOB_KEY}-${port}->${n.key}`, from: JOB_KEY, port, to: n.key, kind: 'action', data: false });
    });
    steps.forEach((s) => {
        (s.actions || []).forEach((a, i) => {
            const n = actionNode(a, s.id, i);
            nodes.push(n);
            const port = portForHook(a.hook);
            links.push({ key: `${stepKey(s.id)}-${port}->${n.key}`, from: stepKey(s.id), port, to: n.key, kind: 'action', data: false });
        });
    });

    return { nodes, links };
}

type Check = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Check => ({ ok: false, reason });

export function canConnect(job: JobDefinition, from: string, port: PortId, to: string): Check {
    if (to === JOB_KEY || to.startsWith('trigger:')) {
        return no('Nothing can start the whole job or a schedule from a line; drag from its outputs instead');
    }
    const steps = job.steps || [];
    const edges = job.edges || [];
    let fromStep: string | null = null;

    if (from === JOB_KEY) {
        if (!outputPorts('job').includes(port)) {
            return no('The whole job has no If line; use it from a step');
        }
    } else if (from.startsWith('step:')) {
        fromStep = from.slice(5);
        const step = steps.find((s) => s.id === fromStep);
        if (!step) {
            return no('That step no longer exists');
        }
        if (!outputPorts(nodeKindOfStep(step)).includes(port)) {
            return no('That output does not exist on this step');
        }
    } else if (from.startsWith('cond:')) {
        if (port !== 'then') {
            return no('A condition only has a Then line');
        }
        const m = /^cond:(.*)>(.*)$/.exec(from);
        fromStep = m ? m[1] : null;
        if (!fromStep || !to.startsWith('step:')) {
            return no('A condition can only lead to a step');
        }
    } else {
        return no('Triggers and actions have no outputs to connect from');
    }

    if (to.startsWith('action:')) {
        if (!HOOK_FOR_PORT[port]) {
            return no('Only Succeeds, Fails, Finishes either way, Starts and Is delayed lines can go to an action');
        }
        return { ok: true };
    }
    if (!to.startsWith('step:')) {
        return no('That line cannot end there');
    }
    const toId = to.slice(5);
    if (!steps.some((s) => s.id === toId)) {
        return no('That step no longer exists');
    }
    if (from === JOB_KEY) {
        return no('The whole job can only lead to an action; connect it from a step instead');
    }
    if (port === 'start' || port === 'delayed') {
        return no('Starts and Is delayed lines can only go to an action');
    }
    if (fromStep === toId || wouldCycle(edges, fromStep as string, toId)) {
        return no('That line would make a loop; steps cannot depend on themselves, even through other steps');
    }
    return { ok: true };
}
