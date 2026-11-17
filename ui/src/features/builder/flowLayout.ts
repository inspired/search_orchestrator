/* Left-to-right layout for the node editor. Saved positions win; nodes without one are placed
 * next to their first upstream node, or by dagre when nothing upstream is placed. */
import * as dagre from '@dagrejs/dagre';
import type { FlowGraph, FlowNode, NodeKind } from './nodeModel';
import { nodeSize } from './nodeStyle';
import type { Pos, Positions } from './graphLogic';

const COL_STEP = 260;
const ROW_STEP = 80;
const GAP = 20;
const CONDITION_LABEL = 36;

function boxOf(n: FlowNode, compact = false): { w: number; h: number } {
    const { w, h } = nodeSize(n.kind, compact);
    return { w, h: n.kind === 'condition' ? h + CONDITION_LABEL : h };
}

function validPos(v: unknown): v is Pos {
    if (typeof v !== 'object' || v === null) {
        return false;
    }
    const p = v as Record<string, unknown>;
    return typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y);
}

function dagrePositions(graph: FlowGraph, compact: boolean): Positions {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    const keys = new Set(graph.nodes.map((n) => n.key));
    graph.nodes.forEach((n) => {
        const { w, h } = nodeSize(n.kind, compact);
        g.setNode(n.key, { width: w, height: h });
    });
    graph.links.forEach((l) => {
        if (keys.has(l.from) && keys.has(l.to) && l.from !== l.to) {
            g.setEdge(l.from, l.to);
        }
    });
    dagre.layout(g);
    const out: Positions = {};
    graph.nodes.forEach((n) => {
        const d = g.node(n.key);
        const { w, h } = nodeSize(n.kind, compact);
        out[n.key] = { x: Math.round(d.x - w / 2), y: Math.round(d.y - h / 2) };
    });
    return out;
}

/** Top-left position of every node: saved ones as given, the rest placed automatically. */
export function layoutFlow(graph: FlowGraph, saved?: Record<string, unknown>, compact = false): Positions {
    const auto = dagrePositions(graph, compact);
    const out: Positions = {};
    const byKey = new Map(graph.nodes.map((n) => [n.key, n] as const));
    if (saved && typeof saved === 'object') {
        graph.nodes.forEach((n) => {
            const s = saved[n.key];
            if (validPos(s)) {
                out[n.key] = { x: s.x, y: s.y };
            }
        });
    }
    if (Object.keys(out).length === 0) {
        return auto;
    }
    const firstSource = (key: string): string | undefined => graph.links.find((l) => l.to === key)?.from;
    const overlaps = (n: FlowNode, p: Pos): boolean => {
        const a = boxOf(n, compact);
        return Object.entries(out).some(([k, q]) => {
            const other = byKey.get(k);
            if (!other) {
                return false;
            }
            const b = boxOf(other, compact);
            return (
                p.x < q.x + b.w + GAP && q.x < p.x + a.w + GAP && p.y < q.y + b.h + GAP && q.y < p.y + a.h + GAP
            );
        });
    };
    const placeNext = (n: FlowNode, src: Pos): void => {
        let y = src.y;
        const x = src.x + COL_STEP;
        while (overlaps(n, { x, y })) {
            y += ROW_STEP;
        }
        out[n.key] = { x, y };
    };
    for (;;) {
        let progressed = false;
        graph.nodes.forEach((n) => {
            if (out[n.key]) {
                return;
            }
            const src = firstSource(n.key);
            if (src && out[src]) {
                placeNext(n, out[src]);
                progressed = true;
            }
        });
        if (progressed) {
            continue;
        }
        const next = graph.nodes.find((n) => !out[n.key]);
        if (!next) {
            break;
        }
        out[next.key] = auto[next.key];
    }
    return out;
}

/** A box on the canvas (a group frame). */
export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Box enclosing every node, including the label under condition nodes, and the `extra` boxes. */
export function graphBounds(graph: FlowGraph, pos: Positions, compact = false, extra: Box[] = []): { x: number; y: number; width: number; height: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    extra.forEach((e) => {
        minX = Math.min(minX, e.x);
        minY = Math.min(minY, e.y);
        maxX = Math.max(maxX, e.x + e.w);
        maxY = Math.max(maxY, e.y + e.h);
    });
    graph.nodes.forEach((n) => {
        const p = pos[n.key];
        if (!p) {
            return;
        }
        const b = boxOf(n, compact);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + b.w);
        maxY = Math.max(maxY, p.y + b.h);
    });
    if (!Number.isFinite(minX)) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Where a new node of `kind` goes when added from the node `key`: one column to its right,
 * moved down in steps until it overlaps no other node (with a gap). */
export function freeSpotRightOf(graph: FlowGraph, pos: Positions, key: string, kind: NodeKind, compact = false): Pos {
    const src = pos[key] || { x: 0, y: 0 };
    const mine = nodeSize(kind, compact);
    const others = graph.nodes.filter((n) => n.key !== key && pos[n.key]);
    const x = src.x + COL_STEP;
    let y = src.y;
    const hits = (): boolean =>
        others.some((n) => {
            const q = pos[n.key];
            const b = boxOf(n, compact);
            return x < q.x + b.w + GAP && q.x < x + mine.w + GAP && y < q.y + b.h + GAP && q.y < y + mine.h + GAP;
        });
    while (hits()) {
        y += ROW_STEP;
    }
    return { x, y };
}
