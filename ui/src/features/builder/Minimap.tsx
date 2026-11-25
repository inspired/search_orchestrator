/* A small map of the whole graph, bottom-right of the canvas: each node as a rect in its family
 * colour and the visible view as an outline. Click a point to centre the view there, or drag to
 * move the view with the pointer. Hidden from
 * screen readers; "Frame all" and the F key are the accessible equivalent. */
import React, { useRef } from 'react';
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
    // the view too, so refitting it under the pointer would make the view jump.
    const drag = useRef<{ id: number; scale: number; ox: number; oy: number } | null>(null);
    const centreAt = (ev: React.PointerEvent<SVGSVGElement>, fit: { scale: number; ox: number; oy: number }) => {
        const rect = ev.currentTarget.getBoundingClientRect();
        const wx = (ev.clientX - rect.left - fit.ox) / fit.scale;
        const wy = (ev.clientY - rect.top - fit.oy) / fit.scale;
        onPan({ x: width / 2 - wx * zoom, y: height / 2 - wy * zoom });
    };
    const down = (ev: React.PointerEvent<SVGSVGElement>) => {
        ev.stopPropagation();
        if (ev.button !== 0) {
            return;
        }
        drag.current = { id: ev.pointerId, scale, ox, oy };
        try {
            ev.currentTarget.setPointerCapture(ev.pointerId);
        } catch (err) {
            // Not supported (tests): moves still arrive while the pointer is over the map.
        }
        centreAt(ev, drag.current);
    };
    const move = (ev: React.PointerEvent<SVGSVGElement>) => {
        if (drag.current && drag.current.id === ev.pointerId) {
            centreAt(ev, drag.current);
        }
    };
    const up = (ev: React.PointerEvent<SVGSVGElement>) => {
        if (drag.current && drag.current.id === ev.pointerId) {
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
                cursor: 'grab',
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
