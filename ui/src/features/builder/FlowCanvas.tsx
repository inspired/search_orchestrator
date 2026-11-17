/* The node editor canvas: an SVG with pan (drag the background) and zoom (wheel or buttons).
 * Nodes sit where `positions` puts them and can be dragged; every node with outcomes has one +
 * on its right edge, and each outcome in use shows as a tab above it, where its lines leave.
 * Clicking the + asks the caller for a "when" (`onPlus`); dragging it or a tab draws a line,
 * reported on release over a node (`onDropOnNode`) or empty canvas (`onDropOnCanvas`), with
 * the tab's outcome when it came from a tab. Each line carries a label at its midpoint
 * (LineLabel; hidden below 70 % zoom except on the selected line): clicking it, or Enter on a
 * focused line, selects the line and asks for its menu (`onLineMenu`). A node with no lines
 * dropped on a line the caller allows is spliced in (`onSplice`). Gestures, including auto-pan
 * near the edge, live in useCanvasGestures.
 * Shift+click, Shift+Space or a Shift+drag box on empty canvas select several nodes; Ctrl/Cmd+A
 * selects all but the whole job; they move, nudge and are removed (`onRequestRemoveNodes`) together.
 * Keyboard: Tab through nodes, then lines; Enter selects, + or Shift+Enter opens the When list, arrows
 * nudge, Delete asks to remove, F frames everything, / (with focus in the canvas or its
 * toolbar, or Tab while the pointer is over the canvas) opens quick-add. The toolbar adds Add
 * node, Tidy up and Full screen when the caller handles them. Colours come from theme tokens only. */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import CrossCircle from '@splunk/react-icons/CrossCircle';
import ExclamationTriangle from '@splunk/react-icons/ExclamationTriangle';
import type { Issue } from '../../api/types';
import { issuesByStep, Pos, Positions } from './graphLogic';
import { NodeGroup, Theme } from './GraphView';
import { FlowGraph, FlowLink, FlowNode, JOB_KEY, PortId } from './nodeModel';
import { FAMILY_OF, FAMILY_STYLE, PORT_STYLE, hasHandle, nodeSize } from './nodeStyle';
import { NodeShape } from './NodeShape';
import PlusHandle from './PlusHandle';
import Legend from './Legend';
import Minimap, { exceedsView } from './Minimap';
import { flowLinkLabel, usedOutcomes } from './outcomes';
import { bezierAt, clampZoom, frameView, linkEnds, linkPath } from './flowCanvasGeometry';
import LineLabel, { labelBox } from './LineLabel';
import useCanvasGestures, { ScreenPoint } from './useCanvasGestures';
import { FlowSelection, normaliseSelection, selectedKeys, toggleInSelection } from './selection';
import { DraftLine, SelectionBox } from './DragFeedback';

export type { FlowSelection, ScreenPoint };

