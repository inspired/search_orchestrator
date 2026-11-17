/* Pure geometry for the flow canvas: where links start and end, which node or line is under a
 * point, snapping, and the view that frames the whole graph. */
import type { Pos, Positions } from './graphLogic';
import type { FlowGraph, FlowLink, FlowNode, PortId } from './nodeModel';
import { handleOffset, inputOffset, nodeSize, tabOffset } from './nodeStyle';
import { graphBounds } from './flowLayout';
import type { Box } from './flowLayout';
import { usedOutcomes } from './outcomes';

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2;
export const SNAP = 10;
export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
export const snap = (v: number): number => Math.round(v / SNAP) * SNAP;

const reach = (a: Pos, b: Pos) => Math.max(40, Math.abs(b.x - a.x) / 2);

/** A horizontal bezier from `a` (leaving right) to `b` (entering left). */
export function linkPath(a: Pos, b: Pos): string {
    const dx = reach(a, b);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}

/** The point at `t` (0 to 1) along the curve `linkPath(a, b)` draws. */
export function bezierAt(a: Pos, b: Pos, t: number): Pos {
    const dx = reach(a, b);
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    const xs = [a.x, a.x + dx, b.x - dx, b.x];
    const ys = [a.y, a.y, b.y, b.y];
    return { x: w.reduce((s, k, i) => s + k * xs[i], 0), y: w.reduce((s, k, i) => s + k * ys[i], 0) };
}

/** Start and end of a link in canvas coordinates; null when either end has no position.
 * `tabs` are the outcomes in use on `from` (see `usedOutcomes`), nearest the + first: a line
 * leaves the tab of its outcome, a condition's line the diamond's right tip, a trigger's line
 * its right middle. An outcome without a tab leaves the +. */
export function linkEnds(
    link: FlowLink,
    from: FlowNode,
    to: FlowNode,
    pos: Positions,
    tabs: readonly PortId[] = [],
    compact = false
): { a: Pos; b: Pos } | null {
    const pa = pos[from.key];
    const pb = pos[to.key];
    if (!pa || !pb) {
        return null;
    }
    const s = nodeSize(from.kind, compact);
    let o = { x: s.w, y: s.h / 2 };
    if (link.port && from.kind !== 'condition') {
        const i = tabs.indexOf(link.port);
        o = i >= 0 ? tabOffset(from.kind, i, tabs.length, compact) : handleOffset(from.kind, compact);
    }
    const i = inputOffset(to.kind, compact) || { x: 0, y: nodeSize(to.kind, compact).h / 2 };
    return { a: { x: pa.x + o.x, y: pa.y + o.y }, b: { x: pb.x + i.x, y: pb.y + i.y } };
}

/** The topmost node whose box contains `pt` (later nodes are drawn on top). */
export function nodeAt(graph: FlowGraph, pos: Positions, pt: Pos, compact = false): string | null {
    for (let i = graph.nodes.length - 1; i >= 0; i -= 1) {
        const n = graph.nodes[i];
        const p = pos[n.key];
        if (p) {
            const { w, h } = nodeSize(n.kind, compact);
            if (pt.x >= p.x && pt.x <= p.x + w && pt.y >= p.y && pt.y <= p.y + h) {
                return n.key;
            }
        }
    }
    return null;
}

const SAMPLES = 24;

function distToSegment(p: Pos, a: Pos, b: Pos): number {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len = vx * vx + vy * vy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len)) : 0;
    return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** The line nearest `pt` within `tolerance` canvas px, sampling each curve at 24 points; trigger
 * lines (which cannot be selected) are skipped. */
export function linkAt(graph: FlowGraph, pos: Positions, pt: Pos, tolerance = 8, compact = false): string | null {
    const byKey = new Map(graph.nodes.map((n) => [n.key, n] as const));
    let best: { key: string; d: number } | null = null;
    graph.links.forEach((l) => {
        const from = byKey.get(l.from);
        const to = byKey.get(l.to);
        const ends = l.kind !== 'trigger' && from && to ? linkEnds(l, from, to, pos, usedOutcomes(graph, l.from), compact) : null;
        if (!ends) {
            return;
        }
        let prev = ends.a;
        for (let i = 1; i <= SAMPLES; i += 1) {
            const next = bezierAt(ends.a, ends.b, i / SAMPLES);
            const d = distToSegment(pt, prev, next);
            if (d <= tolerance && (!best || d < best.d)) {
                best = { key: l.key, d };
            }
            prev = next;
        }
    });
    return best ? (best as { key: string }).key : null;
}

/** Pan and zoom that fit every node (and the `extra` boxes, such as group frames) in a view of
 * `width` × `height`, never zooming past 1. */
export function frameView(
    graph: FlowGraph,
    pos: Positions,
    width: number,
    height: number,
    margin = 40,
    compact = false,
    extra: Box[] = []
): { pan: Pos; zoom: number } | null {
    const b = graphBounds(graph, pos, compact, extra);
    if (!width || !height || (b.width === 0 && b.height === 0)) {
        return null;
    }
    const fit = Math.min((width - 2 * margin) / Math.max(1, b.width), (height - 2 * margin) / Math.max(1, b.height));
    const zoom = clampZoom(Math.min(1, fit));
    return {
        zoom,
        pan: { x: width / 2 - (b.x + b.width / 2) * zoom, y: height / 2 - (b.y + b.height / 2) * zoom },
    };
}
