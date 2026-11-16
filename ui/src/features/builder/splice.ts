/* Putting a node on an existing line: A -> B becomes A -> N (the old outcome) and N -> B (on success). */
import type { Edge, JobDefinition } from '../../api/types';
import { stepLabel } from './GraphView';
import { wouldCycle } from './graphLogic';
import { buildGraph } from './nodeModel';
import type { FlowLink } from './nodeModel';

type Check = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Check => ({ ok: false, reason });

function findLink(job: JobDefinition, link: string): FlowLink | undefined {
    return buildGraph(job).links.find((l) => l.key === link);
}

/** The edge a step-to-step link stands for. */
function edgeOf(job: JobDefinition, link: FlowLink): Edge | undefined {
    if (link.kind !== 'edge') {
        return undefined;
    }
    return (job.edges || []).find((e) => `step:${e.from}` === link.from && `step:${e.to}` === link.to);
}

export function canSplice(job: JobDefinition, node: string, link: string): Check {
    const step = node.startsWith('step:') ? (job.steps || []).find((s) => s.id === node.slice(5)) : undefined;
    if (!step) {
        return no('Only searches can be put on a line');
    }
    const graph = buildGraph(job);
    if (graph.links.some((l) => l.kind !== 'trigger' && (l.from === node || l.to === node))) {
        return no('Disconnect this node first, then drop it on the line');
    }
    const l = graph.links.find((x) => x.key === link);
    if (!l || l.kind === 'condition' || l.kind === 'trigger') {
        return no("Lines with a condition can't be split; remove the condition first");
    }
    const edge = edgeOf(job, l);
    if (!edge) {
        return no('Only a line between two steps can be split');
    }
    if (edge.condition === 'expression') {
        return no("Lines with a condition can't be split; remove the condition first");
    }
    const rest = (job.edges || []).filter((e) => e !== edge);
    const id = step.id;
    if (id === edge.from || id === edge.to || wouldCycle(rest, edge.from, id) || wouldCycle([...rest, { ...edge, to: id }], id, edge.to)) {
        return no('This would make a loop');
    }
    return { ok: true };
}

/** The job's edges with the node on the line; null when canSplice says no. */
export function splicedEdges(job: JobDefinition, node: string, link: string): Edge[] | null {
    if (!canSplice(job, node, link).ok) {
        return null;
    }
    const l = findLink(job, link) as FlowLink;
    const edge = edgeOf(job, l) as Edge;
    const id = node.slice(5);
    return (job.edges || []).flatMap((e) =>
        e === edge ? [{ ...e, to: id }, { from: id, to: edge.to, condition: 'on_success' as const }] : [e]
    );
}

export function spliceMessage(job: JobDefinition, node: string, link: string): string {
    const steps = job.steps || [];
    const l = findLink(job, link);
    const n = steps.find((s) => `step:${s.id}` === node);
    const b = l && steps.find((s) => `step:${s.id}` === l.to);
    const name = (s?: { id: string; name?: string }) => (s ? stepLabel(s as never) : '');
    return `${name(b)} now runs after ${name(n)} succeeds. Undo brings back the old line.`;
}
