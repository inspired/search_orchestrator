/* Pointer gestures on the flow canvas: pan (drag the background), wheel zoom, node drag, line
 * drag from the + handle or an outcome tab, and a selection box (Shift+drag the background, which
 * adds the nodes it touches to the selection). A press that moves less than 4 px is a click:
 * on a node it selects (with Shift, adds it to or takes it out of the selection), on the + it
 * asks for a "when" (`onPlus`), on the background it clears the selection. Dragging a node of a
 * multi-selection moves them all, reported with one `onMove`, and never splices. A line
 * released on a node reports that node (never its own source), anywhere else the canvas point;
 * released on the source's own + or tabs, nothing. A node with no lines dragged with its centre
 * over a line the caller allows (`canSpliceNode`) marks that line (`spliceLink`) and, dropped
 * there, is reported with `onSplice` (and where it was dropped) instead of `onMove`. Escape
 * cancels a drag. A dragged node snaps to alignment guides (`guidesFor`) within 6 px, else to
 * the 10 px grid, per axis. While a node, line or box is dragged near the canvas edge, a
 * requestAnimationFrame loop scrolls the view (`autoPanStep`) and keeps the dragged item (or the
 * box's corner) under the pointer. Dragging a group's title bar moves the frame and the nodes
 * inside it when the drag started (`membersOf`), reported once with `onGroupMove`; dragging its
 * corner resizes it (`onGroupResize`); a click on the title bar selects the group. */
import React, { useEffect, useRef, useState } from 'react';
import type { Pos, Positions } from './graphLogic';
import type { FlowGraph, PortId } from './nodeModel';
import { HANDLE_R, handleOffset, nodeSize } from './nodeStyle';
import { clampZoom, linkAt, nodeAt, snap } from './flowCanvasGeometry';
import { autoPanStep } from './autoPan';
import { Guide, boxOf, guidesFor } from './align';
import { usedOutcomes } from './outcomes';
import { tabBox } from './PlusHandle';
import { Group, MIN_GROUP, membersOf } from './groups';
import { FlowSelection, keysInBox, normaliseSelection, selectedKeys, toggleInSelection } from './selection';

const WHEEL_K = 0.0015;
const LINE_PX = 16;

/** The zoom factor for one wheel event: proportional to the scroll, at most 10 % either way. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0, pageHeight = 800): number {
    const px = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * pageHeight : deltaY;
    return Math.min(1.1, Math.max(1 / 1.1, Math.exp(-px * WHEEL_K)));
}

export type ScreenPoint = { left: number; top: number };

/** Below this many pixels of movement a press is a click. */
export const CLICK_SLOP = 4;

export type Gesture =
    | { kind: 'pan'; startX: number; startY: number; origin: Pos; moved: boolean }
    /** `group`: every node that moves with it (a multi-selection it belongs to). */
    | { kind: 'node'; key: string; startX: number; startY: number; moved: boolean; shift: boolean; group?: string[] }
    /** A selection box from canvas point `start` to the pointer. */
    | { kind: 'box'; start: Pos; startX: number; startY: number; moved: boolean }
    | { kind: 'line'; from: string; outcome?: PortId; startX: number; startY: number; moved: boolean }
    /** `members`: the nodes inside the frame when the drag started, which move with it. */
    | { kind: 'group'; id: string; mode: 'move' | 'resize'; members: string[]; startX: number; startY: number; moved: boolean };

export interface GestureOptions {
    svgRef: React.RefObject<SVGSVGElement | null>;
    graph: FlowGraph;
    positions: Positions;
    canMove: boolean;
    /** Shift+click and the selection box add to `selected`. */
    canSelectMany: boolean;
    selected: FlowSelection;
    onSelect: (sel: FlowSelection) => void;
    onMove?: (positions: Record<string, Pos>) => void;
    onPlus?: (from: string, screen: ScreenPoint) => void;
    onConnect?: (from: string, outcome: PortId, to: string) => void;
    onDropOnNode?: (from: string, to: string, screen: ScreenPoint, outcome?: PortId) => void;
    onDropOnCanvas?: (from: string, at: Pos, screen: ScreenPoint, outcome?: PortId) => void;
    /** A node with no lines dropped on line `link`; only offered when `canSpliceNode` says yes. */
    onSplice?: (node: string, link: string, at: Pos) => void;
    canSpliceNode?: (node: string, link: string) => boolean;
    /** Compact nodes: every box and offset below is the compact one. */
    compact?: boolean;
    groups?: Group[];
    /** Every node, hidden ones included, for group membership (`graph` may leave hidden ones out). */
    memberGraph?: FlowGraph;
    onGroupMove?: (id: string, dx: number, dy: number, members: string[]) => void;
    onGroupResize?: (id: string, size: { w: number; h: number }) => void;
    /** The user panned (dragged the background) or zoomed with the wheel. */
    onUserView?: () => void;
}

