/* What the flow canvas draws while something is dragged, in canvas coordinates: the dashed line
 * from a node's + (or an outcome tab) to the pointer, and the Shift+drag selection box. */
import React from 'react';
import type { Pos } from './graphLogic';
import type { Theme } from './GraphView';
import type { FlowNode, PortId } from './nodeModel';
import { handleOffset, tabExit } from './nodeStyle';
import { linkPath } from './flowCanvasGeometry';
import type { Guide } from './align';

export interface DraftLineProps {
    node?: FlowNode;
    /** The node's top-left. */
    at?: Pos;
    /** Outcomes in use on the node, nearest the + first; the line leaves `outcome`'s tab. */
    tabs: PortId[];
    outcome?: PortId;
    to: Pos;
    theme: Theme;
    compact?: boolean;
}

export function DraftLine({ node, at, tabs, outcome, to, theme, compact = false }: DraftLineProps) {
    if (!node || !at) {
        return null;
    }
    const i = outcome ? tabs.indexOf(outcome) : -1;
    const o = i >= 0 ? tabExit(node.kind, i, tabs.length, compact) : handleOffset(node.kind, compact);
    return (
        <path
            data-testid="link-draft"
            d={linkPath({ x: at.x + o.x, y: at.y + o.y }, to)}
            fill="none"
            stroke={theme.focusColor}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            pointerEvents="none"
        />
    );
}

export function SelectionBox({ from, to, theme }: { from: Pos; to: Pos; theme: Theme }) {
    return (
        <rect
            data-testid="selection-box"
            x={Math.min(from.x, to.x)}
            y={Math.min(from.y, to.y)}
            width={Math.abs(to.x - from.x)}
            height={Math.abs(to.y - from.y)}
            fill={theme.focusColor}
            fillOpacity={0.08}
            stroke={theme.focusColor}
            strokeWidth={1}
            strokeDasharray="4 3"
            pointerEvents="none"
        />
    );
}

/** The arrowheads lines end in, one per colour token, referenced as `url(#<uid>-arrow-<token>)`. */
export function ArrowMarkers({ uid, tokens, theme }: { uid: string; tokens: string[]; theme: Theme }) {
    return (
        <defs>
            {tokens.map((token) => (
                <marker key={token} id={`${uid}-arrow-${token}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill={theme[token]} />
                </marker>
            ))}
        </defs>
    );
}

/** Alignment guides while a node is dragged: 1 px dashed lines in the focus colour. */
export function GuideLines({ guides, theme }: { guides: Guide[]; theme: Theme }) {
    return (
        <g pointerEvents="none">
            {guides.map((gd, i) => (
                <line
                    key={`${gd.axis}-${gd.at}-${i}`}
                    data-testid={`guide-${gd.axis}`}
                    x1={gd.axis === 'x' ? gd.at : gd.from}
                    x2={gd.axis === 'x' ? gd.at : gd.to}
                    y1={gd.axis === 'x' ? gd.from : gd.at}
                    y2={gd.axis === 'x' ? gd.to : gd.at}
                    stroke={theme.focusColor}
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                />
            ))}
        </g>
    );
}

export const GRID_STEP = 20;

/** 20 px dots over the visible canvas, under the nodes; drawn in canvas units so they scale with zoom. */
export function GridDots({ uid, pan, zoom, width, height, theme }: { uid: string; pan: Pos; zoom: number; width: number; height: number; theme: Theme }) {
    const id = `${uid}-grid`;
    return (
        <g data-testid="flow-grid" pointerEvents="none">
            <defs>
                <pattern id={id} x={-GRID_STEP / 2} y={-GRID_STEP / 2} width={GRID_STEP} height={GRID_STEP} patternUnits="userSpaceOnUse">
                    <circle cx={GRID_STEP / 2} cy={GRID_STEP / 2} r={1} fill={theme.borderColor} fillOpacity={0.6} />
                </pattern>
            </defs>
            <rect x={-pan.x / zoom - GRID_STEP} y={-pan.y / zoom - GRID_STEP} width={width / zoom + 2 * GRID_STEP} height={height / zoom + 2 * GRID_STEP} fill={`url(#${id})`} />
        </g>
    );
}
