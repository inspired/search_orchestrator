/* Pure edits of the job for the node editor: saved positions (job.layout.nodes) and the
 * edge changes behind changing an outcome, splicing a node into a line and placing a node. */
import type { Edge, JobDefinition } from '../../api/types';
import { layoutFlow, freeSpotRightOf } from './flowLayout';
import type { Pos } from './graphLogic';
import { EDGE_CONDITION_FOR_PORT, actionKey, buildGraph, canConnect, condKey, stepKey, triggerKey } from './nodeModel';
import type { NodeKind } from './nodeModel';
import type { Outcome } from './outcomes';
import { splicedEdges } from './splice';

// Saved positions (job.layout.nodes). Keys follow nodeModel; every edit keeps them consistent.

/** The job with `nodes` as its layout; an empty map removes `layout` (the server rejects null). */
export function withNodes(job: JobDefinition, nodes: Record<string, Pos>): JobDefinition {
    const out = { ...job };
    if (Object.keys(nodes).length === 0) {
        delete out.layout;
    } else {
        out.layout = { ...out.layout, nodes };
    }
    return out;
}

/** Renames (string) or drops (null) saved keys. A job without a layout is returned as it is. */
export function remapLayout(job: JobDefinition, fn: (key: string) => string | null): JobDefinition {
    const nodes = job.layout?.nodes;
    if (!nodes) {
        return job;
    }
    const out: Record<string, Pos> = {};
    Object.entries(nodes).forEach(([key, pos]) => {
        const next = fn(key);
        if (next !== null) {
            out[next] = pos;
        }
    });
    return withNodes(job, out);
}

export const parseAction = (key: string): { scope: string; index: number } | null => {
    const m = /^action:(.*):(\d+)$/.exec(key);
    return m ? { scope: m[1], index: Number(m[2]) } : null;
};

export const parseCond = (key: string): { from: string; to: string } | null => {
    const m = /^cond:(.*)>(.*)$/.exec(key);
    return m ? { from: m[1], to: m[2] } : null;
};

/** Drops the saved key of the action at `index` in `scope` and shifts later ones down. */
export function dropActionKey(job: JobDefinition, scope: string, index: number): JobDefinition {
    return remapLayout(job, (key) => {
        const a = parseAction(key);
        if (!a || a.scope !== scope || a.index < index) {
            return key;
        }
        return a.index === index ? null : actionKey(scope, a.index - 1);
    });
}

export function dropTriggerKey(job: JobDefinition, index: number): JobDefinition {
    return remapLayout(job, (key) => {
        const m = /^trigger:(\d+)$/.exec(key);
        if (!m || Number(m[1]) < index) {
            return key;
        }
        return Number(m[1]) === index ? null : triggerKey(Number(m[1]) - 1);
    });
}

export const dropCondKey = (job: JobDefinition, from: string, to: string) =>
    remapLayout(job, (key) => (key === condKey(from, to) ? null : key));

export function renameStepKeys(job: JobDefinition, from: string, to: string): JobDefinition {
    const swap = (id: string) => (id === from ? to : id);
    return remapLayout(job, (key) => {
        if (key === stepKey(from)) {
            return stepKey(to);
        }
        const a = parseAction(key);
        if (a) {
            return a.scope === from ? actionKey(to, a.index) : key;
        }
        const c = parseCond(key);
        return c ? condKey(swap(c.from), swap(c.to)) : key;
    });
}

export function dropStepKeys(job: JobDefinition, id: string): JobDefinition {
    return remapLayout(job, (key) => {
        if (key === stepKey(id)) {
            return null;
        }
        const a = parseAction(key);
        if (a) {
            return a.scope === id ? null : key;
        }
        const c = parseCond(key);
        return c && (c.from === id || c.to === id) ? null : key;
    });
}

/** The job with `outcome` on the step-to-step or condition line `link`; null when nothing changes. */
export function changeLineOutcome(job: JobDefinition, linkKey: string, outcome: Outcome): JobDefinition | null {
    const edgeList = job.edges || [];
    const link = buildGraph(job).links.find((l) => l.key === linkKey);
    const condition = EDGE_CONDITION_FOR_PORT[outcome];
    if (!link || link.port === outcome || !condition) {
        return null;
    }
    if (link.kind === 'edge') {
        const edge = edgeList.find((e) => stepKey(e.from) === link.from && stepKey(e.to) === link.to);
        if (!edge) {
            return null;
        }
        const changed: Edge = { ...edge, condition };
        if (condition === 'expression') {
            changed.expression = '';
        } else {
            delete changed.expression;
        }
        return { ...job, edges: edgeList.map((e) => (e === edge ? changed : e)) };
    }
    if (link.kind === 'condition' && condition !== 'expression') {
        const c = parseCond(link.from.startsWith('cond:') ? link.from : link.to);
        const edge = c && edgeList.find((e) => e.from === c.from && e.to === c.to);
        if (!c || !edge) {
            return null;
        }
        const plain: Edge = { from: edge.from, to: edge.to, condition };
        return dropCondKey({ ...job, edges: edgeList.map((e) => (e === edge ? plain : e)) }, c.from, c.to);
    }
    return null;
}

/** Positions saved with a new node: `shown` (what is on screen) stays put, `at` is the new node's. */
export function withPlacedNode(job: JobDefinition, key: string, at: Pos, shown?: Record<string, Pos>): JobDefinition {
    return withNodes(job, { ...shown, ...job.layout?.nodes, [key]: at });
}

/** Where addNode puts `key` of `kind` when asked to go right of `rightOf` (null without `rightOf`). */
export function spotRightOf(before: JobDefinition, next: JobDefinition, rightOf: string, kind: NodeKind, shown?: Record<string, Pos>) {
    const pos = shown || layoutFlow(buildGraph(before), before.layout?.nodes);
    return { at: freeSpotRightOf(buildGraph(next), pos, rightOf, kind), shown: pos };
}

/** The job with step `node` on `link`; null when it cannot be. */
export function spliceJob(job: JobDefinition, node: string, link: string, at?: Pos, shown?: Record<string, Pos>): JobDefinition | null {
    const edges = splicedEdges(job, node, link);
    if (!edges) {
        return null;
    }
    const next = { ...job, edges };
    if (!at) {
        return next;
    }
    return withPlacedNode(next, node, at, shown || (job.layout ? undefined : layoutFlow(buildGraph(job))));
}

/** `added` (the job with new step `node`) with that step on `link` of `job`: only where both
 * halves are lines `canConnect` allows. Null when it cannot be. */
export function insertJob(job: JobDefinition, added: JobDefinition, node: string, link: string, at?: Pos, shown?: Record<string, Pos>): JobDefinition | null {
    const l = buildGraph(job).links.find((x) => x.key === link);
    if (!l || !l.port || !canConnect(added, l.from, l.port, node).ok || !canConnect(added, node, 'success', l.to).ok) {
        return null;
    }
    return spliceJob(added, node, link, at, shown);
}
