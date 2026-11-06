/* The editable step graph: an SVG with pan (drag the background), zoom (wheel or buttons),
 * node drag, and new dependencies drawn from a node's output handle onto another node.
 * Keyboard: Tab through steps, Enter selects, Delete asks to remove. The side panel's
 * "Depends on" field connects steps without a pointer. Colours come from theme tokens. */
import React, { useEffect, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import CrossCircle from '@splunk/react-icons/CrossCircle';
import ExclamationTriangle from '@splunk/react-icons/ExclamationTriangle';
import type { Edge, Issue, StepDef } from '../../api/types';
import { issuesByStep, NODE_H, NODE_W, Pos, Positions, runWhenSummary } from './graphLogic';
import { ArrowMarker, EdgeLine, NodeBox, NodeGroup, stepLabel, Theme } from './GraphView';

export type Selection = { kind: 'step'; id: string } | { kind: 'edge'; from: string; to: string } | null;

export interface CanvasProps {
    steps: StepDef[];
    edges: Edge[];
    positions: Positions;
    selected: Selection;
    issues: Issue[];
    onSelect: (sel: Selection) => void;
    onMove: (id: string, x: number, y: number) => void;
    onConnect: (from: string, to: string) => void;
    onRequestRemove: (id: string) => void;
    /** A short preview note under each previewed step, such as "✓ 7 rows". */
    notes?: Record<string, { text: string; failed?: boolean } | null | undefined>;
}

type Gesture =
    | { kind: 'drag'; id: string; startX: number; startY: number; origin: Pos; moved: boolean }
    | { kind: 'link'; from: string }
    | { kind: 'pan'; startX: number; startY: number; origin: Pos; moved: boolean };

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function Canvas({
    steps,
    edges,
    positions,
    selected,
    issues,
    onSelect,
    onMove,
    onConnect,
    onRequestRemove,
    notes = {},
}: CanvasProps) {
    const theme = useSplunkTheme() as unknown as Theme;
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [pan, setPan] = useState<Pos>({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [gesture, setGesture] = useState<Gesture | null>(null);
    const [dragPos, setDragPos] = useState<Pos | null>(null);
    const [cursor, setCursor] = useState<Pos | null>(null);
    const view = useRef({ pan, zoom });
    view.current = { pan, zoom };

    // Wheel zoom needs a non-passive listener so the page does not scroll as well.
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) {
            return undefined;
        }
        const onWheel = (ev: WheelEvent) => {
            ev.preventDefault();
            setZoom((z) => clampZoom(z * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
        };
        svg.addEventListener('wheel', onWheel, { passive: false });
        return () => svg.removeEventListener('wheel', onWheel);
    }, []);

    const toCanvas = (clientX: number, clientY: number): Pos => {
        const rect = svgRef.current ? svgRef.current.getBoundingClientRect() : { left: 0, top: 0 };
        const { pan: p, zoom: z } = view.current;
        return { x: (clientX - rect.left - p.x) / z, y: (clientY - rect.top - p.y) / z };
    };

    const posOf = (id: string): Pos => (gesture && gesture.kind === 'drag' && gesture.id === id && dragPos) || positions[id];

    const nodeAt = (pt: Pos): string | null => {
        const hit = steps.find((s) => {
            const p = positions[s.id];
            return p && pt.x >= p.x && pt.x <= p.x + NODE_W && pt.y >= p.y && pt.y <= p.y + NODE_H;
        });
        return hit ? hit.id : null;
    };

    const capture = (ev: React.PointerEvent) => {
        if (svgRef.current && svgRef.current.setPointerCapture) {
            try {
                svgRef.current.setPointerCapture(ev.pointerId);
            } catch (err) {
                // capture is a nicety; dragging still works inside the canvas
            }
        }
    };

    const onPointerMove = (ev: React.PointerEvent) => {
        if (!gesture) {
            return;
        }
        if (gesture.kind === 'pan') {
            const dx = ev.clientX - gesture.startX;
            const dy = ev.clientY - gesture.startY;
            setPan({ x: gesture.origin.x + dx, y: gesture.origin.y + dy });
            if (!gesture.moved && Math.abs(dx) + Math.abs(dy) > 3) {
                setGesture({ ...gesture, moved: true });
            }
        } else if (gesture.kind === 'drag') {
            const dx = (ev.clientX - gesture.startX) / zoom;
            const dy = (ev.clientY - gesture.startY) / zoom;
            setDragPos({ x: Math.round(gesture.origin.x + dx), y: Math.round(gesture.origin.y + dy) });
            if (!gesture.moved && Math.abs(dx) + Math.abs(dy) > 3) {
                setGesture({ ...gesture, moved: true });
            }
        } else {
            setCursor(toCanvas(ev.clientX, ev.clientY));
        }
    };

    const onPointerUp = (ev: React.PointerEvent) => {
        if (gesture) {
            if (gesture.kind === 'drag') {
                if (gesture.moved && dragPos) {
                    onMove(gesture.id, dragPos.x, dragPos.y);
                } else {
                    onSelect({ kind: 'step', id: gesture.id });
                }
            } else if (gesture.kind === 'link') {
                const target = nodeAt(toCanvas(ev.clientX, ev.clientY));
                if (target && target !== gesture.from) {
                    onConnect(gesture.from, target);
                }
            } else if (!gesture.moved) {
                onSelect(null);
            }
        }
        setGesture(null);
        setDragPos(null);
        setCursor(null);
    };

    const byStep = issuesByStep(issues);
    const isSelectedEdge = (e: Edge) => selected !== null && selected.kind === 'edge' && selected.from === e.from && selected.to === e.to;
    const markerId = 'so-canvas-arrow';
    const linkFrom = gesture && gesture.kind === 'link' ? posOf(gesture.from) : null;

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
                data-canvas="true"
                tabIndex={-1}
                role="group"
                aria-label="Job steps. Tab to a step, Enter to select it, Delete to remove it."
                width="100%"
                height={480}
                style={{
                    display: 'block',
                    background: theme.backgroundColorPage,
                    border: `1px solid ${theme.borderColor}`,
                    borderRadius: '4px',
                    touchAction: 'none',
                    cursor: gesture && gesture.kind === 'pan' ? 'grabbing' : 'grab',
                }}
                onPointerDown={(ev) => {
                    capture(ev);
                    setGesture({ kind: 'pan', startX: ev.clientX, startY: ev.clientY, origin: pan, moved: false });
                }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                    setGesture(null);
                    setDragPos(null);
                    setCursor(null);
                }}
            >
                <ArrowMarker id={markerId} theme={theme} />
                <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                    {edges.map((e) => {
                        const a = positions[e.from] && posOf(e.from);
                        const b = positions[e.to] && posOf(e.to);
                        if (!a || !b) {
                            return null;
                        }
                        const from = steps.find((s) => s.id === e.from);
                        const to = steps.find((s) => s.id === e.to);
                        const select = () => onSelect({ kind: 'edge', from: e.from, to: e.to });
                        return (
                            <NodeGroup
                                key={`${e.from}>${e.to}`}
                                role="button"
                                tabIndex={0}
                                aria-label={`Dependency: ${from ? stepLabel(from) : e.from} to ${to ? stepLabel(to) : e.to}`}
                                aria-pressed={isSelectedEdge(e)}
                                onPointerDown={(ev) => ev.stopPropagation()}
                                onClick={select}
                                onKeyDown={(ev) => {
                                    if (ev.key === 'Enter' || ev.key === ' ') {
                                        ev.preventDefault();
                                        select();
                                    }
                                }}
                                style={{ cursor: 'pointer' }}
                            >
                                <EdgeLine edge={e} a={a} b={b} theme={theme} markerId={markerId} selected={isSelectedEdge(e)} />
                                <path
                                    d={`M${a.x + NODE_W / 2},${a.y + NODE_H} L${b.x + NODE_W / 2},${b.y}`}
                                    stroke={theme.borderColor}
                                    strokeOpacity={0}
                                    strokeWidth={12}
                                    pointerEvents="stroke"
                                />
                            </NodeGroup>
                        );
                    })}
                    {linkFrom && cursor && (
                        <line
                            x1={linkFrom.x + NODE_W / 2}
                            y1={linkFrom.y + NODE_H}
                            x2={cursor.x}
                            y2={cursor.y}
                            stroke={theme.focusColor}
                            strokeWidth={1.5}
                            strokeDasharray="4 3"
                        />
                    )}
                    {steps.map((s) => {
                        const p = posOf(s.id);
                        if (!p) {
                            return null;
                        }
                        const mine = byStep[s.id] || [];
                        const errors = mine.filter((i) => i.level === 'error').length;
                        const warnings = mine.length - errors;
                        let detail = runWhenSummary(s.run_when);
                        let color: string | undefined;
                        let icon;
                        if (errors) {
                            detail = plural(errors, 'error');
                            color = theme.statusColorHigh;
                            icon = CrossCircle;
                        } else if (warnings) {
                            detail = plural(warnings, 'warning');
                            color = theme.statusColorMedium;
                            icon = ExclamationTriangle;
                        }
                        const note = notes[s.id];
                        const label = [
                            `Step ${stepLabel(s)}`,
                            errors ? plural(errors, 'error') : '',
                            warnings ? plural(warnings, 'warning') : '',
                            note ? note.text : '',
                        ]
                            .filter(Boolean)
                            .join(', ');
                        const isSelected = selected !== null && selected.kind === 'step' && selected.id === s.id;
                        return (
                            <NodeGroup
                                key={s.id}
                                data-testid={`node-${s.id}`}
                                data-node-id={s.id}
                                transform={`translate(${p.x},${p.y})`}
                                role="button"
                                tabIndex={0}
                                aria-label={label}
                                aria-pressed={isSelected}
                                onPointerDown={(ev) => {
                                    ev.stopPropagation();
                                    capture(ev);
                                    setGesture({ kind: 'drag', id: s.id, startX: ev.clientX, startY: ev.clientY, origin: positions[s.id], moved: false });
                                }}
                                onKeyDown={(ev) => {
                                    if (ev.key === 'Enter' || ev.key === ' ') {
                                        ev.preventDefault();
                                        onSelect({ kind: 'step', id: s.id });
                                    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
                                        ev.preventDefault();
                                        onRequestRemove(s.id);
                                    }
                                }}
                                style={{ cursor: 'move' }}
                            >
                                <NodeBox step={s} theme={theme} detail={detail} detailColor={color} icon={icon} stroke={color} selected={isSelected} />
                                {note && (
                                    <text
                                        data-testid={`note-${s.id}`}
                                        x={0}
                                        y={NODE_H + 14}
                                        fontSize={11}
                                        fill={note.failed ? theme.statusColorHigh : theme.contentColorMuted}
                                        fontFamily={theme.fontFamily}
                                    >
                                        {note.text}
                                    </text>
                                )}
                                <circle
                                    data-testid={`handle-${s.id}`}
                                    aria-hidden
                                    cx={NODE_W / 2}
                                    cy={NODE_H}
                                    r={6}
                                    fill={theme.backgroundColorSection}
                                    stroke={theme.borderColorStrong}
                                    strokeWidth={1.5}
                                    style={{ cursor: 'crosshair' }}
                                    onPointerDown={(ev) => {
                                        ev.stopPropagation();
                                        capture(ev);
                                        setGesture({ kind: 'link', from: s.id });
                                        setCursor(toCanvas(ev.clientX, ev.clientY));
                                    }}
                                />
                            </NodeGroup>
                        );
                    })}
                </g>
            </svg>
        </div>
    );
}
