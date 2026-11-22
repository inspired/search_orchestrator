/* Follow the run: while `follow` is on, every time the running steps or the positions change (each
 * poll), pan by the least that brings the running nodes' bounding box (with their note lines)
 * into view, keeping the zoom. Nothing moves during a drag; the caller turns `follow` off when
 * the user pans or zooms (onUserView), so a poll never fights the user. */
import React, { useEffect } from 'react';
import type { Pos, Positions } from './graphLogic';
import type { FlowNode } from './nodeModel';
import { nodeSize } from './nodeStyle';
import { shift } from './useRevealNode';

export default function useFollowRun(
    svgRef: React.RefObject<SVGSVGElement | null>,
    follow: boolean,
    running: string[] | undefined,
    byKey: Map<string, FlowNode>,
    positions: Positions,
    view: React.MutableRefObject<{ pan: Pos; zoom: number }>,
    setPan: (p: Pos) => void,
    compact: boolean,
    busy: boolean
) {
    const keys = (running || []).join('|');
    useEffect(() => {
        const svg = svgRef.current;
        const boxes = (running || []).flatMap((k) => {
            const n = byKey.get(k);
            const p = positions[k];
            return n && p ? [{ ...p, ...nodeSize(n.kind, compact) }] : [];
        });
        if (!follow || busy || !boxes.length || !svg || !svg.clientWidth || !svg.clientHeight) {
            return;
        }
        const { pan: at, zoom: z } = view.current;
        const x0 = Math.min(...boxes.map((b) => b.x));
        const y0 = Math.min(...boxes.map((b) => b.y));
        const x1 = Math.max(...boxes.map((b) => b.x + b.w));
        const y1 = Math.max(...boxes.map((b) => b.y + b.h + 20));
        const dx = shift(x0 * z + at.x, x1 * z + at.x, svg.clientWidth);
        const dy = shift(y0 * z + at.y, y1 * z + at.y, svg.clientHeight);
        if (dx || dy) {
            setPan({ x: at.x + dx, y: at.y + dy });
        }
    }, [follow, keys, positions, busy, compact]);
}