const movedFar = (dx: number, dy: number) => Math.max(Math.abs(dx), Math.abs(dy)) >= CLICK_SLOP;
/** Extra reach around the + for "released on the source". */
const HANDLE_SLOP = 4;

export default function useCanvasGestures(opts: GestureOptions) {
    const { svgRef, graph, positions, canMove, canSelectMany, selected, onSelect, onMove, onPlus, onConnect, onDropOnNode, onDropOnCanvas, onSplice, canSpliceNode, compact = false } =
        opts;
    const groups = opts.groups || [];
    const [pan, setPan] = useState<Pos>({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [gesture, setGesture] = useState<Gesture | null>(null);
    const [drag, setDrag] = useState<Pos | null>(null);
    const [cursor, setCursor] = useState<Pos | null>(null);
    const [spliceLink, setSpliceLink] = useState<string | null>(null);
    /** The alignment guides to draw while a node is dragged. */
    const [guides, setGuides] = useState<Guide[]>([]);
    const over = useRef(false);
    const pointer = useRef<{ clientX: number; clientY: number } | null>(null);
    /** The last pointer position of the current drag, kept even if the pointer leaves the canvas. */
    const dragPointer = useRef<{ clientX: number; clientY: number } | null>(null);
    /** How far auto-pan has moved the view during the current drag, in screen px. */
    const panned = useRef<Pos>({ x: 0, y: 0 });
    const view = useRef({ pan, zoom });
    view.current = { pan, zoom };
    const live = useRef<Gesture | null>(null);
    live.current = gesture;
    const userView = useRef(opts.onUserView);
    userView.current = opts.onUserView;

    // Wheel zoom needs a non-passive listener so the page does not scroll as well.
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) {
            return undefined;
        }
        const onWheel = (ev: WheelEvent) => {
            ev.preventDefault();
            userView.current?.();
            const factor = wheelZoomFactor(ev.deltaY, ev.deltaMode, svg.clientHeight || 800);
            setZoom((z) => clampZoom(z * factor));
        };
        svg.addEventListener('wheel', onWheel, { passive: false });
        return () => svg.removeEventListener('wheel', onWheel);
    }, [svgRef]);

    function endGesture() {
        live.current = null;
        setGesture(null);
        setDrag(null);
        setCursor(null);
        setSpliceLink(null);
        setGuides([]);
        dragPointer.current = null;
        panned.current = { x: 0, y: 0 };
    }

    // Escape cancels any drag: no callbacks, and a dragged node goes back where it was.
    const dragging = gesture !== null;
    useEffect(() => {
        if (!dragging) {
            return undefined;
        }
        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                endGesture();
            }
        };
        // Capture, so it runs before other window listeners (full screen leaves on Escape).
        window.addEventListener('keydown', onKey, { capture: true });
        return () => window.removeEventListener('keydown', onKey, { capture: true });
    }, [dragging]);

    const shown: Positions = (() => {
        const moving = gesture && gesture.kind === 'node' ? gesture.group || [gesture.key] : gesture && gesture.kind === 'group' && gesture.mode === 'move' ? gesture.members : null;
        if (!moving || !drag) {
            return positions;
        }
        const out = { ...positions };
        moving.forEach((k) => {
            if (positions[k]) {
                out[k] = { x: positions[k].x + drag.x, y: positions[k].y + drag.y };
            }
        });
        return out;
    })();

    const toCanvas = (clientX: number, clientY: number): Pos => {
        const rect = svgRef.current ? svgRef.current.getBoundingClientRect() : { left: 0, top: 0 };
        const { pan: p, zoom: z } = view.current;
        return { x: (clientX - rect.left - p.x) / z, y: (clientY - rect.top - p.y) / z };
    };

    const toScreen = (at: Pos): ScreenPoint => {
        const { pan: p, zoom: z } = view.current;
        return { left: at.x * z + p.x, top: at.y * z + p.y };
    };

    /** Just right of a node's + on screen, where the When list opens. */
    const plusScreen = (key: string): ScreenPoint | null => {
        const n = graph.nodes.find((x) => x.key === key);
        const p = shown[key];
        if (!n || !p) {
            return null;
        }
        const count = n.kind === 'condition' ? 0 : usedOutcomes(graph, key).length;
        const o = handleOffset(n.kind, compact, count);
        return toScreen({ x: p.x + o.x + HANDLE_R, y: p.y + o.y });
    };

    const capture = (ev: React.PointerEvent) => {
        if (svgRef.current && svgRef.current.setPointerCapture) {
            try {
                svgRef.current.setPointerCapture(ev.pointerId);
            } catch (err) {
                // capture is a nicety; dragging still works inside the canvas
            }
        }
    };

    const startPan = (ev: React.PointerEvent) => {
        if (ev.button !== 0) {
            return;
        }
        capture(ev);
        panned.current = { x: 0, y: 0 };
        if (ev.shiftKey && canSelectMany) {
            setGesture({ kind: 'box', start: toCanvas(ev.clientX, ev.clientY), startX: ev.clientX, startY: ev.clientY, moved: false });
            return;
        }
        setGesture({ kind: 'pan', startX: ev.clientX, startY: ev.clientY, origin: view.current.pan, moved: false });
    };

    const startNode = (ev: React.PointerEvent, key: string) => {
        if (ev.button !== 0) {
            return;
        }
        capture(ev);
        panned.current = { x: 0, y: 0 };
        const keys = selectedKeys(selected);
        const group = keys.length > 1 && keys.includes(key) ? keys : undefined;
        setGesture({ kind: 'node', key, startX: ev.clientX, startY: ev.clientY, moved: false, shift: ev.shiftKey && canSelectMany, group });
    };

    const startGroup = (ev: React.PointerEvent, id: string, mode: 'move' | 'resize') => {
        const g = groups.find((x) => x.id === id);
        if (ev.button !== 0 || !g) {
            return;
        }
        capture(ev);
        panned.current = { x: 0, y: 0 };
        const members = membersOf(g, opts.memberGraph || graph, positions);
        setGesture({ kind: 'group', id, mode, members, startX: ev.clientX, startY: ev.clientY, moved: false });
    };

    /** Where the group of gesture `g` is for a raw `offset`: moved (snapped to the grid on drop) or resized. */
    const groupAt = (g: Extract<Gesture, { kind: 'group' }>, offset: Pos, drop: boolean): Group | null => {
        const grp = groups.find((x) => x.id === g.id);
        if (!grp) {
            return null;
        }
        if (g.mode === 'resize') {
            return { ...grp, w: Math.max(MIN_GROUP.w, Math.round(grp.w + offset.x)), h: Math.max(MIN_GROUP.h, Math.round(grp.h + offset.y)) };
        }
        return drop ? { ...grp, x: snap(grp.x + offset.x), y: snap(grp.y + offset.y) } : { ...grp, x: grp.x + offset.x, y: grp.y + offset.y };
    };

    /** A group as drawn now: following the drag, if it is the one dragged. */
    const groupShown = (grp: Group): Group =>
        gesture && gesture.kind === 'group' && gesture.id === grp.id && drag ? groupAt(gesture, drag, false) || grp : grp;

    const startLine = (ev: React.PointerEvent, from: string, outcome?: PortId) => {
        if (ev.button !== 0) {
            return;
        }
        capture(ev);
        panned.current = { x: 0, y: 0 };
        setGesture({ kind: 'line', from, outcome, startX: ev.clientX, startY: ev.clientY, moved: false });
    };


    /** A dragged node's offset in canvas units for a pointer at clientX/Y, auto-pan included. */
    const nodeOffset = (g: Gesture, clientX: number, clientY: number): Pos => {
        const z = view.current.zoom;
        return { x: (clientX - g.startX - panned.current.x) / z, y: (clientY - g.startY - panned.current.y) / z };
    };

    /** Where the dragged node goes for a raw `offset`: `shown` while dragging (snapped to a guide
     * only), `drop` on release (snapped to a guide, else to the grid, per axis), and the guides.
     * Guides compare the dragged node alone with the nodes that are not moving. */
    const placed = (g: Extract<Gesture, { kind: 'node' }>, offset: Pos) => {
        const p = positions[g.key];
        const mine = boxOf(graph, positions, g.key, compact);
        if (!p || !mine) {
            return { shown: offset, drop: offset, lines: [] as Guide[] };
        }
        const moving = new Set(g.group || [g.key]);
        const others = graph.nodes.flatMap((n) => (moving.has(n.key) ? [] : [boxOf(graph, positions, n.key, compact)])).filter((b): b is NonNullable<typeof b> => b !== null);
        const r = guidesFor({ ...mine, x: p.x + offset.x, y: p.y + offset.y }, others);
        const onX = r.lines.some((l) => l.axis === 'x');
        const onY = r.lines.some((l) => l.axis === 'y');
        const axis = (guided: boolean, d: number, from: number, off: number) => ({
            shown: guided ? off + d : off,
            drop: guided ? Math.round(from + off + d) - from : snap(from + off) - from,
        });
        const x = axis(onX, r.dx, p.x, offset.x);
        const y = axis(onY, r.dy, p.y, offset.y);
        return { shown: { x: x.shown, y: y.shown }, drop: { x: x.drop, y: y.drop }, lines: r.lines };
    };

    /** The line a lineless node dragged by `offset` would be spliced into, if the caller allows;
     * never for a multi-selection. */
    const spliceTarget = (g: Extract<Gesture, { kind: 'node' }>, offset: Pos): string | null => {
        const { key } = g;
        const n = graph.nodes.find((x) => x.key === key);
        const p = positions[key];
        if (!n || !p || !onSplice || !canSpliceNode || !canMove || g.group) {
            return null;
        }
        if (graph.links.some((l) => l.kind !== 'trigger' && (l.from === key || l.to === key))) {
            return null;
        }
        const { w, h } = nodeSize(n.kind, compact);
        const link = linkAt(graph, positions, { x: p.x + offset.x + w / 2, y: p.y + offset.y + h / 2 }, 8, compact);
        return link && canSpliceNode(key, link) ? link : null;
    };

    /** Follow the pointer with the dragged node or line end. */
    const follow = (g: Gesture, clientX: number, clientY: number) => {
        if (g.kind === 'group') {
            if (canMove) {
                setDrag(nodeOffset(g, clientX, clientY));
            }
        } else if (g.kind === 'node') {
            if (canMove) {
                const offset = nodeOffset(g, clientX, clientY);
                const at = placed(g, offset);
                setDrag(at.shown);
                setGuides(at.lines);
                const target = spliceTarget(g, offset);
                setSpliceLink((cur) => (cur === target ? cur : target));
            }
        } else if (g.kind === 'line' || g.kind === 'box') {
            setCursor(toCanvas(clientX, clientY));
        }
    };

    const onPointerMove = (ev: React.PointerEvent) => {
        over.current = true;
        pointer.current = { clientX: ev.clientX, clientY: ev.clientY };
        if (!gesture) {
            return;
        }
        dragPointer.current = { clientX: ev.clientX, clientY: ev.clientY };
        const dx = ev.clientX - gesture.startX;
        const dy = ev.clientY - gesture.startY;
        const moved = gesture.moved || movedFar(dx, dy);
        if (moved && !gesture.moved) {
            setGesture({ ...gesture, moved: true });
        }
        if (gesture.kind === 'pan') {
            // A click on the background never pans: only once the press passes the click slop.
            if (!moved) {
                return;
            }
            if (!gesture.moved) {
                userView.current?.();
            }
            setPan({ x: gesture.origin.x + dx, y: gesture.origin.y + dy });
            return;
        }
        if (moved) {
            follow(gesture, ev.clientX, ev.clientY);
        }
    };

    // Auto-pan: while a node, line or box drag is under way, every frame with the pointer near an edge
    // scrolls the view and moves the dragged item with it, so it stays under the pointer.
    const autoPanning = gesture !== null && gesture.kind !== 'pan' && gesture.moved;
    const followRef = useRef(follow);
    followRef.current = follow;
    useEffect(() => {
        if (!autoPanning || typeof window.requestAnimationFrame !== 'function') {
            return undefined;
        }
        let stopped = false;
        let id = 0;
        const tick = () => {
            if (stopped) {
                return;
            }
            const g = live.current;
            const ptr = dragPointer.current;
            const svg = svgRef.current;
            if (g && g.kind !== 'pan' && ptr && svg) {
                const r = svg.getBoundingClientRect();
                const step = autoPanStep({ x: ptr.clientX - r.left, y: ptr.clientY - r.top }, { w: r.width, h: r.height });
                if (step.x || step.y) {
                    const next = { x: view.current.pan.x - step.x, y: view.current.pan.y - step.y };
                    panned.current = { x: panned.current.x + next.x - view.current.pan.x, y: panned.current.y + next.y - view.current.pan.y };
                    view.current = { ...view.current, pan: next };
                    setPan(next);
                    followRef.current(g, ptr.clientX, ptr.clientY);
                }
            }
            id = window.requestAnimationFrame(tick);
        };
        id = window.requestAnimationFrame(tick);
        return () => {
            stopped = true;
            window.cancelAnimationFrame(id);
        };
    }, [autoPanning]);

    /** `pt` is on the + or one of the outcome tabs of node `key`, which stick out past its box. */
    const onOwnHandle = (key: string, pt: Pos): boolean => {
        const n = graph.nodes.find((x) => x.key === key);
        const p = shown[key];
        if (!n || !p) {
            return false;
        }
        const tabs = n.kind === 'condition' ? [] : usedOutcomes(graph, key);
        const h = handleOffset(n.kind, compact, tabs.length);
        if (Math.hypot(pt.x - (p.x + h.x), pt.y - (p.y + h.y)) <= HANDLE_R + HANDLE_SLOP) {
            return true;
        }
        return tabs.some((o, i) => {
            const b = tabBox(n.kind, i, tabs.length, o, compact);
            return pt.x >= p.x + b.x && pt.x <= p.x + b.x + b.w && pt.y >= p.y + b.y && pt.y <= p.y + b.y + b.h;
        });
    };

    const dropLine = (g: Extract<Gesture, { kind: 'line' }>, clientX: number, clientY: number) => {
        const end = toCanvas(clientX, clientY);
        const target = nodeAt(graph, shown, end, compact);
        if (target === g.from || onOwnHandle(g.from, end)) {
            return;
        }
        const screen = toScreen(end);
        const outcome: [PortId?] = g.outcome ? [g.outcome] : [];
        if (target) {
            if (onDropOnNode) {
                onDropOnNode(g.from, target, screen, ...outcome);
            } else if (g.outcome && onConnect) {
                onConnect(g.from, g.outcome, target);
            }
        } else if (onDropOnCanvas) {
            onDropOnCanvas(g.from, end, screen, ...outcome);
        }
    };

    const onPointerUp = (ev: React.PointerEvent) => {
        const g = gesture;
        if (g) {
            const moved = g.moved || movedFar(ev.clientX - g.startX, ev.clientY - g.startY);
            if (g.kind === 'node') {
                const p = positions[g.key];
                const offset = nodeOffset(g, ev.clientX, ev.clientY);
                const into = moved ? spliceTarget(g, offset) : null;
                if (into && onSplice && p) {
                    onSplice(g.key, into, { x: snap(p.x + offset.x), y: snap(p.y + offset.y) });
                } else if (moved && canMove && p && onMove) {
                    // The dragged node snaps to a guide or the grid; the others move as far as it did.
                    const { x: dx, y: dy } = placed(g, offset).drop;
                    const out: Record<string, Pos> = {};
                    (g.group || [g.key]).forEach((k) => {
                        if (positions[k]) {
                            out[k] = { x: positions[k].x + dx, y: positions[k].y + dy };
                        }
                    });
                    onMove(out);
                } else if (!moved && g.shift) {
                    onSelect(toggleInSelection(selected, g.key));
                } else if (!moved || !canMove) {
                    onSelect({ kind: 'node', key: g.key });
                }
            } else if (g.kind === 'group') {
                const at = moved && canMove ? groupAt(g, nodeOffset(g, ev.clientX, ev.clientY), true) : null;
                const was = groups.find((x) => x.id === g.id);
                if (!moved) {
                    onSelect({ kind: 'group', id: g.id });
                } else if (at && was && g.mode === 'resize') {
                    opts.onGroupResize?.(g.id, { w: at.w, h: at.h });
                } else if (at && was && (at.x !== was.x || at.y !== was.y)) {
                    opts.onGroupMove?.(g.id, at.x - was.x, at.y - was.y, g.members);
                }
            } else if (g.kind === 'box') {
                if (moved) {
                    const hits = keysInBox(graph, shown, g.start, toCanvas(ev.clientX, ev.clientY), compact);
                    onSelect(normaliseSelection([...selectedKeys(selected), ...hits]));
                }
            } else if (g.kind === 'line') {
                if (moved) {
                    dropLine(g, ev.clientX, ev.clientY);
                } else if (!g.outcome && onPlus) {
                    const at = plusScreen(g.from);
                    if (at) {
                        onPlus(g.from, at);
                    }
                }
            } else if (!moved) {
                onSelect(null);
            }
        }
        endGesture();
    };

    return {
        pan, setPan, zoom, setZoom, view, gesture, shown, cursor, spliceLink, guides, over, pointer,
        toCanvas, toScreen, plusScreen, startPan, startNode, startLine, startGroup, groupShown, endGesture, onPointerMove, onPointerUp,
    };
}
