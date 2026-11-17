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
 * cancels a drag. While a node, line or box is dragged near the canvas edge, a
 * requestAnimationFrame loop scrolls the view (`autoPanStep`) and keeps the dragged item (or the
 * box's corner) under the pointer. */
import React, { useEffect, useRef, useState } from 'react';
import type { Pos, Positions } from './graphLogic';
import type { FlowGraph, PortId } from './nodeModel';
import { HANDLE_R, handleOffset, nodeSize } from './nodeStyle';
import { clampZoom, linkAt, nodeAt, snap } from './flowCanvasGeometry';
import { autoPanStep } from './autoPan';
import { usedOutcomes } from './outcomes';
import { tabBox } from './PlusHandle';
import { FlowSelection, keysInBox, normaliseSelection, selectedKeys, toggleInSelection } from './selection';

export type ScreenPoint = { left: number; top: number };

/** Below this many pixels of movement a press is a click. */
export const CLICK_SLOP = 4;

export type Gesture =
    | { kind: 'pan'; startX: number; startY: number; origin: Pos; moved: boolean }
    /** `group`: every node that moves with it (a multi-selection it belongs to). */
    | { kind: 'node'; key: string; startX: number; startY: number; moved: boolean; shift: boolean; group?: string[] }
    /** A selection box from canvas point `start` to the pointer. */
    | { kind: 'box'; start: Pos; startX: number; startY: number; moved: boolean }
    | { kind: 'line'; from: string; outcome?: PortId; startX: number; startY: number; moved: boolean };

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
}

const movedFar = (dx: number, dy: number) => Math.max(Math.abs(dx), Math.abs(dy)) >= CLICK_SLOP;
/** Extra reach around the + for "released on the source". */
const HANDLE_SLOP = 4;

export default function useCanvasGestures(opts: GestureOptions) {
    const { svgRef, graph, positions, canMove, canSelectMany, selected, onSelect, onMove, onPlus, onConnect, onDropOnNode, onDropOnCanvas, onSplice, canSpliceNode } =
        opts;
    const [pan, setPan] = useState<Pos>({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [gesture, setGesture] = useState<Gesture | null>(null);
    const [drag, setDrag] = useState<Pos | null>(null);
    const [cursor, setCursor] = useState<Pos | null>(null);
    const [spliceLink, setSpliceLink] = useState<string | null>(null);
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

    // Wheel zoom needs a non-passive listener so the page does not scroll as well.
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) {
            return undefined;
        }
        const onWheel = (ev: WheelEvent) => {
            ev.preventDefault();
            setZoom((z) => clampZoom(z * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
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
        if (!gesture || gesture.kind !== 'node' || !drag) {
            return positions;
        }
        const out = { ...positions };
        (gesture.group || [gesture.key]).forEach((k) => {
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
        const o = handleOffset(n.kind);
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
        const { w, h } = nodeSize(n.kind);
        const link = linkAt(graph, positions, { x: p.x + offset.x + w / 2, y: p.y + offset.y + h / 2 });
        return link && canSpliceNode(key, link) ? link : null;
    };

    /** Follow the pointer with the dragged node or line end. */
    const follow = (g: Gesture, clientX: number, clientY: number) => {
        if (g.kind === 'node') {
            if (canMove) {
                const offset = nodeOffset(g, clientX, clientY);
                setDrag(offset);
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
        const h = handleOffset(n.kind);
        if (Math.hypot(pt.x - (p.x + h.x), pt.y - (p.y + h.y)) <= HANDLE_R + HANDLE_SLOP) {
            return true;
        }
        const tabs = n.kind === 'condition' ? [] : usedOutcomes(graph, key);
        return tabs.some((o, i) => {
            const b = tabBox(n.kind, i, tabs.length, o);
            return pt.x >= p.x + b.x && pt.x <= p.x + b.x + b.w && pt.y >= p.y + b.y && pt.y <= p.y + b.y + b.h;
        });
    };

    const dropLine = (g: Extract<Gesture, { kind: 'line' }>, clientX: number, clientY: number) => {
        const end = toCanvas(clientX, clientY);
        const target = nodeAt(graph, shown, end);
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
                    // The dragged node snaps to the grid; the others move as far as it did.
                    const dx = snap(p.x + offset.x) - p.x;
                    const dy = snap(p.y + offset.y) - p.y;
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
            } else if (g.kind === 'box') {
                if (moved) {
                    const hits = keysInBox(graph, shown, g.start, toCanvas(ev.clientX, ev.clientY));
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
        pan, setPan, zoom, setZoom, view, gesture, shown, cursor, spliceLink, over, pointer,
        toCanvas, toScreen, plusScreen, startPan, startNode, startLine, endGesture, onPointerMove, onPointerUp,
    };
}
