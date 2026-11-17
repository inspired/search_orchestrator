/* The maths behind the canvas grid helpers: alignment guides while a node is dragged, and the
 * Align and Distribute commands for a multi-selection. All in canvas units. */
import type { Pos, Positions } from './graphLogic';
import type { FlowGraph } from './nodeModel';
import { nodeSize } from './nodeStyle';

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** A guide to draw: a vertical line at x = `at` (axis 'x') or a horizontal one at y = `at`,
 * running from `from` to `to` on the other axis. */
export interface Guide {
    axis: 'x' | 'y';
    at: number;
    from: number;
    to: number;
}

export type AlignHow = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type Arrange = AlignHow | 'spread-x' | 'spread-y';

export const ALIGN_LABEL: Record<AlignHow, string> = {
    left: 'Align left',
    center: 'Align centres',
    right: 'Align right',
    top: 'Align top',
    middle: 'Align middles',
    bottom: 'Align bottom',
};
export const DISTRIBUTE_LABEL = { 'spread-x': 'Distribute horizontally', 'spread-y': 'Distribute vertically' };
export const DISTRIBUTE_REASON = 'Select three or more nodes';

const edges = (b: Box, axis: 'x' | 'y'): number[] => (axis === 'x' ? [b.x, b.x + b.w / 2, b.x + b.w] : [b.y, b.y + b.h / 2, b.y + b.h]);

/** The nearest offset (within `tol`) that lines one of `m`'s edges up with one of `others`'. */
function nearest(m: Box, others: Box[], axis: 'x' | 'y', tol: number): number | null {
    let best: number | null = null;
    others.forEach((o) =>
        edges(o, axis).forEach((t) =>
            edges(m, axis).forEach((e) => {
                const d = t - e;
                if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) {
                    best = d;
                }
            })
        )
    );
    return best;
}

/** How far to nudge `moving` so its left, centre or right (top, middle or bottom) lines up with
 * another box's, per axis, plus the guide segments to draw at the snapped position. */
export function guidesFor(moving: Box, others: Box[], tol = 6): { dx: number; dy: number; lines: Guide[] } {
    const dx = nearest(moving, others, 'x', tol);
    const dy = nearest(moving, others, 'y', tol);
    const at: Box = { ...moving, x: moving.x + (dx || 0), y: moving.y + (dy || 0) };
    const lines: Guide[] = [];
    (['x', 'y'] as const).forEach((axis) => {
        if ((axis === 'x' ? dx : dy) === null) {
            return;
        }
        const cross = axis === 'x' ? 'y' : 'x';
        const span = (b: Box): [number, number] => (cross === 'y' ? [b.y, b.y + b.h] : [b.x, b.x + b.w]);
        const mine = edges(at, axis);
        others.forEach((o) =>
            edges(o, axis).forEach((t) => {
                if (mine.some((e) => Math.abs(e - t) < 0.01)) {
                    const [a1, a2] = span(at);
                    const [b1, b2] = span(o);
                    lines.push({ axis, at: t, from: Math.min(a1, b1), to: Math.max(a2, b2) });
                }
            })
        );
    });
    return { dx: dx || 0, dy: dy || 0, lines };
}

const values = (boxes: Record<string, Box>) => Object.keys(boxes).map((k) => ({ k, b: boxes[k] }));

/** New top-left positions that line the boxes up on their shared bounding box. */
export function align(boxes: Record<string, Box>, how: AlignHow): Record<string, Pos> {
    const all = values(boxes).map((v) => v.b);
    const horizontal = how === 'left' || how === 'center' || how === 'right';
    const lo = Math.min(...all.map((b) => (horizontal ? b.x : b.y)));
    const hi = Math.max(...all.map((b) => (horizontal ? b.x + b.w : b.y + b.h)));
    const out: Record<string, Pos> = {};
    values(boxes).forEach(({ k, b }) => {
        const size = horizontal ? b.w : b.h;
        const start = how === 'left' || how === 'top' ? lo : how === 'right' || how === 'bottom' ? hi - size : Math.round((lo + hi) / 2 - size / 2);
        out[k] = horizontal ? { x: start, y: b.y } : { x: b.x, y: start };
    });
    return out;
}

/** New positions with equal gaps between boxes along `axis`; the outer two stay put. Needs three. */
export function distribute(boxes: Record<string, Box>, axis: 'x' | 'y'): Record<string, Pos> {
    const sorted = values(boxes).sort((a, b) => (axis === 'x' ? a.b.x - b.b.x : a.b.y - b.b.y));
    if (sorted.length < 3) {
        return {};
    }
    const size = (b: Box) => (axis === 'x' ? b.w : b.h);
    const start = (b: Box) => (axis === 'x' ? b.x : b.y);
    const first = sorted[0].b;
    const last = sorted[sorted.length - 1].b;
    const gap = (start(last) + size(last) - start(first) - sorted.reduce((sum, v) => sum + size(v.b), 0)) / (sorted.length - 1);
    const out: Record<string, Pos> = {};
    let at = start(first);
    sorted.forEach(({ k, b }) => {
        const s = Math.round(at);
        out[k] = axis === 'x' ? { x: s, y: b.y } : { x: b.x, y: s };
        at += size(b) + gap;
    });
    return out;
}

/** The box of node `key` at its position, from its kind's size. */
export function boxOf(graph: FlowGraph, positions: Positions, key: string, compact = false): Box | null {
    const n = graph.nodes.find((x) => x.key === key);
    const p = positions[key];
    return n && p ? { x: p.x, y: p.y, ...nodeSize(n.kind, compact) } : null;
}

/** Aligns or distributes the nodes `keys`; only the nodes that actually move are returned. */
export function arrange(graph: FlowGraph, positions: Positions, keys: string[], how: Arrange, compact = false): Record<string, Pos> {
    const boxes: Record<string, Box> = {};
    keys.forEach((k) => {
        const b = boxOf(graph, positions, k, compact);
        if (b) {
            boxes[k] = b;
        }
    });
    const next = how === 'spread-x' ? distribute(boxes, 'x') : how === 'spread-y' ? distribute(boxes, 'y') : align(boxes, how);
    const out: Record<string, Pos> = {};
    Object.keys(next).forEach((k) => {
        if (next[k].x !== positions[k].x || next[k].y !== positions[k].y) {
            out[k] = next[k];
        }
    });
    return out;
}
