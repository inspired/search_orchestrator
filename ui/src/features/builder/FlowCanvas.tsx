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
 * node, Tidy up and Full screen when the caller handles them. Colours come from theme tokens only.
 * Groups (groups.ts, GroupFrame): drag the title bar to move one with its nodes, the corner to resize,
 * double-click to edit the title; Ctrl/Cmd+G groups the selection; as keyboard stops after the nodes,
 * Enter selects, Delete removes, arrows move, Shift+arrows resize. `readOnly` draws them expanded.
 * The run page adds line states and row labels (FlowLines), running nodes (RunningMark) and
 * following the running steps (useFollowRun) until the user pans or zooms (`onUserView`). */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Issue } from '../../api/types';
import { Pos, Positions } from './graphLogic';
import { NodeGroup, Theme } from './GraphView';
import { FlowGraph, FlowLink, JOB_KEY, PortId } from './nodeModel';
import { maxRows, PreviewSummary } from './nodePreview';
import useCompactPref from './useCompactPref';
import { PORT_STYLE, hasHandle } from './nodeStyle';
import { FlowNodes, NodeOverlays, NodeStatus, nodeLook } from './FlowNodeView';
import { GroupFocus, GroupFrame, drawnBox } from './GroupFrame';
import { Group, MIN_GROUP, collapsedEnd, hiddenMembers, membersOf, validGroups } from './groups';
import Legend from './Legend';
import Minimap, { exceedsView } from './Minimap';
import { flowLinkLabel, usedOutcomes } from './outcomes';
import { FlowLines, LineState, LinkGeometry, LiveStyles, MARKER_TOKENS } from './FlowLines';
import useFollowRun from './useFollowRun';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';
import { bezierAt, clampZoom, frameView, linkEnds, linkPath } from './flowCanvasGeometry';
import { labelBox } from './LineLabel';
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
    status?: NodeStatus;
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
    /** Frames behind the nodes (job.layout.groups); broken entries are skipped. */
    groups?: Group[];
    /** Frame and nodes moved by dx, dy (one undo step); `members` were inside when it started. */
    onGroupMove?: (id: string, dx: number, dy: number, members: string[]) => void;
    onGroupResize?: (id: string, size: { w: number; h: number }) => void;
    /** A double-click on a group's title: the caller focuses the title field. */
    onGroupTitle?: (id: string) => void;
    onRequestRemoveGroup?: (id: string) => void;
    /** Ctrl/Cmd+G or the toolbar's Group selection, with the selected nodes. */
    onGroup?: (keys: string[]) => void;
    /** Run page: each line's run state and row labels ("1,204 rows →", replacing the outcome label), by link key. */
    lineStates?: Record<string, LineState>;
    lineLabels?: Record<string, string>;
    /** Run page: the running nodes, by key (outline, spinner, timer from `status`). */
    running?: string[];
    /** Keep the running nodes in view; `onUserView` on any user pan, zoom or frame. */
    follow?: boolean;
    onUserView?: () => void;
    /** Adds "Follow the run" to the toolbar while `follow` is off. */
    onFollow?: () => void;
}

