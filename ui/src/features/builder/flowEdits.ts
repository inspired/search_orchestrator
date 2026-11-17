/* Pure edits of the job for the node editor: saved positions (job.layout.nodes), removing
 * nodes, tidying them up, and the edge changes behind changing an outcome, splicing a node into
 * a line and placing a node. */
import type { Action, Edge, JobDefinition } from '../../api/types';
import { layoutFlow, freeSpotRightOf } from './flowLayout';
import type { Pos } from './graphLogic';
import { validGroups } from './groups';
import { EDGE_CONDITION_FOR_PORT, actionKey, buildGraph, canConnect, condKey, outputPorts, stepKey, triggerKey } from './nodeModel';
import type { ActionScope, FlowGraph, NodeKind } from './nodeModel';
import type { Outcome } from './outcomes';
import { canSplice, splicedEdges } from './splice';

// Saved positions (job.layout.nodes). Keys follow nodeModel; every edit keeps them consistent.

/** The job with `nodes` as its layout; an empty map removes `nodes`, and `layout` with it unless
 * the layout holds groups (the server rejects null). Broken groups from a hand-edited layout are
 * dropped here, so a save is never refused for something the canvas does not draw. */
export function withNodes(job: JobDefinition, nodes: Record<string, Pos>): JobDefinition {
    const out = { ...job };
    const rest = { ...out.layout };
    delete rest.nodes;
    if (rest.groups !== undefined) {
        const groups = validGroups(rest.groups);
        if (groups.length) {
            rest.groups = groups;
        } else {
            delete rest.groups;
        }
    }
    if (Object.keys(nodes).length) {
        out.layout = { ...rest, nodes };
    } else if (rest.groups !== undefined) {
        out.layout = rest;
    } else {
        delete out.layout;
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
export function spotRightOf(before: JobDefinition, next: JobDefinition, rightOf: string, kind: NodeKind, shown?: Record<string, Pos>, compact = false) {
    const pos = shown || layoutFlow(buildGraph(before), before.layout?.nodes, compact);
    return { at: freeSpotRightOf(buildGraph(next), pos, rightOf, kind, compact), shown: pos };
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

/** A new step of `kind` can go on step-to-step `link` ("Insert a node"): both halves are lines
 * `canConnect` allows. */
export function canInsert(job: JobDefinition, link: string, kind: NodeKind): boolean {
    // Only step kinds have an If output.
    if (!outputPorts(kind).includes('if')) {
        return false;
    }
    const l = buildGraph(job).links.find((x) => x.key === link);
    if (!l || l.kind !== 'edge' || !l.port) {
        return false;
    }
    const node = stepKey('__insert');
    const probe: JobDefinition = { ...job, steps: [...(job.steps || []), { id: '__insert', type: 'inline', spl: '' }] };
    return canSplice(probe, node, link).ok && canConnect(probe, l.from, l.port, node).ok && canConnect(probe, node, 'success', l.to).ok;
}

/** `added` (`job` with the new step `node` of `kind`) with that step on `link`; null when it cannot be. */
export function insertJob(job: JobDefinition, added: JobDefinition, kind: NodeKind, node: string, link: string, at?: Pos, shown?: Record<string, Pos>): JobDefinition | null {
    return canInsert(job, link, kind) ? spliceJob(added, node, link, at, shown) : null;
}

export const actionsOf = (job: JobDefinition, scope: ActionScope): Action[] =>
    (scope === 'job' ? job.actions : (job.steps || []).find((s) => s.id === scope)?.actions) || [];

export function setActions(job: JobDefinition, scope: ActionScope, actions: Action[]): JobDefinition {
    if (scope === 'job') {
        return { ...job, actions };
    }
    return { ...job, steps: (job.steps || []).map((s) => (s.id === scope ? { ...s, actions } : s)) };
}

/** The job without step `id`, its lines and their saved positions. */
export function removeStepJob(job: JobDefinition, id: string): JobDefinition {
    const steps = (job.steps || []).filter((s) => s.id !== id);
    const edges = (job.edges || []).filter((e) => e.from !== id && e.to !== id);
    return dropStepKeys({ ...job, steps, edges }, id);
}

/** The job without the line from `from` to `to` (and its condition's position). */
export function disconnectJob(job: JobDefinition, from: string, to: string): JobDefinition {
    const edgeList = job.edges || [];
    const gone = edgeList.find((e) => e.from === from && e.to === to);
    const next = { ...job, edges: edgeList.filter((e) => e !== gone) };
    return gone?.condition === 'expression' ? dropCondKey(next, from, to) : next;
}

/** The job without action `index` of `scope`; null when there is none. */
export function removeActionJob(job: JobDefinition, scope: ActionScope, index: number): JobDefinition | null {
    const list = actionsOf(job, scope);
    if (!list[index]) {
        return null;
    }
    return dropActionKey(setActions(job, scope, list.filter((_, i) => i !== index)), scope, index);
}

export function removeTriggerJob(job: JobDefinition, index: number): JobDefinition | null {
    const list = job.triggers || [];
    if (!list[index]) {
        return null;
    }
    return dropTriggerKey({ ...job, triggers: list.filter((_, i) => i !== index) }, index);
}

/** The job without the nodes `keys`; null when none of them can be removed (`job` never can).
 * Actions go first, highest index first in each list, then conditions, then triggers (highest
 * first), then steps, so every key still names the node it named. */
export function removeNodesJob(job: JobDefinition, keys: string[]): JobDefinition | null {
    const actions = keys.map(parseAction).filter((a): a is { scope: string; index: number } => a !== null);
    const conds = keys.map(parseCond).filter((c): c is { from: string; to: string } => c !== null);
    const triggers = keys.map((k) => /^trigger:(\d+)$/.exec(k)).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1]));
    const steps = keys.filter((k) => k.startsWith('step:')).map((k) => k.slice('step:'.length));
    let next = job;
    let changed = false;
    const apply = (out: JobDefinition | null) => {
        if (out) {
            next = out;
            changed = true;
        }
    };
    actions.sort((a, b) => b.index - a.index).forEach((a) => apply(removeActionJob(next, a.scope, a.index)));
    conds.forEach((c) => apply((next.edges || []).some((e) => e.from === c.from && e.to === c.to) ? disconnectJob(next, c.from, c.to) : null));
    triggers.sort((a, b) => b - a).forEach((i) => apply(removeTriggerJob(next, i)));
    steps.forEach((id) => apply((next.steps || []).some((s) => s.id === id) ? removeStepJob(next, id) : null));
    return changed ? next : null;
}

