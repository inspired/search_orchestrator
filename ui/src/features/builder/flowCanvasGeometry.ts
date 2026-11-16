/* Pure geometry for the flow canvas: which ports a node shows, where links start and end,
 * which node is under a point, snapping, and the view that frames the whole graph. */
import type { Pos, Positions } from './graphLogic';
import type { FlowGraph, FlowLink, FlowNode, NodeKind, PortId } from './nodeModel';
import { outputPorts } from './nodeModel';
import { inputOffset, nodeSize, portOffset, tabOffset } from './nodeStyle';
import { graphBounds } from './flowLayout';

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2;
export const SNAP = 10;
export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
export const snap = (v: number): number => Math.round(v / SNAP) * SNAP;

/** Ports shown only while the node is hovered or selected, or when a line already leaves them. */
const ON_DEMAND: ReadonlySet<PortId> = new Set<PortId>(['start', 'delayed', 'if']);

export function visiblePorts(kind: NodeKind, expanded: boolean, linked: ReadonlySet<PortId>): PortId[] {
    return outputPorts(kind).filter((p) => !ON_DEMAND.has(p) || expanded || linked.has(p));
}

/** Ports with a line leaving them, by node key. */
export function linkedPorts(graph: FlowGraph): Record<string, Set<PortId>> {
    const out: Record<string, Set<PortId>> = {};
    graph.links.forEach((l) => {
        if (l.port) {
            (out[l.from] = out[l.from] || new Set<PortId>()).add(l.port);
        }
    });
    return out;
}

/** A horizontal bezier from `a` (leaving right) to `b` (entering left). */
export function linkPath(a: Pos, b: Pos): string {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}

/** Start and end of a link in canvas coordinates; null when either end has no position. */
export function linkEnds(
    link: FlowLink,
    from: FlowNode,
    to: FlowNode,
    pos: Positions
): { a: Pos; b: Pos } | null {
    const pa = pos[from.key];
    const pb = pos[to.key];
    if (!pa || !pb) {
        return null;
    }
    let start: Pos;
    if (link.port) {
        const o = portOffset(from.kind, link.port);
        start = { x: pa.x + o.x, y: pa.y + o.y };
    } else {
        const s = nodeSize(from.kind);
        start = { x: pa.x + s.w, y: pa.y + s.h / 2 };
    }
    const i = inputOffset(to.kind) || { x: 0, y: nodeSize(to.kind).h / 2 };
    return { a: start, b: { x: pb.x + i.x, y: pb.y + i.y } };
}

/** Like `linkEnds`, but the line starts at the outcome tab `index` of `count` instead of a port slot. */
export function tabLinkEnds(
    link: FlowLink,
    from: FlowNode,
    to: FlowNode,
    pos: Positions,
    index: number,
    count: number
): { a: Pos; b: Pos } | null {
    const base = linkEnds(link, from, to, pos);
    const pa = pos[from.key];
    if (!base || !pa) {
        return null;
    }
    const o = tabOffset(from.kind, index, count);
    return { a: { x: pa.x + o.x, y: pa.y + o.y }, b: base.b };
}

/** The topmost node whose box contains `pt` (later nodes are drawn on top). */
export function nodeAt(graph: FlowGraph, pos: Positions, pt: Pos): string | null {
    for (let i = graph.nodes.length - 1; i >= 0; i -= 1) {
        const n = graph.nodes[i];
        const p = pos[n.key];
        if (p) {
            const { w, h } = nodeSize(n.kind);
            if (pt.x >= p.x && pt.x <= p.x + w && pt.y >= p.y && pt.y <= p.y + h) {
                return n.key;
            }
        }
    }
    return null;
}

/** Pan and zoom that fit every node in a view of `width` × `height`, never zooming past 1. */
export function frameView(
    graph: FlowGraph,
    pos: Positions,
    width: number,
    height: number,
    margin = 40
): { pan: Pos; zoom: number } | null {
    const b = graphBounds(graph, pos);
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
