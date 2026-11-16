/* The + handle on the right edge of a node with outcomes, and the outcome tabs stacked above it.
 * Click the + to choose "when" from a list; drag it, or a tab, to draw a line. Neither is a Tab
 * stop: the keyboard reaches the + through its node (+ or Shift+Enter). Theme tokens only. */
import React, { useState } from 'react';
import type { Theme } from './GraphView';
import type { NodeKind, PortId } from './nodeModel';
import { OUTCOME_LABEL, Outcome } from './outcomes';
import { HANDLE_R, PORT_STYLE, handleOffset, tabOffset } from './nodeStyle';

const TAB_H = 18;
const TAB_PAD = 7;
const CHAR_W = 6.2;

/** "✓ Succeeds", "✗ Fails"; an If line's tab reads "◇ If". */
export function tabLabel(outcome: PortId): string {
    const { glyph } = PORT_STYLE[outcome];
    if (outcome === 'if') {
        return `${glyph} If`;
    }
    return outcome === 'then' ? `${glyph} ${PORT_STYLE.then.label}` : `${glyph} ${OUTCOME_LABEL[outcome as Outcome]}`;
}

/** A tab's box relative to the node's top-left: just outside the right edge, at `tabOffset`. */
export function tabBox(kind: NodeKind, index: number, count: number, outcome: PortId): { x: number; y: number; w: number; h: number } {
    const o = tabOffset(kind, index, count);
    return { x: o.x + 2, y: o.y - TAB_H / 2, w: Math.round(tabLabel(outcome).length * CHAR_W + 2 * TAB_PAD), h: TAB_H };
}

export interface PlusHandleProps {
    nodeKey: string;
    kind: NodeKind;
    theme: Theme;
    /** Outcomes in use, nearest the + first (see `usedOutcomes`). Conditions pass none. */
    tabs: readonly PortId[];
    /** Draw the + (not on the run page). */
    plus: boolean;
    onPlusDown?: (ev: React.PointerEvent) => void;
    onTabDown?: (ev: React.PointerEvent, outcome: PortId) => void;
}

export default function PlusHandle({ nodeKey, kind, theme, tabs, plus, onPlusDown, onTabDown }: PlusHandleProps) {
    const [hover, setHover] = useState(false);
    const h = handleOffset(kind);
    return (
        <>
            {tabs.map((outcome, i) => {
                const label = tabLabel(outcome);
                const box = tabBox(kind, i, tabs.length, outcome);
                const color = theme[PORT_STYLE[outcome].colorToken];
                return (
                    <g
                        key={outcome}
                        data-testid={`tab-${nodeKey}-${outcome}`}
                        aria-hidden
                        style={{ cursor: onTabDown ? 'crosshair' : undefined }}
                        onPointerDown={
                            onTabDown
                                ? (ev) => {
                                      ev.stopPropagation();
                                      onTabDown(ev, outcome);
                                  }
                                : undefined
                        }
                    >
                        <rect
                            x={box.x}
                            y={box.y}
                            width={box.w}
                            height={box.h}
                            rx={4}
                            fill={theme.backgroundColorSection}
                            stroke={color}
                            strokeWidth={1.5}
                        />
                        <text x={box.x + TAB_PAD} y={box.y + TAB_H / 2 + 4} fontSize={11} fill={theme.contentColorDefault} fontFamily={theme.fontFamily}>
                            {label}
                        </text>
                    </g>
                );
            })}
            {plus && (
                <g
                    data-testid={`plus-${nodeKey}`}
                    aria-hidden
                    style={{ cursor: 'crosshair' }}
                    onPointerEnter={() => setHover(true)}
                    onPointerLeave={() => setHover(false)}
                    onPointerDown={(ev) => {
                        ev.stopPropagation();
                        if (onPlusDown) {
                            onPlusDown(ev);
                        }
                    }}
                >
                    <title>Choose what happens next, or drag to a node</title>
                    {/* Shown on hover here, and on node focus by NodeGroup's :focus-visible rule. */}
                    <circle
                        data-plus-ring
                        cx={h.x}
                        cy={h.y}
                        r={HANDLE_R + 3}
                        fill="none"
                        stroke={theme.focusColor}
                        strokeOpacity={hover ? 1 : 0}
                        strokeWidth={2}
                    />
                    <circle cx={h.x} cy={h.y} r={HANDLE_R} fill={theme.backgroundColorSection} stroke={theme.borderColorStrong} strokeWidth={1.5} />
                    <path
                        d={`M${h.x - 6},${h.y} H${h.x + 6} M${h.x},${h.y - 6} V${h.y + 6}`}
                        stroke={theme.contentColorDefault}
                        strokeWidth={2}
                        strokeLinecap="round"
                    />
                </g>
            )}
        </>
    );
}
