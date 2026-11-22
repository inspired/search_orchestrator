/* The flow canvas's lines and their midpoint labels. On the run page each line can carry a run
 * state (`lineStates`): fired lines are solid in their outcome's colour at 2 px (data lines keep
 * their 3 px), flowing lines
 * (into a running step) are 3 px focusColor dashes that move toward the target (class `so-flow`,
 * left out with reduced motion), lines that will not fire are thin, dashed and faded with their arrowhead, and pending
 * lines are drawn as in the builder. `lineLabels` (row counts) replace a line's outcome label.
 * LiveStyles holds the keyframes for so-flow, so-spin and so-pulse, with one
 * `prefers-reduced-motion: reduce` block that stops them all. Theme tokens only. */
import React from 'react';
import type { Theme } from './GraphView';
import type { Pos } from './graphLogic';
import type { FlowGraph, FlowLink, FlowNode, PortId } from './nodeModel';
import { PORT_STYLE } from './nodeStyle';
import { flowLinkLabel } from './outcomes';
import LineLabel from './LineLabel';

export type LineState = 'fired' | 'flowing' | 'wont' | 'pending';

/** Below this zoom, line labels show only on the selected line. */
export const LABEL_ZOOM = 0.7;
export const TRIGGER_TOKEN = 'categoricalA1Strong';
export const MARKER_TOKENS = Array.from(new Set([...Object.values(PORT_STYLE).map((p) => p.colorToken), TRIGGER_TOKEN, 'focusColor']));

export interface LinkGeometry {
    l: FlowLink;
    from: FlowNode;
    to: FlowNode;
    d: string;
    mid: Pos;
}

const LIVE_CSS = `
@keyframes so-flow-dash { to { stroke-dashoffset: -28; } }
.so-flow { animation: so-flow-dash 0.9s linear infinite; }
@keyframes so-spin-turn { to { transform: rotate(360deg); } }
.so-spin { transform-box: fill-box; transform-origin: center; animation: so-spin-turn 1s linear infinite; }
@keyframes so-pulse-fade { 0%, 100% { stroke-opacity: 1; } 50% { stroke-opacity: 0.4; } }
.so-pulse { animation: so-pulse-fade 1.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .so-flow, .so-spin, .so-pulse { animation: none; } }
`;

export function LiveStyles() {
    return <style>{LIVE_CSS}</style>;
}

interface Look {
    token: string;
    width: number;
    dash?: string;
    opacity?: number;
    flow?: boolean;
}

export interface FlowLinesProps {
    lines: LinkGeometry[];
    graph: FlowGraph;
    theme: Theme;
    zoom: number;
    spliceLink: string | null;
    isSelected: (l: FlowLink) => boolean;
    markerUrl: (token: string) => string;
    onPick: (geo: LinkGeometry) => void;
    lineStates?: Record<string, LineState>;
    lineLabels?: Record<string, string>;
    /** Draw every line's label (the toolbar toggle); otherwise only the selected line's, and on the run page row counts on flowing lines. */
    showLabels?: boolean;
    /** Animate flowing lines (false with reduced motion). */
    motion: boolean;
}

export function FlowLines({ lines, graph, theme, zoom, spliceLink, isSelected, markerUrl, onPick, lineStates, lineLabels, showLabels = false, motion }: FlowLinesProps) {
    const lookOf = (l: FlowLink): Look => {
        const trigger = l.kind === 'trigger' || !l.port;
        const isSel = isSelected(l);
        const into = spliceLink === l.key;
        const token = isSel || into ? 'focusColor' : trigger ? TRIGGER_TOKEN : PORT_STYLE[l.port as PortId].colorToken;
        const state = (lineStates && lineStates[l.key]) || 'pending';
        const extra = isSel ? 1 : 0;
        if (state === 'flowing') {
            return { token: 'focusColor', width: 3 + extra, dash: '8 6', flow: motion };
        }
        if (state === 'fired') {
            return { token, width: (l.data ? 3 : 2) + extra };
        }
        if (state === 'wont') {
            return { token, width: 1.5 + extra, dash: '4 4', opacity: 0.35 };
        }
        return { token, width: into ? 3 : (l.data ? 3 : 1.5) + extra, dash: trigger ? '5 4' : undefined };
    };
    return (
        <>
            {lines.map((geo) => {
                const { l, d } = geo;
                const trigger = l.kind === 'trigger' || !l.port;
                const look = lookOf(l);
                return (
                    <g
                        key={l.key}
                        data-testid={`link-${l.key}`}
                        data-link-hit={l.key}
                        data-line-state={lineStates ? lineStates[l.key] || 'pending' : undefined}
                        onPointerDown={(ev) => ev.stopPropagation()}
                        onClick={() => onPick(geo)}
                        style={{ cursor: 'pointer' }}
                    >
                        <path
                            d={d}
                            fill="none"
                            stroke={theme[look.token]}
                            strokeWidth={look.width}
                            strokeDasharray={look.dash}
                            opacity={look.opacity}
                            className={look.flow ? 'so-flow' : undefined}
                            markerEnd={markerUrl(look.token)}
                        />
                        <path d={d} fill="none" stroke={theme[look.token]} strokeOpacity={0} strokeWidth={12} pointerEvents="stroke" />
                    </g>
                );
            })}
            {lines.map((geo) => {
                const { l, mid } = geo;
                const text = (lineLabels && lineLabels[l.key]) || flowLinkLabel(graph, l);
                const isSel = isSelected(l);
                // A given label shows always (the Standard view's conditions), or while its line is flowing
                // when the canvas follows a run (lineStates).
                const wanted = isSel || showLabels || (!!(lineLabels && lineLabels[l.key]) && (!lineStates || lineStates[l.key] === 'flowing'));
                if (!text || !wanted || (zoom < LABEL_ZOOM && !isSel)) {
                    return null;
                }
                const look = lookOf(l);
                const token = isSel || spliceLink === l.key ? 'focusColor' : look.token === 'focusColor' ? 'focusColor' : l.port ? PORT_STYLE[l.port as PortId].colorToken : TRIGGER_TOKEN;
                return (
                    <g key={l.key} opacity={look.opacity}>
                        <LineLabel linkKey={l.key} text={text} at={mid} theme={theme} colorToken={token} onPick={() => onPick(geo)} />
                    </g>
                );
            })}
        </>
    );
}
