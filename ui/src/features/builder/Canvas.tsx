/* The editable step graph: an SVG with pan (drag the background) and zoom (wheel or
 * buttons). Steps are laid out automatically, top to bottom, from the steps and edges; they
 * can't be dragged. A line drawn from a step's output handle connects it to the step it is
 * dropped on, or, dropped on empty canvas, adds a new step reading from it.
 * Keyboard: Tab through steps, Enter selects, Delete asks to remove. The side panel's
 * "Depends on" field connects steps without a pointer. Colours come from theme tokens. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import CrossCircle from '@splunk/react-icons/CrossCircle';
import ExclamationTriangle from '@splunk/react-icons/ExclamationTriangle';
import type { Edge, Issue, StepDef } from '../../api/types';
import { autoLayout, issuesByStep, NODE_H, NODE_W, Pos, runWhenSummary } from './graphLogic';
import { ArrowMarker, EdgeLine, NodeBox, NodeGroup, stepLabel, Theme } from './GraphView';

export type Selection = { kind: 'step'; id: string } | { kind: 'edge'; from: string; to: string } | null;

export interface CanvasProps {
    steps: StepDef[];
    edges: Edge[];
    selected: Selection;
    issues: Issue[];
    onSelect: (sel: Selection) => void;
    onConnect: (from: string, to: string) => void;
    /** A line from `from` was dropped on empty canvas: add a step reading from it. */
    onAddFrom: (from: string) => void;
    onRequestRemove: (id: string) => void;
    /** A short preview note under each previewed step, such as "✓ 7 rows". */
    notes?: Record<string, { text: string; failed?: boolean } | null | undefined>;
}

type Gesture =
    | { kind: 'press'; id: string }
    | { kind: 'link'; from: string; start: Pos }
    | { kind: 'pan'; startX: number; startY: number; origin: Pos; moved: boolean };

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function Canvas({
    steps,
    edges,
    selected,
    issues,
    onSelect,
    onConnect,
    onAddFrom,
    onRequestRemove,
    notes = {},
}: CanvasProps) {
    const theme = useSplunkTheme() as unknown as Theme;
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [pan, setPan] = useState<Pos>({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [gesture, setGesture] = useState<Gesture | null>(null);
    const [cursor, setCursor] = useState<Pos | null>(null);
    const view = useRef({ pan, zoom });
    view.current = { pan, zoom };

    // Laid out again only when the graph's shape changes, not on every keystroke.
    const shape = JSON.stringify([steps.map((s) => s.id), edges.map((e) => [e.from, e.to])]);
    const positions = useMemo(() => autoLayout(steps, edges), [shape]);

    // Keep the selected step in view, for example a step just added below the visible area.
    useEffect(() => {
        const svg = svgRef.current;
        const p = selected && selected.kind === 'step' ? positions[selected.id] : undefined;
        if (!svg || !p || !svg.clientWidth || !svg.clientHeight) {
            return;
        }
        const { pan: at, zoom: z } = view.current;
        const margin = 20;
        const shift = (start: number, end: number, size: number) => {
            if (start < margin) {
                return margin - start;
            }
            return end > size - margin ? Math.max(margin - start, size - margin - end) : 0;
        };
        const dx = shift(p.x * z + at.x, (p.x + NODE_W) * z + at.x, svg.clientWidth);
        const dy = shift(p.y * z + at.y, (p.y + NODE_H + 20) * z + at.y, svg.clientHeight);
        if (dx || dy) {
            setPan({ x: at.x + dx, y: at.y + dy });
        }
    }, [selected, positions]);

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
        } else if (gesture.kind === 'link') {
            setCursor(toCanvas(ev.clientX, ev.clientY));
        }
    };

    const onPointerUp = (ev: React.PointerEvent) => {
        if (gesture) {
            if (gesture.kind === 'press') {
                onSelect({ kind: 'step', id: gesture.id });
            } else if (gesture.kind === 'link') {
                const end = toCanvas(ev.clientX, ev.clientY);
                const target = nodeAt(end);
                // A click on the handle, with no line drawn, adds nothing.
                const drawn = Math.abs(end.x - gesture.start.x) + Math.abs(end.y - gesture.start.y) > 12;
                if (!target) {
                    if (drawn) {
                        onAddFrom(gesture.from);
                    }
                } else if (target !== gesture.from) {
                    onConnect(gesture.from, target);
                }
            } else if (!gesture.moved) {
                onSelect(null);
            }
        }
        setGesture(null);
        setCursor(null);
    };

    const byStep = issuesByStep(issues);
    const isSelectedEdge = (e: Edge) => selected !== null && selected.kind === 'edge' && selected.from === e.from && selected.to === e.to;
    const markerId = 'so-canvas-arrow';
    const linkFrom = gesture && gesture.kind === 'link' ? positions[gesture.from] : null;

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
                    setCursor(null);
                }}
            >
                <ArrowMarker id={markerId} theme={theme} />
                <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                    {edges.map((e) => {
                        const a = positions[e.from];
                        const b = positions[e.to];
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
                        const p = positions[s.id];
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
                                    setGesture({ kind: 'press', id: s.id });
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
                                style={{ cursor: 'pointer' }}
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
                                        const start = toCanvas(ev.clientX, ev.clientY);
                                        setGesture({ kind: 'link', from: s.id, start });
                                        setCursor(start);
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
