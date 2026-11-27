/* A small map of the whole graph, bottom-right of the canvas: each node as a rect in its family
 * colour and the visible view as an outline. Click a point to centre the view there, or drag to
 * move the view with the pointer. Hidden from
 * screen readers; "Frame all" and the F key are the accessible equivalent. */
import React, { useEffect, useRef } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Pos, Positions } from './graphLogic';
import { Theme } from './GraphView';
import type { FlowGraph } from './nodeModel';
import { FAMILY_OF, FAMILY_STYLE, nodeSize } from './nodeStyle';
import { graphBounds } from './flowLayout';

export const MINIMAP_W = 160;
export const MINIMAP_H = 100;
const PAD = 6;

export interface MinimapProps {
    graph: FlowGraph;
    positions: Positions;
    pan: Pos;
    zoom: number;
    /** Visible canvas size in pixels. */
    width: number;
    height: number;
    /** Called with the pan that centres the clicked point. */
    onPan: (pan: Pos) => void;
    compact?: boolean;
}

/** True when the graph, at this zoom, does not fit the visible canvas. */
export function exceedsView(graph: FlowGraph, positions: Positions, zoom: number, width: number, height: number, compact = false): boolean {
    if (!width || !height) {
        return false;
    }
    const b = graphBounds(graph, positions, compact);
    return b.width * zoom > width || b.height * zoom > height;
}

export default function Minimap({ graph, positions, pan, zoom, width, height, onPan, compact = false }: MinimapProps) {
    const theme = useSplunkTheme() as unknown as Theme;
    const b = graphBounds(graph, positions, compact);
    const view = { x: -pan.x / zoom, y: -pan.y / zoom, w: width / zoom, h: height / zoom };
    // The map covers the graph and the view, so the outline is always on it.
    const minX = Math.min(b.x, view.x);
    const minY = Math.min(b.y, view.y);
    const maxX = Math.max(b.x + b.width, view.x + view.w);
    const maxY = Math.max(b.y + b.height, view.y + view.h);
    const scale = Math.min((MINIMAP_W - 2 * PAD) / Math.max(1, maxX - minX), (MINIMAP_H - 2 * PAD) / Math.max(1, maxY - minY));
    const ox = (MINIMAP_W - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (MINIMAP_H - (maxY - minY) * scale) / 2 - minY * scale;

    // While dragging, the map keeps the scale it had when the drag began: it is fitted around
    // the view too, so refitting it under the pointer would make the view jump. Grabbing the view
    // outline keeps the point grabbed under the pointer (no jump); pressing elsewhere centres the
    // view there first. Moves are applied once per animation frame, so a fast drag stays smooth.
    const drag = useRef<{ id: number; scale: number; ox: number; oy: number; dx: number; dy: number } | null>(null);
    const frame = useRef<number | null>(null);
    const pending = useRef<{ x: number; y: number } | null>(null);
    const panTo = (mx: number, my: number) => {
        const d = drag.current;
        if (!d) {
            return;
        }
        const wx = (mx - d.dx - d.ox) / d.scale;
        const wy = (my - d.dy - d.oy) / d.scale;
        onPan({ x: width / 2 - wx * zoom, y: height / 2 - wy * zoom });
    };
    const flush = () => {
        frame.current = null;
        if (pending.current) {
            const p = pending.current;
            pending.current = null;
            panTo(p.x, p.y);
        }
    };
    useEffect(
        () => () => {
            if (frame.current !== null) {
                window.cancelAnimationFrame(frame.current);
            }
        },
        []
    );
    const local = (ev: React.PointerEvent<SVGSVGElement>) => {
        const rect = ev.currentTarget.getBoundingClientRect();
        return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    };
    const down = (ev: React.PointerEvent<SVGSVGElement>) => {
        ev.stopPropagation();
        if (ev.button !== 0) {
            return;
        }
        const p = local(ev);
        const box = { x: ox + view.x * scale, y: oy + view.y * scale, w: view.w * scale, h: view.h * scale };
        const inside = p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
        // The grab point's offset from the outline's centre, kept while dragging.
        const dx = inside ? p.x - (box.x + box.w / 2) : 0;
        const dy = inside ? p.y - (box.y + box.h / 2) : 0;
        drag.current = { id: ev.pointerId, scale, ox, oy, dx, dy };
        try {
            ev.currentTarget.setPointerCapture(ev.pointerId);
        } catch (err) {
            // Not supported (tests): moves still arrive while the pointer is over the map.
        }
        if (!inside) {
            panTo(p.x, p.y);
        }
    };
    const move = (ev: React.PointerEvent<SVGSVGElement>) => {
        if (!drag.current || drag.current.id !== ev.pointerId) {
            return;
        }
        pending.current = local(ev);
        if (frame.current === null) {
            frame.current = window.requestAnimationFrame(flush);
        }
    };
    const up = (ev: React.PointerEvent<SVGSVGElement>) => {
        if (drag.current && drag.current.id === ev.pointerId) {
            if (frame.current !== null) {
                window.cancelAnimationFrame(frame.current);
                frame.current = null;
            }
            flush();
            drag.current = null;
        }
    };

    return (
        <svg
            data-testid="minimap"
            aria-hidden="true"
            width={MINIMAP_W}
            height={MINIMAP_H}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            style={{
                position: 'absolute',
                right: 8,
                bottom: 8,
                background: theme.backgroundColorSection,
                border: `1px solid ${theme.borderColor}`,
                borderRadius: '4px',
                cursor: drag.current ? 'grabbing' : 'grab',
                touchAction: 'none',
            }}
        >
            {graph.nodes.map((n) => {
                const p = positions[n.key];
                if (!p) {
                    return null;
                }
                const { w, h } = nodeSize(n.kind, compact);
                return (
                    <rect
                        key={n.key}
                        data-node={n.key}
                        x={ox + p.x * scale}
                        y={oy + p.y * scale}
                        width={Math.max(2, w * scale)}
                        height={Math.max(2, h * scale)}
                        fill={theme[FAMILY_STYLE[FAMILY_OF[n.kind]].colorToken]}
                    />
                );
            })}
            <rect
                data-viewport="true"
                x={ox + view.x * scale}
                y={oy + view.y * scale}
                width={view.w * scale}
                height={view.h * scale}
                fill="none"
                stroke={theme.focusColor}
                strokeWidth={1.5}
            />
        </svg>
    );
}