const NUDGE = 10;
const ARROWS: Record<string, Pos> = {
    ArrowLeft: { x: -NUDGE, y: 0 },
    ArrowRight: { x: NUDGE, y: 0 },
    ArrowUp: { x: 0, y: -NUDGE },
    ArrowDown: { x: 0, y: NUDGE },
};

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
    groups: groupsProp,
    onGroupMove,
    onGroupResize,
    onGroupTitle,
    onRequestRemoveGroup,
    onGroup,
    lineStates,
    lineLabels,
    running,
    follow = false,
    onUserView,
    onFollow,
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
    const motion = !usePrefersReducedMotion();
    const runningSet = useMemo(() => (running && running.length ? new Set(running) : undefined), [running]);
    const userView = () => {
        if (follow && onUserView) {
            onUserView();
        }
    };

    const canMove = !readOnly && !!onMove;
    const groups = useMemo(() => validGroups(groupsProp), [groupsProp]);
    // Nodes in a collapsed group are hidden: not drawn, not focusable, not hit by drops.
    const hidden = useMemo(() => hiddenMembers(groups, graph, positions, readOnly), [groups, graph, positions, readOnly]);
    const hide = Object.keys(hidden).length > 0;
    const visible = useMemo<FlowGraph>(() => (hide ? { nodes: graph.nodes.filter((n) => !hidden[n.key]), links: graph.links.filter((l) => !hidden[l.from] && !hidden[l.to]) } : graph), [graph, hidden, hide]);
    const g = useCanvasGestures({
        svgRef, graph: visible, memberGraph: graph, positions, canMove, canSelectMany: !readOnly, selected, onSelect, onMove, onPlus, onConnect, onDropOnNode, onDropOnCanvas, onSplice, canSpliceNode, compact,
        groups, onGroupMove, onGroupResize, onUserView: userView,
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
    const selectedGroup = selected && selected.kind === 'group' ? selected.id : null;
    const many = selected && selected.kind === 'nodes' ? selected.keys : null;
    const chosen = new Set(selectedKeys(selected));

    useRevealNode(svgRef, selectedNode ? byKey.get(selectedNode) : undefined, positions, view, setPan, compact);
    useFollowRun(svgRef, follow, running, byKey, positions, view, setPan, compact, gesture !== null);
    const mostRows = useMemo(() => maxRows(previews, graph.nodes.flatMap((n) => (n.stepId ? [n.stepId] : []))), [previews, graph]);
    const look = nodeLook({ issues, status, previews, mostRows, theme });
    const groupView = groups.map((grp) => ({ grp, live: g.groupShown(grp), collapsed: !readOnly && !!grp.collapsed, members: membersOf(grp, graph, positions).length }));

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
        userView();
        const svg = svgRef.current;
        const next = svg ? frameView(visible, positions, svg.clientWidth, svg.clientHeight, undefined, compact, groupView.map((v) => drawnBox(v.grp, v.collapsed))) : null;
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
        const focusedGroup = el.closest ? el.closest('[data-group-id]')?.getAttribute('data-group-id') || null : null;
        if (ev.key === 'Tab') {
            if (!ev.shiftKey && over.current && onQuickAdd) {
                ev.preventDefault();
                openQuickAdd();
            }
            return;
        }
        if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === 'a' || ev.key === 'A') && !readOnly) {
            ev.preventDefault();
            onSelect(normaliseSelection(visible.nodes.map((n) => n.key).filter((k) => k !== JOB_KEY)));
            return;
        }
        if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === 'g' || ev.key === 'G') && !readOnly && onGroup) {
            ev.preventDefault();
            if (selectedKeys(selected).length) {
                onGroup(selectedKeys(selected));
            }
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
            } else if (focusedGroup) {
                ev.preventDefault();
                onSelect({ kind: 'group', id: focusedGroup });
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
        // A focused group, or the selected one with no node focused, takes Delete and the arrows.
        const groupId = focusedGroup || (!focusedNode && !focusedLink ? selectedGroup : null);
        const theGroup = groupId ? groups.find((x) => x.id === groupId) : undefined;
        if (theGroup && !readOnly) {
            const step = ARROWS[ev.key];
            if ((ev.key === 'Delete' || ev.key === 'Backspace') && onRequestRemoveGroup) {
                ev.preventDefault();
                onRequestRemoveGroup(theGroup.id);
            } else if (step && ev.shiftKey && onGroupResize) {
                ev.preventDefault();
                onGroupResize(theGroup.id, { w: Math.max(MIN_GROUP.w, theGroup.w + step.x), h: Math.max(MIN_GROUP.h, theGroup.h + step.y) });
            } else if (step && onGroupMove) {
                ev.preventDefault();
                onGroupMove(theGroup.id, step.x, step.y, membersOf(theGroup, graph, positions));
            }
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

    // A line to or from a hidden node attaches to its group's block; one inside a block is not drawn.
    const blockOf = (key: string) => (hidden[key] ? groupView.find((v) => v.grp.id === hidden[key]) : undefined);
    const linkGeometry = graph.links
        .map((l) => {
            const from = byKey.get(l.from);
            const to = byKey.get(l.to);
            const [fromBlock, toBlock] = [blockOf(l.from), blockOf(l.to)];
            const ends = from && to && !(fromBlock && fromBlock === toBlock) ? linkEnds(l, from, to, shown, tabsOf[l.from], compact) : null;
            if (ends && fromBlock) {
                ends.a = collapsedEnd(fromBlock.live, 'from');
            }
            if (ends && toBlock) {
                ends.b = collapsedEnd(toBlock.live, 'to');
            }
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

    const isSelectedLink = (l: FlowLink) =>
        selected !== null && (l.kind === 'action' ? selected.kind === 'node' && selected.key === l.to : selected.kind === 'link' && selected.key === l.key);
    const markerUrl = (token: string) => `url(#${uid}-arrow-${token})`;

    const help = readOnly
        ? 'Job flow. Tab to a node, Enter to select it, F to frame all.'
        : 'Job flow. Tab to a node, Enter to select it, Shift+Space to add it to the selection, + to choose what happens next, arrow keys to move it, Delete to remove it, / to add a node, F to frame all.';

    return (
        <div>
            <CanvasToolbar
                canEdit={!readOnly}
                onAddNode={onQuickAdd ? () => openQuickAdd(true) : undefined}
                onTidy={onTidy}
                onGroup={onGroup ? () => onGroup(selectedKeys(selected)) : undefined}
                canGroup={selectedKeys(selected).length > 0}
                onZoom={(f) => (userView(), setZoom((z) => clampZoom(z * f)))}
                onReset={() => (userView(), setZoom(1), setPan({ x: 0, y: 0 }))}
                onFrame={frameAll}
                legendOpen={legendOpen}
                onToggleLegend={() => setLegendOpen((o) => !o)}
                gridOn={gridOn}
                onToggleGrid={toggleGrid}
                compact={compact}
                onToggleCompact={toggleCompact}
                fullScreen={fullScreen}
                onToggleFullScreen={onToggleFullScreen}
                onFollow={!follow ? onFollow : undefined}
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
                {(lineStates || running) && <LiveStyles />}
                <g data-view="true" transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                    {gridOn && <GridDots uid={uid} pan={pan} zoom={zoom} width={size.w} height={size.h} theme={theme} />}
                    {groupView.map((v) => (
                        <GroupFrame
                            key={v.grp.id}
                            group={v.live}
                            collapsed={v.collapsed}
                            members={v.members}
                            selected={selectedGroup === v.grp.id}
                            theme={theme}
                            onTitleDown={readOnly ? undefined : (ev) => g.startGroup(ev, v.grp.id, 'move')}
                            onResizeDown={readOnly || !onGroupResize ? undefined : (ev) => g.startGroup(ev, v.grp.id, 'resize')}
                            onTitleDouble={readOnly || !onGroupTitle ? undefined : () => onGroupTitle(v.grp.id)}
                        />
                    ))}
                    <FlowLines
                        lines={linkGeometry}
                        graph={graph}
                        theme={theme}
                        zoom={zoom}
                        spliceLink={spliceLink}
                        isSelected={isSelectedLink}
                        markerUrl={markerUrl}
                        onSelect={selectLink}
                        onPick={pickLine}
                        lineStates={lineStates}
                        lineLabels={lineLabels}
                        motion={motion}
                    />
                    {gesture && gesture.kind === 'line' && cursor && (
                        <DraftLine node={byKey.get(gesture.from)} at={shown[gesture.from]} tabs={tabsOf[gesture.from] || []} outcome={gesture.outcome} to={cursor} theme={theme} compact={compact} />
                    )}
                    <FlowNodes
                        nodes={visible.nodes}
                        shown={shown}
                        look={look}
                        chosen={chosen}
                        tabsOf={tabsOf}
                        theme={theme}
                        compact={compact}
                        readOnly={readOnly}
                        canMove={canMove}
                        onHover={(key, on) => setHovered((k) => (on ? key : k === key ? null : k))}
                        onNodeDown={g.startNode}
                        onLineDown={g.startLine}
                        running={runningSet}
                        motion={motion}
                    />
                    {/* Focus targets for groups, after the nodes and before the lines. */}
                    {!readOnly && groupView.map((v) => <GroupFocus key={v.grp.id} group={v.live} collapsed={v.collapsed} members={v.members} selected={selectedGroup === v.grp.id} />)}
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
                    {compact && <NodeOverlays nodes={visible.nodes} shown={shown} look={look} chosen={chosen} hovered={hovered} theme={theme} tabsOf={tabsOf} readOnly={readOnly} running={runningSet} motion={motion} />}
                    {guides.length > 0 && <GuideLines guides={guides} theme={theme} />}
                    {gesture && gesture.kind === 'box' && gesture.moved && cursor && <SelectionBox from={gesture.start} to={cursor} theme={theme} />}
                </g>
            </svg>
            {legendOpen && (
                <div style={{ position: 'absolute', top: 8, right: 8 }}>
                    <Legend />
                </div>
            )}
            {exceedsView(visible, shown, zoom, size.w, size.h, compact) && (
                <Minimap graph={visible} positions={shown} pan={pan} zoom={zoom} width={size.w} height={size.h} onPan={(p) => (userView(), setPan(p))} compact={compact} />
            )}
            {overlay}
            </div>
        </div>
    );
}
