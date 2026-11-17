/* What is selected on the flow canvas: one node, one line, several nodes or a group (which is
 * never one of the nodes). A selection of
 * several nodes always holds two or more keys; one key is a node selection. Pure helpers. */
import type { Pos, Positions } from './graphLogic';
import { JOB_KEY } from './nodeModel';
import type { FlowGraph } from './nodeModel';
import { nodeSize } from './nodeStyle';

export type FlowSelection =
    | { kind: 'node'; key: string }
    | { kind: 'link'; key: string }
    | { kind: 'nodes'; keys: string[] }
    | { kind: 'group'; id: string }
    | null;

/** The node keys a selection holds (none for a line or a group). */
export function selectedKeys(sel: FlowSelection): string[] {
    if (!sel || sel.kind === 'link' || sel.kind === 'group') {
        return [];
    }
    return sel.kind === 'node' ? [sel.key] : sel.keys;
}

/** None, one node, or several nodes, from a list of keys (duplicates dropped). */
export function normaliseSelection(keys: string[]): FlowSelection {
    const unique = Array.from(new Set(keys));
    if (unique.length === 0) {
        return null;
    }
    return unique.length === 1 ? { kind: 'node', key: unique[0] } : { kind: 'nodes', keys: unique };
}

/** `key` added to the selected nodes, or taken out when it is already there. */
export function toggleInSelection(sel: FlowSelection, key: string): FlowSelection {
    const keys = selectedKeys(sel);
    return normaliseSelection(keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]);
}

/** Keys of the nodes whose boxes touch the box with corners `a` and `b`, in graph order (never the Whole job node). */
export function keysInBox(graph: FlowGraph, positions: Positions, a: Pos, b: Pos, compact = false): string[] {
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    return graph.nodes
        .filter((n) => {
            if (n.key === JOB_KEY) {
                return false;
            }
            const p = positions[n.key];
            if (!p) {
                return false;
            }
            const { w, h } = nodeSize(n.kind, compact);
            return p.x <= x1 && p.x + w >= x0 && p.y <= y1 && p.y + h >= y0;
        })
        .map((n) => n.key);
}