export interface FlowCanvasProps {
    graph: FlowGraph;
    positions: Positions;
    selected: FlowSelection;
    issues: Issue[];
    /** A short preview note under each previewed step, by step id, such as "✓ 7 rows". */
    notes?: Record<string, { text: string; failed?: boolean } | null | undefined>;
    /** No + handles, no moving: for the run page. */
    readOnly?: boolean;
    /** Replaces a node's detail line, by node key. `icon` is drawn in a 24×24 viewBox. */
    status?: Record<string, { text: string; icon?: React.ReactNode; color?: string } | undefined>;
    onSelect: (sel: FlowSelection) => void;
    /** New top-left positions, called once when a drag ends or a node is nudged. */
    onMove?: (positions: Record<string, Pos>) => void;
    /** A line from a tab released on a node, when there is no `onDropOnNode`. */
    onConnect?: (from: string, outcome: PortId, to: string) => void;
    /** A click on a node's + (or + / Shift+Enter on it): the caller opens the When list at `screen`. */
    onPlus?: (from: string, screen: ScreenPoint) => void;
    /** A line released on another node: from the + (no outcome, the caller asks) or a tab. */
    onDropOnNode?: (from: string, to: string, screen: ScreenPoint, outcome?: PortId) => void;
    /** `at` is in canvas coordinates; `screen` is the same point relative to the canvas' top-left
     * corner on screen, for placing the quick-add box (see `overlay`). */
    onDropOnCanvas?: (from: string, at: Pos, screen: ScreenPoint, outcome?: PortId) => void;
    onRequestRemove?: (key: string) => void;
    /** Delete on a multi-selection: the caller confirms, then removes them all. */
    onRequestRemoveNodes?: (keys: string[]) => void;
    /** Also adds an "Add node" button to the toolbar, which opens it at the view centre. */
    onQuickAdd?: (at: Pos, screen: ScreenPoint) => void;
    /** Adds a "Tidy up" button to the toolbar. */
    onTidy?: () => void;
    /** Drawn over the canvas, positioned from its top-left corner (the quick-add box). */
    overlay?: React.ReactNode;
    /** A click on a line's label, or Enter on a focused line: the caller opens the line menu at
     * `screen` (just below the label, relative to the canvas' top-left). */
    onLineMenu?: (link: string, screen: ScreenPoint) => void;
    /** A node with no lines dropped onto a line that `canSpliceNode` allows, at canvas point `at`. */
    onSplice?: (node: string, link: string, at: Pos) => void;
    canSpliceNode?: (node: string, link: string) => boolean;
    /** Canvas height in px (default 480). */
    height?: number;
    /** Adds a "Full screen" / "Leave full screen" toolbar button. */
    fullScreen?: boolean;
    onToggleFullScreen?: () => void;
}

const NUDGE = 10;
const CONDITION_LABEL = 36;
/** Below this zoom, line labels show only on the selected line. */
const LABEL_ZOOM = 0.7;
const ARROWS: Record<string, Pos> = {
    ArrowLeft: { x: -NUDGE, y: 0 },
    ArrowRight: { x: NUDGE, y: 0 },
    ArrowUp: { x: 0, y: -NUDGE },
    ArrowDown: { x: 0, y: NUDGE },
};
const TRIGGER_TOKEN = 'categoricalA1Strong';
const MARKER_TOKENS = Array.from(new Set([...Object.values(PORT_STYLE).map((p) => p.colorToken), TRIGGER_TOKEN, 'focusColor']));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface LinkGeometry {
    l: FlowLink;
    from: FlowNode;
    to: FlowNode;
    d: string;
    mid: Pos;
}

interface Detail {
    text: string;
    icon?: React.ReactNode;
    color?: string;
}

