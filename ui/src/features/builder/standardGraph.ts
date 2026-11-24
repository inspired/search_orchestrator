/* The Standard view's graph: the steps and the lines between them, nothing else. Triggers
 * are on the Triggers tab and actions in the step's panel, so the canvas stays simple; a
 * step's markers say what it has there (⚡ a trigger starts it, ✉ N actions, ⌛ a delay
 * alert). A condition is one line labelled with it (standardLineLabels) instead of an If…
 * node. Derived from the job like buildGraph, so it never changes the job. */
import type { JobDefinition } from '../../api/types';
import { conditionShort } from './conditions';
import { buildGraph, FlowGraph, FlowLink, portForEdge, stepKey, STEP_KINDS } from './nodeModel';
import { startedBy } from './triggerSteps';

/** A Standard line's key: from step, port, to step. */
export const lineKey = (from: string, port: string, to: string) => `${stepKey(from)}-${port}->${stepKey(to)}`;

export function standardGraph(job: JobDefinition): FlowGraph {
    const steps = job.steps || [];
    const ids = new Set(steps.map((s) => s.id));
    const started = new Set((job.triggers || []).flatMap((t) => startedBy(job, t)));
    const byId = new Map(steps.map((s) => [s.id, s]));
    const nodes = buildGraph(job)
        .nodes.filter((n) => STEP_KINDS.includes(n.kind))
        .map((n) => {
            const step = n.stepId ? byId.get(n.stepId) : undefined;
            const marks: string[] = [];
            if (n.stepId && started.has(n.stepId)) {
                marks.push('⚡');
            }
            const count = (step?.actions || []).length;
            if (count) {
                marks.push(`✉ ${count}`);
            }
            if (step?.delayed_after) {
                marks.push('⌛');
            }
            return marks.length ? { ...n, detail: [n.detail, ...marks].filter(Boolean).join(' · ') } : n;
        });
    const links: FlowLink[] = (job.edges || [])
        .filter((e) => ids.has(e.from) && ids.has(e.to))
        .map((e) => {
            const port = e.condition === 'expression' ? 'if' : portForEdge(e);
            return { key: lineKey(e.from, port, e.to), from: stepKey(e.from), port, to: stepKey(e.to), kind: 'edge', data: byId.get(e.to)?.type === 'previous' };
        });
    return { nodes, links };
}

/** "◇ <condition>" for each condition line, by link key. */
export function standardLineLabels(job: JobDefinition): Record<string, string> {
    const out: Record<string, string> = {};
    (job.edges || [])
        .filter((e) => e.condition === 'expression')
        .forEach((e) => {
            out[lineKey(e.from, 'if', e.to)] = `◇ ${conditionShort(e) || 'Write a condition'}`;
        });
    return out;
}
