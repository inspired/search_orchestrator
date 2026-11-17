/* Keeps the selected node in view, for example a node just added outside the visible area: pans
 * the canvas by the least that brings it (and its note line) within 20 px of the edges. */
import React, { useEffect } from 'react';
import type { Pos, Positions } from './graphLogic';
import type { FlowNode } from './nodeModel';
import { nodeSize } from './nodeStyle';

const MARGIN = 20;

/** How far to move a span [start, end] so it sits within 20 px of a view of `size` (0 when it does). */
export function shift(start: number, end: number, size: number): number {
    if (start < MARGIN) {
        return MARGIN - start;
    }
    return end > size - MARGIN ? Math.max(MARGIN - start, size - MARGIN - end) : 0;
}

export default function useRevealNode(
    svgRef: React.RefObject<SVGSVGElement | null>,
    node: FlowNode | undefined,
    positions: Positions,
    view: React.MutableRefObject<{ pan: Pos; zoom: number }>,
    setPan: (p: Pos) => void,
    compact = false
) {
    useEffect(() => {
        const svg = svgRef.current;
        const p = node ? positions[node.key] : undefined;
        if (!svg || !node || !p || !svg.clientWidth || !svg.clientHeight) {
            return;
        }
        const { w, h } = nodeSize(node.kind, compact);
        const { pan: at, zoom: z } = view.current;
        const dx = shift(p.x * z + at.x, (p.x + w) * z + at.x, svg.clientWidth);
        const dy = shift(p.y * z + at.y, (p.y + h + 20) * z + at.y, svg.clientHeight);
        if (dx || dy) {
            setPan({ x: at.x + dx, y: at.y + dy });
        }
    }, [node, positions]);
}
