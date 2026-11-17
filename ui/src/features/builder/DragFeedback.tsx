/* What the flow canvas draws while something is dragged, in canvas coordinates: the dashed line
 * from a node's + (or an outcome tab) to the pointer, and the Shift+drag selection box. */
import React from 'react';
import type { Pos } from './graphLogic';
import type { Theme } from './GraphView';
import type { FlowNode, PortId } from './nodeModel';
import { handleOffset, tabOffset } from './nodeStyle';
import { linkPath } from './flowCanvasGeometry';

export interface DraftLineProps {
    node?: FlowNode;
    /** The node's top-left. */
    at?: Pos;
    /** Outcomes in use on the node, nearest the + first; the line leaves `outcome`'s tab. */
    tabs: PortId[];
    outcome?: PortId;
    to: Pos;
    theme: Theme;
}

export function DraftLine({ node, at, tabs, outcome, to, theme }: DraftLineProps) {
    if (!node || !at) {
        return null;
    }
    const i = outcome ? tabs.indexOf(outcome) : -1;
    const o = i >= 0 ? tabOffset(node.kind, i, tabs.length) : handleOffset(node.kind);
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
