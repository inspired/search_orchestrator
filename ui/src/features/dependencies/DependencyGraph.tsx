/* The Dependencies graph: every connected job as a Whole job node, left to right with the
 * editor's dagre options, and a line for each way one job starts another. Click or Enter
 * selects a node and dims everything not upstream or downstream of it; double-click opens the
 * job. Pan by dragging the background or with the arrow keys; zoom with the wheel or the
 * buttons, as in the run graph. Jobs with no lines are left to the caller ("Not connected"). */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as dagre from '@dagrejs/dagre';
import Button from '@splunk/react-ui/Button';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import StatusText, { isRunDelayed } from '../../components/StatusText';
import { formatAgo } from '../../format';
import { ArrowMarker, NodeGroup, Theme } from '../builder/GraphView';
import { DAGRE_LR } from '../builder/flowLayout';
import { bezierAt, clampZoom, linkPath } from '../builder/flowCanvasGeometry';
import { FAMILY_STYLE, shapePath } from '../builder/nodeStyle';
import { wheelZoomFactor } from '../builder/useCanvasGestures';
import type { Pos } from '../builder/graphLogic';
import type { JobGraph, JobGraphNode } from './jobGraph';
import { related } from './jobGraph';

export const NODE_W = 230;
export const NODE_H = 92;
const DIM = 0.35;
const PAN_STEP = 40;
const HEIGHT = 480;

export interface DependencyGraphProps {
    graph: JobGraph;
    selected: string | null;
    onSelect: (id: string) => void;
    onOpen: (id: string) => void;
    /** Epoch seconds, for "5 minutes ago". */
    now: number;
}

function layout(graph: JobGraph, ids: Set<string>): Record<string, Pos> {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ ...DAGRE_LR });
    g.setDefaultEdgeLabel(() => ({}));
    graph.nodes.filter((n) => ids.has(n.id)).forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
    graph.edges.forEach((e) => {
        if (e.from !== e.to) {
            g.setEdge(e.from, e.to);
        }
    });
    dagre.layout(g);
    const out: Record<string, Pos> = {};
    ids.forEach((id) => {
        const d = g.node(id);
        out[id] = { x: Math.round(d.x - NODE_W / 2), y: Math.round(d.y - NODE_H / 2) };
    });
    return out;
}

function lastRunWhen(n: JobGraphNode): number | null {
    const r = n.lastRun;
    return r ? r.started_at || r.scheduled_time : null;
}

/** The words a screen reader hears for a node. */
function nodeWords(n: JobGraphNode, now: number): string {
    if (n.hidden) {
        return n.name;
    }
    const parts = [`Job ${n.name}`];
    if (n.owner) {
        parts.push(`owner ${n.owner}`);
    }
    if (!n.enabled) {
        parts.push('turned off');
    }
    const when = lastRunWhen(n);
    parts.push(n.lastRun && when ? `last run ${n.lastRun.state} ${formatAgo(now - when)}` : 'never run');
    return parts.join(', ');
}

