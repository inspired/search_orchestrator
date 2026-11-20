/* Auto-pan while dragging: within EDGE px of the canvas edge, the view scrolls toward that edge,
 * faster the closer the pointer is, up to MAX_STEP px per frame. */
import type { Pos } from './graphLogic';

export const EDGE = 40;
export const MAX_STEP = 16;

const axis = (v: number, size: number): number => {
    if (v < EDGE) {
        return -Math.round(MAX_STEP * Math.min(1, (EDGE - v) / EDGE));
    }
    if (v > size - EDGE) {
        return Math.round(MAX_STEP * Math.min(1, (v - (size - EDGE)) / EDGE));
    }
    return 0;
};

/** How far the view should scroll this frame for a pointer at `pt` (relative to the canvas'
 * top-left) in a canvas of `view` size: negative x scrolls left (the pan grows by the opposite),
 * and so on. The centre, and an unmeasured canvas, give {x: 0, y: 0}. */
export function autoPanStep(pt: Pos, view: { w: number; h: number }): Pos {
    if (view.w <= 0 || view.h <= 0) {
        return { x: 0, y: 0 };
    }
    return { x: axis(pt.x, view.w) || 0, y: axis(pt.y, view.h) || 0 };
}
