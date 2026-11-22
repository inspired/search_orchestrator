/* What a running step adds on the run page: a focusColor outline that pulses gently (class
 * `so-pulse`), a small spinner (`so-spin`) and its client-ticked timer ("0:31") in the node's
 * top-right corner (above a compact node). With reduced motion there is no pulse and no spinner;
 * the outline colour and the timer stay. Drawn inside the node's group, taking no pointer events. */
import React from 'react';
import type { Theme } from './GraphView';
import type { FlowNode } from './nodeModel';
import { FAMILY_OF, FAMILY_STYLE, nodeSize, shapePath } from './nodeStyle';

export interface RunningMarkProps {
    node: FlowNode;
    theme: Theme;
    compact: boolean;
    motion: boolean;
    timer?: string;
    /** Prefix for the test ids (the compact overlay's copy). */
    testIdPrefix?: string;
}

export default function RunningMark({ node, theme, compact, motion, timer, testIdPrefix = '' }: RunningMarkProps) {
    const { shape } = FAMILY_STYLE[FAMILY_OF[node.kind]];
    const { w, h } = nodeSize(node.kind, compact);
    // Inside the top-right corner of a full node; just above a compact one, whose name fills it.
    const cy = compact ? -10 : 13;
    return (
        <g pointerEvents="none" aria-hidden>
            <path data-testid={`${testIdPrefix}running-outline-${node.key}`} d={shapePath(shape, w, h)} fill="none" stroke={theme.focusColor} strokeWidth={2.5} className={motion ? 'so-pulse' : undefined} />
            {motion && (
                <g data-testid={`${testIdPrefix}spinner-${node.key}`} className="so-spin">
                    <circle cx={w - 13} cy={cy} r={5} fill="none" stroke={theme.focusColor} strokeWidth={2} strokeDasharray="22 10" strokeLinecap="round" />
                </g>
            )}
            {timer && (
                <text data-testid={`${testIdPrefix}timer-${node.key}`} x={motion ? w - 23 : w - 8} y={cy + 4} textAnchor="end" fontSize={11} fill={theme.contentColorDefault} fontFamily={theme.fontFamily} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {timer}
                </text>
            )}
        </g>
    );
}