/** Tidy up: without `keys`, forget every saved position (null when there are none). With
 * `keys`, place only those nodes again, as automatic placement would lay them out among
 * themselves, with the top-left corner of the group where it was; every other node is saved
 * where it is shown. */
export function tidyJob(job: JobDefinition, keys?: string[], compact = false): JobDefinition | null {
    if (!keys) {
        return job.layout && job.layout.nodes ? withNodes(job, {}) : null;
    }
    const graph = buildGraph(job);
    const mine = new Set(keys.filter((k) => graph.nodes.some((n) => n.key === k)));
    if (!mine.size) {
        return null;
    }
    const shown = layoutFlow(graph, job.layout?.nodes, compact);
    // Lines among the chosen nodes, and a step-to-step line through a condition left out.
    const links = graph.links.filter((l) => mine.has(l.from) && mine.has(l.to));
    (job.edges || []).forEach((e) => {
        const [from, to] = [stepKey(e.from), stepKey(e.to)];
        if (mine.has(from) && mine.has(to) && !links.some((l) => l.from === from && l.to === to)) {
            links.push({ key: `${from}>${to}`, from, to, port: null, kind: 'edge', data: false });
        }
    });
    const sub: FlowGraph = { nodes: graph.nodes.filter((n) => mine.has(n.key)), links };
    const auto = layoutFlow(sub, undefined, compact);
    const ks = Array.from(mine);
    const corner = (pos: Record<string, Pos>) => ({ x: Math.min(...ks.map((k) => pos[k].x)), y: Math.min(...ks.map((k) => pos[k].y)) });
    const from = corner(auto);
    const to = corner(shown);
    const placed: Record<string, Pos> = {};
    ks.forEach((k) => {
        placed[k] = { x: auto[k].x - from.x + to.x, y: auto[k].y - from.y + to.y };
    });
    return withNodes(job, { ...shown, ...placed });
}