export default function FlowCanvas({
    graph,
    positions,
    selected,
    issues,
    notes = {},
    readOnly = false,
    status,
    onSelect,
    onMove,
    onConnect,
    onPlus,
    onDropOnNode,
    onDropOnCanvas,
    onRequestRemove,
    onRequestRemoveNodes,
    onQuickAdd,
    onTidy,
    overlay,
    onLineMenu,
    onSplice,
    canSpliceNode,
    height = 480,
    fullScreen = false,
    onToggleFullScreen,
}: FlowCanvasProps) {
    const theme = useSplunkTheme() as unknown as Theme;
    const uid = `so-flow-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [legendOpen, setLegendOpen] = useState(false);
    const [size, setSize] = useState({ w: 0, h: 0 });

    const canMove = !readOnly && !!onMove;
    const g = useCanvasGestures({
        svgRef, graph, positions, canMove, canSelectMany: !readOnly, selected, onSelect, onMove, onPlus, onConnect, onDropOnNode, onDropOnCanvas, onSplice, canSpliceNode,
    });
    const { pan, setPan, zoom, setZoom, view, gesture, shown, cursor, spliceLink, over, pointer, toCanvas, toScreen } = g;
    const byKey = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n] as const)), [graph]);
    // Outcome tabs per node, nearest the + first; conditions have only their "Then" and no tabs.
    const tabsOf = useMemo(() => {
        const out: Record<string, PortId[]> = {};
        graph.nodes.forEach((n) => {
            out[n.key] = n.kind === 'condition' ? [] : usedOutcomes(graph, n.key);
        });
        return out;
    }, [graph]);
    const selectedNode = selected && selected.kind === 'node' ? selected.key : null;
    const many = selected && selected.kind === 'nodes' ? selected.keys : null;
    const chosen = new Set(selectedKeys(selected));

    // Keep the selected node in view, for example a node just added outside the visible area.
    useEffect(() => {
        const svg = svgRef.current;
        const n = selectedNode ? byKey.get(selectedNode) : undefined;
        const p = n ? positions[n.key] : undefined;
        if (!svg || !n || !p || !svg.clientWidth || !svg.clientHeight) {
            return;
        }
        const { w, h } = nodeSize(n.kind);
        const { pan: at, zoom: z } = view.current;
        const margin = 20;
        const shift = (start: number, end: number, size: number) => {
            if (start < margin) {
                return margin - start;
            }
            return end > size - margin ? Math.max(margin - start, size - margin - end) : 0;
        };
        const dx = shift(p.x * z + at.x, (p.x + w) * z + at.x, svg.clientWidth);
        const dy = shift(p.y * z + at.y, (p.y + h + 20) * z + at.y, svg.clientHeight);
        if (dx || dy) {
            setPan({ x: at.x + dx, y: at.y + dy });
        }
    }, [selectedNode, positions, byKey]);

    // Track the visible canvas size for the minimap: after every render, and when the window resizes.
    const measure = () => {
        const svg = svgRef.current;
        const w = svg ? svg.clientWidth : 0;
        const h = svg ? svg.clientHeight : 0;
        setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    useEffect(measure);
    useEffect(() => {
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

    const openQuickAdd = (centre = false) => {
        if (onQuickAdd) {
            const at = quickAddAt(centre);
            onQuickAdd(at, toScreen(at));
        }
    };

    const quickAddAt = (centre: boolean): Pos => {
        if (pointer.current && !centre) {
            return toCanvas(pointer.current.clientX, pointer.current.clientY);
        }
        const svg = svgRef.current;
        const { pan: p, zoom: z } = view.current;
        const w = svg ? svg.clientWidth : 0;
        const h = svg ? svg.clientHeight : 0;
        return { x: (w / 2 - p.x) / z, y: (h / 2 - p.y) / z };
    };

    const frameAll = () => {
        const svg = svgRef.current;
        const next = svg ? frameView(graph, positions, svg.clientWidth, svg.clientHeight) : null;
        if (next) {
            setZoom(next.zoom);
            setPan(next.pan);
        }
    };

    const selectLink = (l: FlowLink) => {
        // Action lines cannot be removed, only moved: select the action, whose panel moves it.
        onSelect(l.kind === 'action' ? { kind: 'node', key: l.to } : { kind: 'link', key: l.key });
    };

    const onKeyDown = (ev: React.KeyboardEvent) => {
        const el = ev.target as Element;
        const focusedNode = el.closest ? el.closest('[data-node-key]')?.getAttribute('data-node-key') || null : null;
        const focusedLink = el.closest ? el.closest('[data-link-key]')?.getAttribute('data-link-key') || null : null;
        if (ev.key === 'Tab') {
            if (!ev.shiftKey && over.current && onQuickAdd) {
                ev.preventDefault();
                openQuickAdd();
            }
            return;
        }
        if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === 'a' || ev.key === 'A') && !readOnly) {
            ev.preventDefault();
            onSelect(normaliseSelection(graph.nodes.map((n) => n.key).filter((k) => k !== JOB_KEY)));
            return;
        }
        if (ev.ctrlKey || ev.metaKey || ev.altKey) {
            return;
        }
        if (ev.key === '/') {
            if (onQuickAdd) {
                ev.preventDefault();
                openQuickAdd();
            }
            return;
        }
        if (ev.key === '+' || (ev.key === 'Enter' && ev.shiftKey)) {
            const n = focusedNode ? byKey.get(focusedNode) : undefined;
            const at = n && hasHandle(n.kind) ? g.plusScreen(n.key) : null;
            if (n && at && !readOnly && onPlus) {
                ev.preventDefault();
                onPlus(n.key, at);
            }
            return;
        }
        if (ev.key === ' ' && ev.shiftKey && focusedNode && !readOnly) {
            ev.preventDefault();
            onSelect(toggleInSelection(selected, focusedNode));
            return;
        }
        if (ev.key === 'Enter' || ev.key === ' ') {
            const link = focusedLink ? linkGeometry.find((x) => x.l.key === focusedLink) : undefined;
            if (focusedNode) {
                ev.preventDefault();
                onSelect({ kind: 'node', key: focusedNode });
            } else if (link) {
                ev.preventDefault();
                if (ev.key === 'Enter') {
                    pickLine(link);
                } else {
                    selectLink(link.l);
                }
            }
            return;
        }
        if (ev.key === 'Escape') {
            // During a drag, Escape cancels the drag only (useCanvasGestures).
            if (selected && !gesture) {
                ev.preventDefault();
                onSelect(null);
            }
            return;
        }
        if (ev.key === 'f' || ev.key === 'F') {
            ev.preventDefault();
            frameAll();
            return;
        }
        // A multi-selection acts as one, unless the focused node is outside it.
        const group = many && (!focusedNode || many.includes(focusedNode)) ? many : null;
        const target = focusedNode || selectedNode;
        if (ev.key === 'Delete' || ev.key === 'Backspace') {
            if (group && !readOnly && onRequestRemoveNodes) {
                ev.preventDefault();
                onRequestRemoveNodes(group);
            } else if (!group && target && target !== JOB_KEY && !readOnly && onRequestRemove) {
                ev.preventDefault();
                onRequestRemove(target);
            }
            return;
        }
        const step = ARROWS[ev.key];
        const moving = (group || (target ? [target] : [])).filter((k) => positions[k]);
        if (step && moving.length && canMove && onMove) {
            ev.preventDefault();
            onMove(Object.fromEntries(moving.map((k) => [k, { x: positions[k].x + step.x, y: positions[k].y + step.y }])));
        }
    };

    const linkGeometry = graph.links
        .map((l) => {
            const from = byKey.get(l.from);
            const to = byKey.get(l.to);
            const ends = from && to ? linkEnds(l, from, to, shown, tabsOf[l.from]) : null;
            return from && to && ends ? { l, from, to, d: linkPath(ends.a, ends.b), mid: bezierAt(ends.a, ends.b, 0.5) } : null;
        })
        .filter((x): x is LinkGeometry => x !== null);

    /** Select a line and ask for its menu, just below its label. */
    const pickLine = ({ l, mid }: LinkGeometry) => {
        selectLink(l);
        if (onLineMenu && !readOnly) {
            const b = labelBox(flowLinkLabel(graph, l), mid);
            onLineMenu(l.key, toScreen({ x: b.x, y: b.y + b.h + 4 }));
        }
    };

    const byStep = issuesByStep(issues);
    const isSelectedLink = (l: FlowLink) =>
        selected !== null && (l.kind === 'action' ? selected.kind === 'node' && selected.key === l.to : selected.kind === 'link' && selected.key === l.key);
    const markerUrl = (token: string) => `url(#${uid}-arrow-${token})`;

    const detailOf = (n: FlowNode): { detail: Detail | null; counts: string[] } => {
        const mine = n.stepId ? byStep[n.stepId] || [] : [];
        const errors = mine.filter((i) => i.level === 'error').length;
        const warnings = mine.length - errors;
        const counts = [errors ? plural(errors, 'error') : '', warnings ? plural(warnings, 'warning') : ''].filter(Boolean);
        const st = status ? status[n.key] : undefined;
        if (st) {
            return { detail: st, counts };
        }
        if (errors) {
            return { detail: { text: counts[0], icon: <CrossCircle aria-hidden width={24} height={24} />, color: theme.statusColorHigh }, counts };
        }
        if (warnings) {
            return {
                detail: { text: counts[0], icon: <ExclamationTriangle aria-hidden width={24} height={24} />, color: theme.statusColorMedium },
                counts,
            };
        }
        return { detail: null, counts };
    };

    const ariaLabelOf = (n: FlowNode, detail: Detail | null, counts: string[]) => {
        const family = FAMILY_STYLE[FAMILY_OF[n.kind]].label;
        const head = family === n.label ? n.label : `${family} ${n.label}`;
        const note = n.stepId ? notes[n.stepId] : undefined;
        return [head, detail && status && status[n.key] ? detail.text : n.detail, ...counts, note ? note.text : '']
            .filter(Boolean)
            .join(', ');
    };

    const help = readOnly
        ? 'Job flow. Tab to a node, Enter to select it, F to frame all.'
        : 'Job flow. Tab to a node, Enter to select it, Shift+Space to add it to the selection, + to choose what happens next, arrow keys to move it, Delete to remove it, / to add a node, F to frame all.';

    return (
        <div>
            {/* "/" opens quick-add from the toolbar too. */}
            <div
                style={{ display: 'flex', gap: '4px', marginBottom: '4px', flexWrap: 'wrap' }}
                onKeyDown={(ev) => {
                    if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && onQuickAdd && !readOnly) {
                        ev.preventDefault();
                        openQuickAdd(true);
                    }
                }}
            >
                {!readOnly && onQuickAdd && <Button appearance="secondary" label="Add node" onClick={() => openQuickAdd(true)} />}
                {!readOnly && onTidy && <Button appearance="subtle" label="Tidy up" onClick={onTidy} />}
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
                <Button appearance="subtle" label="Frame all" onClick={frameAll} />
                <Button appearance="subtle" label={legendOpen ? 'Hide node types' : 'Show node types'} onClick={() => setLegendOpen((o) => !o)} />
                {onToggleFullScreen && <Button appearance="subtle" label={fullScreen ? 'Leave full screen' : 'Full screen'} onClick={onToggleFullScreen} />}
            </div>
            <div style={{ position: 'relative' }}>
            <svg
                ref={svgRef}
                data-canvas="true"
                tabIndex={-1}
                role="group"
                aria-label={help}
                width="100%"
                height={height}
                style={{
                    display: 'block',
                    background: theme.backgroundColorPage,
                    border: `1px solid ${theme.borderColor}`,
                    borderRadius: '4px',
                    touchAction: 'none',
                    cursor: gesture && gesture.kind === 'box' ? 'crosshair' : gesture && gesture.kind === 'pan' ? 'grabbing' : 'grab',
                }}
                onPointerEnter={() => {
                    over.current = true;
                }}
                onPointerLeave={() => {
                    over.current = false;
                    pointer.current = null;
                }}
                onPointerDown={g.startPan}
                onPointerMove={g.onPointerMove}
                onPointerUp={g.onPointerUp}
                onPointerCancel={g.endGesture}
                onKeyDown={onKeyDown}
            >
                <defs>
                    {MARKER_TOKENS.map((token) => (
                        <marker
                            key={token}
                            id={`${uid}-arrow-${token}`}
                            viewBox="0 0 10 10"
                            refX="9"
                            refY="5"
                            markerWidth="7"
                            markerHeight="7"
                            orient="auto-start-reverse"
                        >
                            <path d="M0,0 L10,5 L0,10 z" fill={theme[token]} />
                        </marker>
                    ))}
                </defs>
                <g data-view="true" transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                    {linkGeometry.map(({ l, d }) => {
                        const trigger = l.kind === 'trigger' || !l.port;
                        const isSel = !trigger && isSelectedLink(l);
                        const into = spliceLink === l.key;
                        const token = isSel || into ? 'focusColor' : trigger || !l.port ? TRIGGER_TOKEN : PORT_STYLE[l.port].colorToken;
                        const width = into ? 3 : (l.data ? 3 : 1.5) + (isSel ? 1 : 0);
                        return (
                            <g
                                key={l.key}
                                data-testid={`link-${l.key}`}
                                pointerEvents={trigger ? 'none' : undefined}
                                onPointerDown={trigger ? undefined : (ev) => ev.stopPropagation()}
                                onClick={trigger ? undefined : () => selectLink(l)}
                                style={{ cursor: trigger ? undefined : 'pointer' }}
                            >
                                <path
                                    d={d}
                                    fill="none"
                                    stroke={theme[token]}
                                    strokeWidth={width}
                                    strokeDasharray={trigger ? '5 4' : undefined}
                                    markerEnd={markerUrl(token)}
                                />
                                {!trigger && <path d={d} fill="none" stroke={theme[token]} strokeOpacity={0} strokeWidth={12} pointerEvents="stroke" />}
                            </g>
                        );
                    })}
                    {linkGeometry.map((geo) => {
                        const { l, mid } = geo;
                        const text = flowLinkLabel(graph, l);
                        const isSel = isSelectedLink(l);
                        if (!text || (zoom < LABEL_ZOOM && !isSel)) {
                            return null;
                        }
                        const token = isSel || spliceLink === l.key ? 'focusColor' : PORT_STYLE[l.port as PortId].colorToken;
                        return (
                            <LineLabel
                                key={l.key}
                                linkKey={l.key}
                                text={text}
                                at={mid}
                                theme={theme}
                                colorToken={token}
                                onPick={() => pickLine(geo)}
                            />
                        );
                    })}
                    {gesture && gesture.kind === 'line' && cursor && (
                        <DraftLine node={byKey.get(gesture.from)} at={shown[gesture.from]} tabs={tabsOf[gesture.from] || []} outcome={gesture.outcome} to={cursor} theme={theme} />
                    )}
                    {graph.nodes.map((n) => {
                        const p = shown[n.key];
                        if (!p) {
                            return null;
                        }
                        const isSelected = chosen.has(n.key);
                        const { detail, counts } = detailOf(n);
                        const note = n.stepId ? notes[n.stepId] : undefined;
                        const { h } = nodeSize(n.kind);
                        return (
                            <NodeGroup
                                key={n.key}
                                data-testid={`node-${n.key}`}
                                data-node-key={n.key}
                                transform={`translate(${p.x},${p.y})`}
                                role="button"
                                tabIndex={0}
                                aria-label={ariaLabelOf(n, detail, counts)}
                                aria-pressed={isSelected}
                                onPointerDown={(ev) => {
                                    ev.stopPropagation();
                                    g.startNode(ev, n.key);
                                }}
                                style={{ cursor: canMove ? 'move' : 'pointer' }}
                            >
                                <NodeShape
                                    node={n}
                                    theme={theme}
                                    selected={isSelected}
                                    stroke={detail ? detail.color : undefined}
                                    status={detail ? detail.text : undefined}
                                    statusIcon={detail ? detail.icon : undefined}
                                    statusColor={detail ? detail.color : undefined}
                                />
                                {note && (
                                    <text
                                        data-testid={`note-${n.stepId}`}
                                        x={0}
                                        y={(n.kind === 'condition' ? h + CONDITION_LABEL : h) + 14}
                                        fontSize={11}
                                        fill={note.failed ? theme.statusColorHigh : theme.contentColorMuted}
                                        fontFamily={theme.fontFamily}
                                    >
                                        {note.text}
                                    </text>
                                )}
                                {hasHandle(n.kind) && (
                                    <PlusHandle
                                        nodeKey={n.key}
                                        kind={n.kind}
                                        theme={theme}
                                        tabs={tabsOf[n.key] || []}
                                        plus={!readOnly}
                                        onPlusDown={readOnly ? undefined : (ev) => g.startLine(ev, n.key)}
                                        onTabDown={readOnly ? undefined : (ev, outcome) => g.startLine(ev, n.key, outcome)}
                                    />
                                )}
                            </NodeGroup>
                        );
                    })}
                    {/* Focus targets for lines, after the nodes so Tab reaches every node first. */}
                    {linkGeometry
                        .filter(({ l }) => l.kind !== 'trigger' && l.port)
                        .map(({ l, from, to, d }) => (
                            <NodeGroup
                                key={l.key}
                                data-link-key={l.key}
                                role="button"
                                tabIndex={0}
                                aria-label={`Line from ${from.label}, ${PORT_STYLE[l.port as PortId].label}, to ${to.label}`}
                                aria-pressed={isSelectedLink(l)}
                                pointerEvents="none"
                            >
                                <path d={d} fill="none" stroke="none" />
                            </NodeGroup>
                        ))}
                    {gesture && gesture.kind === 'box' && gesture.moved && cursor && <SelectionBox from={gesture.start} to={cursor} theme={theme} />}
                </g>
            </svg>
            {legendOpen && (
                <div style={{ position: 'absolute', top: 8, right: 8 }}>
                    <Legend />
                </div>
            )}
            {exceedsView(graph, shown, zoom, size.w, size.h) && (
                <Minimap graph={graph} positions={shown} pan={pan} zoom={zoom} width={size.w} height={size.h} onPan={setPan} />
            )}
            {overlay}
            </div>
        </div>
    );
}
