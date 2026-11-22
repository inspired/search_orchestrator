/* Pure job graph model: which job starts which, from completion triggers and start_job actions. */
import type { Action, Job, LastRun } from '../../api/types';
import { portForHook } from '../builder/nodeModel';
import { OUTCOME_LABEL } from '../builder/outcomes';

export interface JobGraphNode {
    id: string;
    name: string;
    owner?: string;
    enabled: boolean;
    lastRun?: LastRun | null;
    hidden?: boolean;
}

export interface JobGraphEdge {
    from: string;
    to: string;
    kinds: ('completion' | 'start_job')[];
    label: string;
}

export interface JobGraph {
    nodes: JobGraphNode[];
    edges: JobGraphEdge[];
    unconnected: string[];
}

const HIDDEN_NAME = "Job you can't see";

export function buildJobGraph(jobs: Job[]): JobGraph {
    const known = new Set(jobs.map((j) => j.id));
    const nodes: JobGraphNode[] = jobs.map((j) => ({
        id: j.id,
        name: j.name,
        owner: j.owner,
        enabled: j.enabled,
        lastRun: j.last_run,
    }));
    const hiddenIds = new Map<string, string>();
    const resolve = (id: string): string => {
        if (known.has(id)) {
            return id;
        }
        let alias = hiddenIds.get(id);
        if (!alias) {
            alias = `hidden:${hiddenIds.size + 1}`;
            hiddenIds.set(id, alias);
            nodes.push({ id: alias, name: HIDDEN_NAME, enabled: true, hidden: true });
        }
        return alias;
    };

    const edges = new Map<string, JobGraphEdge>();
    const add = (from: string, to: string, kind: 'completion' | 'start_job', label: string) => {
        const key = `${from}\u0000${to}`;
        let edge = edges.get(key);
        if (!edge) {
            edge = { from, to, kinds: [], label: '' };
            edges.set(key, edge);
        }
        if (!edge.kinds.includes(kind)) {
            edge.kinds.push(kind);
        }
        const labels = edge.label ? edge.label.split('; ') : [];
        if (!labels.includes(label)) {
            labels.push(label);
        }
        edge.label = labels.join('; ');
    };

    // Completion triggers first, so a merged label reads the same whichever job comes first.
    jobs.forEach((job) => {
        (job.triggers || []).forEach((t) => {
            if (t.type === 'completion' && typeof t.job === 'string' && t.job) {
                add(resolve(t.job), job.id, 'completion', t.on === 'complete' ? 'after it finishes' : 'after it succeeds');
            }
        });
    });
    jobs.forEach((job) => {
        const startJob = (a: Action, step?: string) => {
            if (a.type !== 'start_job' || typeof a.job !== 'string' || !a.job) {
                return;
            }
            const outcome = OUTCOME_LABEL[portForHook(a.hook) as keyof typeof OUTCOME_LABEL];
            add(job.id, resolve(a.job), 'start_job', ['start-job action', step, outcome].filter(Boolean).join(' · '));
        };
        (job.actions || []).forEach((a) => startJob(a));
        (job.steps || []).forEach((s) => (s.actions || []).forEach((a) => startJob(a, s.name || s.id)));
    });

    const edgeList = Array.from(edges.values());
    const connected = new Set<string>();
    edgeList.forEach((e) => {
        connected.add(e.from);
        connected.add(e.to);
    });
    const unconnected = jobs
        .filter((j) => !connected.has(j.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((j) => j.id);
    return { nodes, edges: edgeList, unconnected };
}

function reach(graph: JobGraph, id: string, forward: boolean): Set<string> {
    const seen = new Set<string>();
    const queue = [id];
    while (queue.length) {
        const cur = queue.pop() as string;
        graph.edges.forEach((e) => {
            const [near, far] = forward ? [e.from, e.to] : [e.to, e.from];
            if (near === cur && far !== id && !seen.has(far)) {
                seen.add(far);
                queue.push(far);
            }
        });
    }
    return seen;
}

export function related(graph: JobGraph, id: string): { upstream: Set<string>; downstream: Set<string> } {
    return { upstream: reach(graph, id, false), downstream: reach(graph, id, true) };
}
