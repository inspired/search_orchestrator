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
 * selects all but the whole job; Ctrl/Cmd+C, V and D copy, paste and duplicate them; they move,
 * nudge and are removed (`onRequestRemoveNodes`) together. Right-click, the Menu key or Shift+F10
 * asks for a menu (`onContext`, see useContextTrigger).
 * Keyboard: Tab through nodes, then lines; Enter selects, + or Shift+Enter opens the When list, arrows
 * nudge, Delete asks to remove, F frames everything, / (with focus in the canvas or its
 * toolbar, or Tab while the pointer is over the canvas) opens quick-add. The toolbar adds Add
 * node, Tidy up and Full screen when the caller handles them. Colours come from theme tokens only. */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import CrossCircle from '@splunk/react-icons/CrossCircle';
import ExclamationTriangle from '@splunk/react-icons/ExclamationTriangle';
import type { Issue } from '../../api/types';
import { issuesByStep, Pos, Positions } from './graphLogic';
import { NodeGroup, Theme } from './GraphView';
import { FlowGraph, FlowLink, FlowNode, JOB_KEY, PortId } from './nodeModel';
import { previewLine, barFraction, maxRows, PreviewSummary } from './nodePreview';
import useCompactPref from './useCompactPref';
import { FAMILY_OF, FAMILY_STYLE, PORT_STYLE, hasHandle } from './nodeStyle';
import { NodeShape } from './NodeShape';
import PlusHandle from './PlusHandle';
import Legend from './Legend';
import Minimap, { exceedsView } from './Minimap';
import { flowLinkLabel, usedOutcomes } from './outcomes';
import { bezierAt, clampZoom, frameView, linkEnds, linkPath } from './flowCanvasGeometry';
import LineLabel, { labelBox } from './LineLabel';
import useCanvasGestures, { ScreenPoint } from './useCanvasGestures';
import { FlowSelection, normaliseSelection, selectedKeys, toggleInSelection } from './selection';
import { ArrowMarkers, DraftLine, GridDots, GuideLines, SelectionBox } from './DragFeedback';
import useGridPref from './useGridPref';
import useRevealNode from './useRevealNode';
import CanvasToolbar from './CanvasToolbar';
import useContextTrigger from './useContextTrigger';
import type { ContextTarget } from './useContextTrigger';
import { runClipboardShortcut } from './clipboard';

export type { ContextTarget, FlowSelection, ScreenPoint };

