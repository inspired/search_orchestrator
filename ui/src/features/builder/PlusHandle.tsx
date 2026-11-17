/* The + handle on the right edge of a node with outcomes, and the compact outcome tabs (a glyph in a coloured ring) stacked above it.
 * Click the + to choose "when" from a list; drag it, or a tab, to draw a line. Neither is a Tab
 * stop: the keyboard reaches the + through its node (+ or Shift+Enter). Theme tokens only. */
import React, { useState } from 'react';
import type { Theme } from './GraphView';
import type { NodeKind, PortId } from './nodeModel';
import { OUTCOME_LABEL, Outcome } from './outcomes';
import { HANDLE_R, PORT_STYLE, TAB_D, handleOffset, tabOffset } from './nodeStyle';

/** "Succeeds", "Fails"; an If line's tab reads "If". The tab itself shows only the glyph. */
export function tabWord(outcome: PortId): string {
    return outcome === 'if' ? 'If' : outcome === 'then' ? PORT_STYLE.then.label : OUTCOME_LABEL[outcome as Outcome];
}

/** A tab's box relative to the node's top-left: an 18 px circle just outside the right edge, at `tabOffset`. */
export function tabBox(kind: NodeKind, index: number, count: number, _outcome?: PortId, compact = false): { x: number; y: number; w: number; h: number } {
    const o = tabOffset(kind, index, count, compact);
    return { x: o.x + 2, y: o.y - TAB_D / 2, w: TAB_D, h: TAB_D };
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
    /** Compact nodes: the handle and tabs sit on the smaller node. */
    compact?: boolean;
    /** Put before the test ids, for a drawn-only copy (the compact overlay layer). */
    testIdPrefix?: string;
}

export default function PlusHandle({ nodeKey, kind, theme, tabs, plus, onPlusDown, onTabDown, compact = false, testIdPrefix = '' }: PlusHandleProps) {
    const [hover, setHover] = useState(false);
    const h = handleOffset(kind, compact);
    return (
        <>
            {tabs.map((outcome, i) => {
                const word = tabWord(outcome);
                const box = tabBox(kind, i, tabs.length, outcome, compact);
                const color = theme[PORT_STYLE[outcome].colorToken];
                return (
                    <g
                        key={outcome}
                        data-testid={`${testIdPrefix}tab-${nodeKey}-${outcome}`}
                        role="img"
                        aria-label={word}
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
                        <title>{word}</title>
                        <circle cx={box.x + TAB_D / 2} cy={box.y + TAB_D / 2} r={TAB_D / 2} fill={theme.backgroundColorSection} stroke={color} strokeWidth={1.5} />
                        <text
                            x={box.x + TAB_D / 2}
                            y={box.y + TAB_D / 2 + 4}
                            textAnchor="middle"
                            fontSize={11}
                            fill={theme.contentColorDefault}
                            fontFamily={theme.fontFamily}
                            pointerEvents="none"
                        >
                            {PORT_STYLE[outcome].glyph}
                        </text>
                    </g>
                );
            })}
            {plus && (
                <g
                    data-testid={`${testIdPrefix}plus-${nodeKey}`}
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
