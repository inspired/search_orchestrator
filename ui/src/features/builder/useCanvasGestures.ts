/* Pointer gestures on the flow canvas: pan (drag the background), wheel zoom, node drag, and
 * line drag from the + handle or an outcome tab. A press that moves less than 4 px is a click:
 * on a node it selects, on the + it asks for a "when" (`onPlus`), on the background it clears
 * the selection. A line released on a node reports that node (never its own source), anywhere
 * else the canvas point. `onDragMove` is the hook point for auto-pan while dragging. */
import React, { useEffect, useRef, useState } from 'react';
import type { Pos, Positions } from './graphLogic';
import type { FlowGraph, PortId } from './nodeModel';
import { HANDLE_R, handleOffset } from './nodeStyle';
import { clampZoom, nodeAt, snap } from './flowCanvasGeometry';

export type ScreenPoint = { left: number; top: number };

/** Below this many pixels of movement a press is a click. */
export const CLICK_SLOP = 4;

export type Gesture =
    | { kind: 'pan'; startX: number; startY: number; origin: Pos; moved: boolean }
    | { kind: 'node'; key: string; startX: number; startY: number; moved: boolean }
    | { kind: 'line'; from: string; outcome?: PortId; startX: number; startY: number; moved: boolean };

export interface GestureOptions {
    svgRef: React.RefObject<SVGSVGElement | null>;
    graph: FlowGraph;
    positions: Positions;
    canMove: boolean;
    onSelect: (sel: { kind: 'node'; key: string } | null) => void;
    onMove?: (positions: Record<string, Pos>) => void;
    onPlus?: (from: string, screen: ScreenPoint) => void;
    onConnect?: (from: string, outcome: PortId, to: string) => void;
    onDropOnNode?: (from: string, to: string, screen: ScreenPoint, outcome?: PortId) => void;
    onDropOnCanvas?: (from: string, at: Pos, screen: ScreenPoint, outcome?: PortId) => void;
    /** Called on every pointer move of a node or line drag (auto-pan, Task 5). */
    onDragMove?: (clientX: number, clientY: number) => void;
}

const movedFar = (dx: number, dy: number) => Math.max(Math.abs(dx), Math.abs(dy)) >= CLICK_SLOP;

export default function useCanvasGestures(opts: GestureOptions) {
    const { svgRef, graph, positions, canMove, onSelect, onMove, onPlus, onConnect, onDropOnNode, onDropOnCanvas, onDragMove } = opts;
    const [pan, setPan] = useState<Pos>({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [gesture, setGesture] = useState<Gesture | null>(null);
    const [drag, setDrag] = useState<Pos | null>(null);
    const [cursor, setCursor] = useState<Pos | null>(null);
    const over = useRef(false);
    const pointer = useRef<{ clientX: number; clientY: number } | null>(null);
    const view = useRef({ pan, zoom });
    view.current = { pan, zoom };

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

    const shown: Positions =
        gesture && gesture.kind === 'node' && drag && positions[gesture.key]
            ? { ...positions, [gesture.key]: { x: positions[gesture.key].x + drag.x, y: positions[gesture.key].y + drag.y } }
            : positions;

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
        capture(ev);
        setGesture({ kind: 'pan', startX: ev.clientX, startY: ev.clientY, origin: view.current.pan, moved: false });
    };

    const startNode = (ev: React.PointerEvent, key: string) => {
        capture(ev);
        setGesture({ kind: 'node', key, startX: ev.clientX, startY: ev.clientY, moved: false });
    };

    const startLine = (ev: React.PointerEvent, from: string, outcome?: PortId) => {
        capture(ev);
        setGesture({ kind: 'line', from, outcome, startX: ev.clientX, startY: ev.clientY, moved: false });
    };

    const endGesture = () => {
        setGesture(null);
        setDrag(null);
        setCursor(null);
    };

    const onPointerMove = (ev: React.PointerEvent) => {
        over.current = true;
        pointer.current = { clientX: ev.clientX, clientY: ev.clientY };
        if (!gesture) {
            return;
        }
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
        if (moved && onDragMove) {
            onDragMove(ev.clientX, ev.clientY);
        }
        if (gesture.kind === 'node') {
            if (moved && canMove) {
                const z = view.current.zoom;
                setDrag({ x: dx / z, y: dy / z });
            }
        } else if (moved) {
            setCursor(toCanvas(ev.clientX, ev.clientY));
        }
    };

    const dropLine = (g: Extract<Gesture, { kind: 'line' }>, clientX: number, clientY: number) => {
        const end = toCanvas(clientX, clientY);
        const target = nodeAt(graph, shown, end);
        if (target === g.from) {
            return;
        }
        const screen = toScreen(end);
        if (target) {
            if (onDropOnNode) {
                if (g.outcome) {
                    onDropOnNode(g.from, target, screen, g.outcome);
                } else {
                    onDropOnNode(g.from, target, screen);
                }
            } else if (g.outcome && onConnect) {
                onConnect(g.from, g.outcome, target);
            }
        } else if (onDropOnCanvas) {
            if (g.outcome) {
                onDropOnCanvas(g.from, end, screen, g.outcome);
            } else {
                onDropOnCanvas(g.from, end, screen);
            }
        }
    };

    const onPointerUp = (ev: React.PointerEvent) => {
        const g = gesture;
        if (g) {
            const moved = g.moved || movedFar(ev.clientX - g.startX, ev.clientY - g.startY);
            if (g.kind === 'node') {
                const p = positions[g.key];
                if (moved && canMove && p && onMove) {
                    const z = view.current.zoom;
                    onMove({ [g.key]: { x: snap(p.x + (ev.clientX - g.startX) / z), y: snap(p.y + (ev.clientY - g.startY) / z) } });
                } else if (!moved || !canMove) {
                    onSelect({ kind: 'node', key: g.key });
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
        pan, setPan, zoom, setZoom, view, gesture, shown, cursor, over, pointer,
        toCanvas, toScreen, plusScreen, startPan, startNode, startLine, endGesture, onPointerMove, onPointerUp,
    };
}
