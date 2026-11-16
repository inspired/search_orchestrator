/* Pure geometry for the flow canvas: where links start and end, which node is under a point,
 * snapping, and the view that frames the whole graph. */
import type { Pos, Positions } from './graphLogic';
import type { FlowGraph, FlowLink, FlowNode, PortId } from './nodeModel';
import { handleOffset, inputOffset, nodeSize, tabOffset } from './nodeStyle';
import { graphBounds } from './flowLayout';

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2;
export const SNAP = 10;
export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
export const snap = (v: number): number => Math.round(v / SNAP) * SNAP;

/** A horizontal bezier from `a` (leaving right) to `b` (entering left). */
export function linkPath(a: Pos, b: Pos): string {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
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
    tabs: readonly PortId[] = []
): { a: Pos; b: Pos } | null {
    const pa = pos[from.key];
    const pb = pos[to.key];
    if (!pa || !pb) {
        return null;
    }
    const s = nodeSize(from.kind);
    let o = { x: s.w, y: s.h / 2 };
    if (link.port && from.kind !== 'condition') {
        const i = tabs.indexOf(link.port);
        o = i >= 0 ? tabOffset(from.kind, i, tabs.length) : handleOffset(from.kind);
    }
    const i = inputOffset(to.kind) || { x: 0, y: nodeSize(to.kind).h / 2 };
    return { a: { x: pa.x + o.x, y: pa.y + o.y }, b: { x: pb.x + i.x, y: pb.y + i.y } };
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