export interface FlowCanvasProps {
    graph: FlowGraph;
    positions: Positions;
    selected: FlowSelection;
    issues: Issue[];
    /** What a node shows of its step's preview, by step id (see nodePreview): "1 204 rows · 3.2 s"
     * with a bar relative to the largest count on the canvas, "Previewing…" or "Preview failed: …". */
    previews?: Record<string, PreviewSummary | undefined>;
    /** Draw nodes compact (icon and name only). The caller lays the nodes out with the same flag;
     * without it the canvas keeps the choice itself (`so.flow.compact`) and the toolbar toggles it. */
    compact?: boolean;
    onToggleCompact?: () => void;
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
    /** Ctrl/Cmd+C, D (duplicate) and V (paste at canvas point `at`). */
    onCopy?: () => void;
    onDuplicate?: () => void;
    onPaste?: (at: Pos) => void;
    /** Also adds an "Add node" button to the toolbar, which opens it at the view centre. */
    onQuickAdd?: (at: Pos, screen: ScreenPoint) => void;
    /** Adds a "Tidy up" button to the toolbar. */
    onTidy?: () => void;
    /** Drawn over the canvas, positioned from its top-left corner (the quick-add box). */
    overlay?: React.ReactNode;
    /** A click on a line's label, or Enter on a focused line: the caller opens the line menu at
     * `screen` (just below the label, relative to the canvas' top-left). */
    onLineMenu?: (link: string, screen: ScreenPoint) => void;
    /** Right-click, Menu key or Shift+F10 on a node, a multi-selection, a line or the empty canvas
     * (`at` in canvas coordinates): the caller opens the menu at `screen`. */
    onContext?: (target: ContextTarget, screen: ScreenPoint) => void;
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
    previews = {},
    compact: compactProp,
    onToggleCompact,
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
    onCopy,
    onDuplicate,
    onPaste,
    onQuickAdd,
    onTidy,
    overlay,
    onLineMenu,
    onContext,
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
    const [gridOn, toggleGrid] = useGridPref();
    const [ownCompact, toggleOwnCompact] = useCompactPref();
    const compact = compactProp ?? ownCompact;
    const toggleCompact = onToggleCompact ?? toggleOwnCompact;
    const [hovered, setHovered] = useState<string | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });

    const canMove = !readOnly && !!onMove;
    const g = useCanvasGestures({
        svgRef, graph, positions, canMove, canSelectMany: !readOnly, selected, onSelect, onMove, onPlus, onConnect, onDropOnNode, onDropOnCanvas, onSplice, canSpliceNode, compact,
    });
    const { pan, setPan, zoom, setZoom, view, gesture, shown, cursor, spliceLink, guides, over, pointer, toCanvas, toScreen } = g;
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

    useRevealNode(svgRef, selectedNode ? byKey.get(selectedNode) : undefined, positions, view, setPan, compact);
    const mostRows = useMemo(() => maxRows(previews, graph.nodes.flatMap((n) => (n.stepId ? [n.stepId] : []))), [previews, graph]);

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
        return { x: ((svg ? svg.clientWidth : 0) / 2 - p.x) / z, y: ((svg ? svg.clientHeight : 0) / 2 - p.y) / z };
    };

    const frameAll = () => {
        const svg = svgRef.current;
        const next = svg ? frameView(graph, positions, svg.clientWidth, svg.clientHeight, undefined, compact) : null;
        if (next) {
            setZoom(next.zoom);
            setPan(next.pan);
        }
    };

    const selectLink = (l: FlowLink) => {
        // Action lines cannot be removed, only moved: select the action, whose panel moves it.
        onSelect(l.kind === 'action' ? { kind: 'node', key: l.to } : { kind: 'link', key: l.key });
    };

    const context = useContextTrigger({
        svg: () => svgRef.current,
        onContext: readOnly ? undefined : onContext,
        selected,
        onSelect,
        selectLink: (key) => {
            const l = graph.links.find((x) => x.key === key);
            if (l) {
                selectLink(l);
            }
        },
        toCanvas,
    });

    const onKeyDown = (ev: React.KeyboardEvent) => {
        if (context.onKey(ev)) {
            return;
        }
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
        if (runClipboardShortcut(ev, { enabled: !readOnly, hasSelection: selectedKeys(selected).length > 0, onCopy, onDuplicate, onPaste, at: () => quickAddAt(false) })) {
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
            const ends = from && to ? linkEnds(l, from, to, shown, tabsOf[l.from], compact) : null;
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
        const line = previewLine(n.stepId ? previews[n.stepId] : undefined);
        return [head, detail && status && status[n.key] ? detail.text : n.detail, ...counts, line ? line.text : ''].filter(Boolean).join(', ');
    };

    const help = readOnly
        ? 'Job flow. Tab to a node, Enter to select it, F to frame all.'
        : 'Job flow. Tab to a node, Enter to select it, Shift+Space to add it to the selection, + to choose what happens next, arrow keys to move it, Delete to remove it, / to add a node, F to frame all.';

    return (
        <div>
            <CanvasToolbar
                canEdit={!readOnly}
                onAddNode={onQuickAdd ? () => openQuickAdd(true) : undefined}
                onTidy={onTidy}
                onZoom={(f) => setZoom((z) => clampZoom(z * f))}
                onReset={() => (setZoom(1), setPan({ x: 0, y: 0 }))}
                onFrame={frameAll}
                legendOpen={legendOpen}
                onToggleLegend={() => setLegendOpen((o) => !o)}
                gridOn={gridOn}
                onToggleGrid={toggleGrid}
                compact={compact}
                onToggleCompact={toggleCompact}
                fullScreen={fullScreen}
                onToggleFullScreen={onToggleFullScreen}
            />
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
                onContextMenu={onContext && !readOnly ? context.onContextMenu : undefined}
            >
                <ArrowMarkers uid={uid} tokens={MARKER_TOKENS} theme={theme} />
                <g data-view="true" transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                    {gridOn && <GridDots uid={uid} pan={pan} zoom={zoom} width={size.w} height={size.h} theme={theme} />}
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
                                data-link-hit={trigger ? undefined : l.key}
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
                        <DraftLine node={byKey.get(gesture.from)} at={shown[gesture.from]} tabs={tabsOf[gesture.from] || []} outcome={gesture.outcome} to={cursor} theme={theme} compact={compact} />
                    )}
                    {graph.nodes.map((n) => {
                        const p = shown[n.key];
                        if (!p) {
                            return null;
                        }
                        const isSelected = chosen.has(n.key);
                        const { detail, counts } = detailOf(n);
                        const line = previewLine(n.stepId ? previews[n.stepId] : undefined);
                        // Issues and run status keep the detail line; a preview takes it otherwise.
                        const text = detail ? detail.text : line ? line.text : undefined;
                        const icon = detail ? detail.icon : line && line.failed ? <CrossCircle aria-hidden width={24} height={24} /> : undefined;
                        const color = detail ? detail.color : line && line.failed ? theme.statusColorHigh : undefined;
                        const previewProps = {
                            status: text,
                            statusIcon: icon,
                            statusColor: color,
                            previewId: n.stepId,
                            bar: n.stepId ? barFraction(previews[n.stepId], mostRows) : 0,
                        };
                        const overlaid = compact && n.kind !== 'condition' && (hovered === n.key || isSelected);
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
                                onPointerEnter={() => setHovered(n.key)}
                                onPointerLeave={() => setHovered((k) => (k === n.key ? null : k))}
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
                                    compact={compact}
                                    {...(compact ? {} : previewProps)}
                                />
                                {/* Compact: the full node over it, below the + and tabs, on hover or selection. */}
                                {overlaid && (
                                    <g data-testid={`node-full-${n.key}`}>
                                        <NodeShape node={n} theme={theme} selected={isSelected} stroke={detail ? detail.color : undefined} {...previewProps} />
                                    </g>
                                )}
                                {hasHandle(n.kind) && (
                                    <PlusHandle
                                        nodeKey={n.key}
                                        kind={n.kind}
                                        theme={theme}
                                        tabs={tabsOf[n.key] || []}
                                        plus={!readOnly}
                                        compact={compact}
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
                    {guides.length > 0 && <GuideLines guides={guides} theme={theme} />}
                    {gesture && gesture.kind === 'box' && gesture.moved && cursor && <SelectionBox from={gesture.start} to={cursor} theme={theme} />}
                </g>
            </svg>
            {legendOpen && (
                <div style={{ position: 'absolute', top: 8, right: 8 }}>
                    <Legend />
                </div>
            )}
            {exceedsView(graph, shown, zoom, size.w, size.h, compact) && (
                <Minimap graph={graph} positions={shown} pan={pan} zoom={zoom} width={size.w} height={size.h} onPan={setPan} compact={compact} />
            )}
            {overlay}
            </div>
        </div>
    );
}