function NodeBody({ node, theme, now }: { node: JobGraphNode; theme: Theme; now: number }) {
    const muted = { color: theme.contentColorMuted, fontSize: '12px' };
    const when = lastRunWhen(node);
    return (
        <div
            style={{
                padding: '8px 12px',
                fontFamily: theme.fontFamily,
                color: theme.contentColorDefault,
                fontSize: '12px',
                lineHeight: '18px',
                overflow: 'hidden',
            }}
        >
            <div style={{ fontWeight: Number(theme.fontWeightSemiBold) || 600, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {node.name}
            </div>
            {!node.hidden && (
                <>
                    <div style={{ ...muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span>{node.owner}</span>
                        {!node.enabled && (
                            <>
                                {node.owner ? ' · ' : ''}
                                <span>Turned off</span>
                            </>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', whiteSpace: 'nowrap' }}>
                        {node.lastRun ? (
                            <>
                                <StatusText state={node.lastRun.state} delayed={isRunDelayed(node.lastRun)} />
                                {when && <span style={muted}>{formatAgo(now - when)}</span>}
                            </>
                        ) : (
                            <span style={muted}>Never run</span>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

export default function DependencyGraph({ graph, selected, onSelect, onOpen, now }: DependencyGraphProps) {
    const theme = useSplunkTheme() as unknown as Theme;
    const uid = useId().replace(/:/g, '');
    const svgRef = useRef<SVGSVGElement>(null);
    const [pan, setPan] = useState<Pos>({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const drag = useRef<{ x: number; y: number; origin: Pos } | null>(null);

    const shownIds = useMemo(() => {
        const loose = new Set(graph.unconnected);
        return new Set(graph.nodes.filter((n) => !loose.has(n.id)).map((n) => n.id));
    }, [graph]);
    const pos = useMemo(() => layout(graph, shownIds), [graph, shownIds]);
    const lit = useMemo(() => {
        if (!selected || !shownIds.has(selected)) {
            return null;
        }
        const { upstream, downstream } = related(graph, selected);
        return new Set([selected, ...upstream, ...downstream]);
    }, [graph, selected, shownIds]);
    const opacity = (...ids: string[]) => (!lit || ids.every((id) => lit.has(id)) ? 1 : DIM);

    // Wheel zoom needs a non-passive listener so the page does not scroll as well.
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) {
            return undefined;
        }
        const onWheel = (ev: WheelEvent) => {
            ev.preventDefault();
            const factor = wheelZoomFactor(ev.deltaY, ev.deltaMode, svg.clientHeight || HEIGHT);
            setZoom((z) => clampZoom(z * factor));
        };
        svg.addEventListener('wheel', onWheel, { passive: false });
        return () => svg.removeEventListener('wheel', onWheel);
    }, []);

    const onPointerDown = (ev: React.PointerEvent<SVGSVGElement>) => {
        const target = ev.target as Element;
        if (ev.button !== 0 || (target.closest && target.closest('[data-job-node]'))) {
            return;
        }
        try {
            ev.currentTarget.setPointerCapture(ev.pointerId);
        } catch (err) {
            // capture is a nicety; panning still works inside the canvas
        }
        drag.current = { x: ev.clientX, y: ev.clientY, origin: pan };
    };
    const onPointerMove = (ev: React.PointerEvent<SVGSVGElement>) => {
        const d = drag.current;
        if (d) {
            setPan({ x: d.origin.x + ev.clientX - d.x, y: d.origin.y + ev.clientY - d.y });
        }
    };
    const endDrag = () => {
        drag.current = null;
    };
    const onKeyDown = (ev: React.KeyboardEvent) => {
        const step: Record<string, Pos> = {
            ArrowLeft: { x: PAN_STEP, y: 0 },
            ArrowRight: { x: -PAN_STEP, y: 0 },
            ArrowUp: { x: 0, y: PAN_STEP },
            ArrowDown: { x: 0, y: -PAN_STEP },
        };
        const s = step[ev.key];
        if (s) {
            ev.preventDefault();
            setPan((p) => ({ x: p.x + s.x, y: p.y + s.y }));
        }
    };

    const outline = theme[FAMILY_STYLE.job.colorToken];
    return (
        <div>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                <Button appearance="subtle" label="Zoom in" onClick={() => setZoom((z) => clampZoom(z * 1.2))} />
                <Button appearance="subtle" label="Zoom out" onClick={() => setZoom((z) => clampZoom(z / 1.2))} />
                <Button
                    appearance="subtle"
                    label="Reset view"
                    onClick={() => {
                        setZoom(1);
                        setPan({ x: 0, y: 0 });
                    }}
                />
            </div>
            <svg
                ref={svgRef}
                role="group"
                aria-label="Jobs and how they start each other. Tab to a job and press Enter to select it; arrow keys pan the view."
                width="100%"
                height={HEIGHT}
                style={{
                    display: 'block',
                    background: theme.backgroundColorPage,
                    border: `1px solid ${theme.borderColor}`,
                    borderRadius: '4px',
                    touchAction: 'none',
                    cursor: 'grab',
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={onKeyDown}
            >
                <ArrowMarker id={`dep-arrow-${uid}`} theme={theme} />
                <g data-view="true" transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                    {graph.edges.map((e) => {
                        const pa = pos[e.from];
                        const pb = pos[e.to];
                        if (!pa || !pb) {
                            return null;
                        }
                        const a = { x: pa.x + NODE_W, y: pa.y + NODE_H / 2 };
                        const b = { x: pb.x, y: pb.y + NODE_H / 2 };
                        const mid = bezierAt(a, b, 0.5);
                        return (
                            <g key={`${e.from}>${e.to}`} opacity={opacity(e.from, e.to)} data-edge={`${e.from}>${e.to}`}>
                                <title>{e.label}</title>
                                <path d={linkPath(a, b)} fill="none" stroke={theme.borderColorStrong} strokeWidth={1.5} markerEnd={`url(#dep-arrow-${uid})`} />
                                <text x={mid.x} y={mid.y - 6} textAnchor="middle" fontSize={11} fill={theme.contentColorMuted} fontFamily={theme.fontFamily}>
                                    {e.label}
                                </text>
                            </g>
                        );
                    })}
                    {graph.nodes
                        .filter((n) => shownIds.has(n.id))
                        .map((n) => {
                            const p = pos[n.id];
                            const isSelected = selected === n.id;
                            return (
                                <NodeGroup
                                    key={n.id}
                                    data-job-node={n.id}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={nodeWords(n, now)}
                                    aria-pressed={isSelected}
                                    opacity={opacity(n.id)}
                                    transform={`translate(${p.x},${p.y})`}
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => onSelect(n.id)}
                                    onDoubleClick={() => !n.hidden && onOpen(n.id)}
                                    onKeyDown={(ev: React.KeyboardEvent) => {
                                        if (ev.key === 'Enter' || ev.key === ' ') {
                                            ev.preventDefault();
                                            onSelect(n.id);
                                        }
                                    }}
                                >
                                    <path
                                        d={shapePath(FAMILY_STYLE.job.shape, NODE_W, NODE_H)}
                                        fill={theme.backgroundColorSection}
                                        stroke={isSelected ? theme.focusColor : outline}
                                        strokeWidth={isSelected ? 2.5 : 1.5}
                                    />
                                    <path
                                        d={shapePath('rounded', NODE_W - 8, NODE_H - 8)}
                                        transform="translate(4,4)"
                                        fill="none"
                                        stroke={isSelected ? theme.focusColor : theme.borderColorStrong}
                                        strokeWidth={1}
                                    />
                                    <foreignObject x={4} y={4} width={NODE_W - 8} height={NODE_H - 8}>
                                        <NodeBody node={n} theme={theme} now={now} />
                                    </foreignObject>
                                </NodeGroup>
                            );
                        })}
                </g>
            </svg>
        </div>
    );
}
