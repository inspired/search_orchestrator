/* The small label at a line's midpoint: the outcome's glyph and word ("✗ Fails"), or a
 * condition's expression. Clicking it (when `onPick` is given) selects the line and opens its
 * menu; the keyboard reaches the same menu through the line's focus target. Theme tokens only. */
import React from 'react';
import type { Theme } from './GraphView';
import type { Pos } from './graphLogic';

export const LABEL_H = 18;
const PAD = 6;
const CHAR_W = 6.2;

/** The label's box, centred on `at`. */
export function labelBox(text: string, at: Pos): { x: number; y: number; w: number; h: number } {
    const w = Math.round(text.length * CHAR_W + 2 * PAD);
    return { x: at.x - w / 2, y: at.y - LABEL_H / 2, w, h: LABEL_H };
}

export interface LineLabelProps {
    linkKey: string;
    text: string;
    at: Pos;
    theme: Theme;
    /** The line's colour token, for the label's outline. */
    colorToken: string;
    onPick?: () => void;
}

export default function LineLabel({ linkKey, text, at, theme, colorToken, onPick }: LineLabelProps) {
    const b = labelBox(text, at);
    return (
        <g
            data-testid={`line-label-${linkKey}`}
            data-link-hit={onPick ? linkKey : undefined}
            pointerEvents={onPick ? undefined : 'none'}
            onPointerDown={onPick ? (ev) => ev.stopPropagation() : undefined}
            onClick={onPick}
            style={{ cursor: onPick ? 'pointer' : undefined }}
        >
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} fill={theme.backgroundColorPage} stroke={theme[colorToken]} strokeWidth={1} />
            <text
                x={at.x}
                y={at.y + 4}
                textAnchor="middle"
                fontSize={11}
                fill={theme.contentColorDefault}
                fontFamily={theme.fontFamily}
            >
                {text}
            </text>
        </g>
    );
}
