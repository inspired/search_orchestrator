/* The Flow tab's popups and what they do: the When list (from a node's +, or a line dropped on a
 * node or on empty canvas), the node search (quick-add), and a line's menu (change outcome,
 * insert a node, remove) and the right-click menu (CanvasMenu: a node, a multi-selection or the
 * empty canvas; its items run the page's `context` actions). Also the short message after a node is put on a line, with Undo, which
 * hides itself after 10 s, or once the job is edited again. Returns the overlay to draw over the
 * canvas, that message, and the canvas callbacks. Popups take focus; closing one with Escape
 * gives focus back to where it was. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Message from '@splunk/react-ui/Message';
import type { JobDefinition } from '../../api/types';
import type { FlowSelection, ScreenPoint } from './FlowCanvas';
import { canInsert, parseCond } from './flowEdits';
import type { Pos, Positions } from './graphLogic';
import CanvasMenu from './CanvasMenu';
import type { MenuItem } from './CanvasMenu';
import type { ContextTarget } from './useContextTrigger';
import LineMenu, { LineChoice } from './LineMenu';
import { targetKinds } from './nodeCatalog';
import { JOB_KEY, condKey } from './nodeModel';
import type { FlowGraph, FlowLink, NodeKind, PortId } from './nodeModel';
import { PORT_STYLE, hasHandle } from './nodeStyle';
import { OUTCOME_LABEL, lineMenuOutcomes, whenOptions } from './outcomes';
import type { Outcome } from './outcomes';
import QuickAdd from './QuickAdd';
import { addNodeKey } from './reducer';
import type { BuilderAction } from './reducer';
import { canSplice, spliceMessage } from './splice';
import WhenMenu from './WhenMenu';

/** How long the message after a splice stays. */
export const SPLICE_MESSAGE_MS = 10000;
const POPUP_W = 320;
const LINE_MENU_W = 240;
const ROW_H = 32;
/** The When list's heading and padding. */
const WHEN_CHROME = 34;
/** The node search: its box and the list below it (at most 320 px). */
const SEARCH_H = 370;

/** An open quick-add box: which kinds it offers, the line it continues, and where. */
export interface QuickAddState {
    kinds?: NodeKind[];
    from?: { key: string; port: PortId };
    /** Canvas point for the new node; none lets the layout place it. */
    at?: Pos;
    /** Without `at`: put the new node in the first free spot right of this node. */
    rightOf?: string;
    /** Put the new node on this step-to-step line instead. */
    insert?: string;
    screen: ScreenPoint;
}

type Menu =
    | ({ kind: 'quick' } & QuickAddState)
    /** With `to`, choosing connects to it; otherwise the node search follows. */
    | { kind: 'when'; from: string; to?: string; at?: Pos; screen: ScreenPoint }
    | { kind: 'line'; link: string; screen: ScreenPoint }
    | { kind: 'context'; target: Exclude<ContextTarget, { kind: 'link' }>; screen: ScreenPoint };

/** What the right-click menu's items do; the page supplies these. */
export interface ContextActions {
    /** Selects the step and focuses the properties panel's name field. */
    rename: (key: string) => void;
    duplicate: () => void;
    copy: () => void;
    paste: (at: Pos) => void;
    /** With keys, tidies only those nodes. */
    tidy: (keys?: string[]) => void;
    requestRemove: (key: string) => void;
    requestRemoveNodes: (keys: string[]) => void;
    /** Absent when previews are off (no edit rights). */
    preview?: (stepId: string) => void;
    /** Why the step can't be previewed, or null. */
    previewRefusal?: (stepId: string) => string | null;
}

export interface FlowMenusOptions {
    job: JobDefinition;
    graph: FlowGraph;
    positions: Positions;
    dispatch: React.Dispatch<BuilderAction>;
    /** Sets the selection without closing the popups. */
    select: (sel: FlowSelection) => void;
    /** Focus this node (or the canvas) once the popup has closed. */
    focusNode: (key: string | null) => void;
    connectLine: (from: string, port: PortId, to: string) => void;
    /** Where focus goes back to; set by `rememberFocus` when a popup opens. */
    returnFocus: React.MutableRefObject<HTMLElement | null>;
    rememberFocus: () => void;
    /** The canvas element, to keep popups inside it. */
    canvas: () => Element | null;
    context: ContextActions;
}

/** `screen` moved so a `w` × `h` box stays inside the canvas (only left and top when unknown). */
function clampInto(screen: ScreenPoint, w: number, h: number, canvas: Element | null): ScreenPoint {
    const cw = canvas ? canvas.clientWidth : 0;
    const ch = canvas ? canvas.clientHeight : 0;
    const left = cw ? Math.min(screen.left, cw - w) : screen.left;
    const top = ch ? Math.min(screen.top, ch - h) : screen.top;
    return { left: Math.max(0, left), top: Math.max(0, top) };
}

/** The step kinds that "Insert a node" can put on `link`. */
function insertKinds(job: JobDefinition, graph: FlowGraph, link: FlowLink): NodeKind[] {
    if (link.kind !== 'edge' || !link.port) {
        return [];
    }
    const from = graph.nodes.find((n) => n.key === link.from);
    return targetKinds(link.port, from ? from.kind : null).filter((kind) => canInsert(job, link.key, kind));
}

export default function useFlowMenus(opts: FlowMenusOptions) {
    const { job, graph, positions, dispatch, select, focusNode, connectLine, returnFocus, rememberFocus, canvas, context } = opts;
    const [menu, setMenu] = useState<Menu | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    /** The job just before the splice the message is about, then the job just after it: if the
     * splice changed nothing, or once the job is edited again, the message goes. */
    const messageJob = useRef<{ before: JobDefinition; after: JobDefinition | null } | null>(null);

    useEffect(() => {
        if (!message) {
            return undefined;
        }
        const timer = window.setTimeout(() => setMessage(null), SPLICE_MESSAGE_MS);
        return () => window.clearTimeout(timer);
    }, [message]);
    useEffect(() => {
        const m = messageJob.current;
        if (!message || !m) {
            return;
        }
        if (m.after === null && m.before !== job) {
            m.after = job;
        } else if (m.after !== job) {
            setMessage(null);
        }
    }, [job, message]);
    const showMessage = (text: string) => {
        messageJob.current = { before: job, after: null };
        setMessage(text);
    };

    const kindOf = (key: string) => graph.nodes.find((n) => n.key === key)?.kind;

    const open = (next: Menu) => {
        rememberFocus();
        setMenu(next);
    };
    const openQuick = (state: QuickAddState) => {
        if (!state.kinds || state.kinds.length) {
            open({ kind: 'quick', ...state });
        }
    };
    /** Closes the popup and gives focus back to where it was (or the canvas). */
    const finish = () => {
        setMenu(null);
        const back = returnFocus.current;
        returnFocus.current = null;
        if (back && back.isConnected && back !== document.body) {
            back.focus();
        } else {
            focusNode(null);
        }
    };

    const addNode = (kind: NodeKind, q: QuickAddState) => {
        returnFocus.current = null;
        setMenu(null);
        if (q.insert) {
            const link = graph.links.find((l) => l.key === q.insert);
            const key = addNodeKey(job, kind);
            const a = link && positions[link.from];
            const b = link && positions[link.to];
            const at = a && b ? { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) } : undefined;
            const id = key.slice('step:'.length);
            if (canInsert(job, q.insert, kind)) {
                showMessage(spliceMessage({ ...job, steps: [...(job.steps || []), { id, name: '', type: 'inline' }] }, key, q.insert));
            }
            dispatch({ type: 'insertNode', kind, link: q.insert, at, shown: at ? positions : undefined });
            select({ kind: 'node', key });
            focusNode(key);
            return;
        }
        const key = addNodeKey(job, kind, q.from);
        dispatch({ type: 'addNode', kind, at: q.at, from: q.from, rightOf: q.rightOf, shown: q.at || q.rightOf ? positions : undefined });
        if (key) {
            select({ kind: 'node', key });
            focusNode(key);
        }
    };

    const onPlus = (from: string, screen: ScreenPoint) => {
        const kind = kindOf(from);
        // A condition already leads somewhere; its line is moved by dragging, not continued.
        if (kind && kind !== 'condition') {
            open({ kind: 'when', from, screen });
        }
    };

    const onDropOnNode = (from: string, to: string, screen: ScreenPoint, outcome?: PortId) => {
        if (kindOf(from) === 'condition' || outcome) {
            connectLine(from, outcome || 'then', to);
            return;
        }
        const options = whenOptions(job, from, to);
        if (options.length === 1) {
            connectLine(from, options[0].outcome, to);
        } else {
            open({ kind: 'when', from, to, screen });
        }
    };

    const onDropOnCanvas = (from: string, at: Pos, screen: ScreenPoint, outcome?: PortId) => {
        const kind = kindOf(from);
        if (!kind || kind === 'condition') {
            return;
        }
        if (outcome) {
            openQuick({ kinds: targetKinds(outcome, kind), from: { key: from, port: outcome }, at, screen });
        } else {
            open({ kind: 'when', from, at, screen });
        }
    };

    const onContext = (target: ContextTarget, screen: ScreenPoint) =>
        target.kind === 'link' ? open({ kind: 'line', link: target.key, screen }) : open({ kind: 'context', target, screen });

    /** The items of the right-click menu for a node, a multi-selection or the canvas. */
    const contextItems = (target: Exclude<ContextTarget, { kind: 'link' }>): { label: string; items: MenuItem[]; run: (id: string, screen: ScreenPoint) => void } => {
        const leave = (then: () => void) => () => {
            finish();
            then();
        };
        if (target.kind === 'canvas') {
            return {
                label: 'Canvas',
                items: [
                    { id: 'add', label: 'Add node here' },
                    { id: 'paste', label: 'Paste' },
                    { id: 'tidy', label: 'Tidy up' },
                ],
                run: (id, screen) => {
                    if (id === 'add') {
                        setMenu({ kind: 'quick', at: target.at, screen });
                    } else {
                        leave(id === 'paste' ? () => context.paste(target.at) : () => context.tidy())();
                    }
                },
            };
        }
        if (target.kind === 'nodes') {
            return {
                label: 'Selected nodes',
                items: [
                    { id: 'duplicate', label: 'Duplicate' },
                    { id: 'copy', label: 'Copy' },
                    { id: 'tidy', label: 'Tidy up selection' },
                    { id: 'remove', label: 'Remove nodes' },
                ],
                run: (id) =>
                    leave({ duplicate: context.duplicate, copy: context.copy, tidy: () => context.tidy(target.keys), remove: () => context.requestRemoveNodes(target.keys) }[id] || (() => undefined))(),
            };
        }
        const node = graph.nodes.find((n) => n.key === target.key);
        const kind = node ? node.kind : null;
        const copyable = Boolean(node) && kind !== 'job' && kind !== 'condition';
        const refusal = node && node.stepId && context.previewRefusal ? context.previewRefusal(node.stepId) : null;
        const items: MenuItem[] = [
            ...(node && node.stepId ? [{ id: 'rename', label: 'Rename' }] : []),
            ...(copyable ? [{ id: 'duplicate', label: 'Duplicate' }, { id: 'copy', label: 'Copy' }] : []),
            ...((kind === 'search' || kind === 'saved_search') && context.preview ? [{ id: 'preview', label: 'Preview', disabled: Boolean(refusal), reason: refusal || undefined }] : []),
            ...(kind && kind !== 'condition' && hasHandle(kind) ? [{ id: 'line', label: 'Add a line' }] : []),
            ...(target.key !== JOB_KEY ? [{ id: 'remove', label: 'Remove' }] : []),
        ];
        return {
            label: 'Node',
            items,
            run: (id, screen) => {
                const stepId = node ? node.stepId : undefined;
                if (id === 'rename') {
                    returnFocus.current = null;
                    setMenu(null);
                    context.rename(target.key);
                } else if (id === 'line') {
                    setMenu({ kind: 'when', from: target.key, screen });
                } else {
                    leave(
                        id === 'duplicate' ? context.duplicate : id === 'copy' ? context.copy : id === 'preview' ? () => stepId && context.preview?.(stepId) : () => context.requestRemove(target.key)
                    )();
                }
            },
        };
    };

    const onLineMenu = (link: string, screen: ScreenPoint) => open({ kind: 'line', link, screen });

    const onSplice = (node: string, link: string, at: Pos) => {
        if (canSplice(job, node, link).ok) {
            showMessage(spliceMessage(job, node, link));
        }
        dispatch({ type: 'splice', node, link, at, shown: positions });
    };

    const canSpliceNode = useCallback((node: string, link: string) => canSplice(job, node, link).ok, [job]);

    const chooseLine = (link: FlowLink, choice: LineChoice) => {
        if (choice.kind === 'insert') {
            setMenu({ kind: 'quick', kinds: insertKinds(job, graph, link), insert: link.key, screen: menu ? menu.screen : { left: 8, top: 8 } });
            return;
        }
        if (choice.kind === 'outcome') {
            dispatch({ type: 'changeOutcome', link: link.key, outcome: choice.outcome });
            // A line's key names its outcome: keep the changed line (or its action) selected; a
            // line turned into a condition selects the condition, to type its expression.
            if (link.kind === 'action') {
                select({ kind: 'node', key: link.to });
            } else if (link.kind === 'edge' && choice.outcome === 'if') {
                select({ kind: 'node', key: condKey(link.from.slice(5), link.to.slice(5)) });
            } else if (link.kind === 'edge') {
                select({ kind: 'link', key: `${link.from}-${choice.outcome}->${link.to}` });
            }
        } else {
            const ends = link.kind === 'condition' ? parseCond(link.from.startsWith('cond:') ? link.from : link.to) : null;
            const from = ends ? ends.from : link.from.slice('step:'.length);
            const to = ends ? ends.to : link.to.slice('step:'.length);
            dispatch({ type: 'disconnect', from, to });
        }
        finish();
    };

    let overlay: React.ReactNode = null;
    if (menu && menu.kind === 'quick') {
        overlay = (
            <QuickAdd
                open
                at={clampInto(menu.screen, POPUP_W, SEARCH_H, canvas())}
                kinds={menu.kinds}
                onChoose={(kind) => addNode(kind, menu)}
                onClose={finish}
            />
        );
    } else if (menu && menu.kind === 'when') {
        const { from, to, at } = menu;
        const fromKind = kindOf(from) || null;
        const options = whenOptions(job, from, to);
        const height = WHEN_CHROME + Math.max(1, options.length) * ROW_H + (to ? 0 : SEARCH_H);
        overlay = (
            <WhenMenu
                open
                at={clampInto(menu.screen, POPUP_W, height, canvas())}
                options={options}
                withSearch={to ? undefined : { kinds: (o: Outcome) => targetKinds(o, fromKind) }}
                onChoose={(o, kind) => {
                    if (to) {
                        connectLine(from, o, to);
                        finish();
                    } else if (kind) {
                        addNode(kind, { from: { key: from, port: o }, at, rightOf: at ? undefined : from, screen: menu.screen });
                    }
                }}
                onClose={finish}
            />
        );
    } else if (menu && menu.kind === 'line') {
        const link = graph.links.find((l) => l.key === menu.link);
        if (link) {
            const outcomes = lineMenuOutcomes(job, link)
                .filter((o) => o !== link.port)
                .map((o) => ({ outcome: o, label: OUTCOME_LABEL[o], glyph: PORT_STYLE[o].glyph }));
            const canInsert = insertKinds(job, graph, link).length > 0;
            // Actions always belong somewhere: their lines are moved, never removed.
            const canRemove = link.kind === 'edge' || link.kind === 'condition';
            const rows = outcomes.length + (canInsert ? 1 : 0) + (canRemove ? 1 : 0);
            overlay = (
                <LineMenu
                    open
                    at={clampInto(menu.screen, LINE_MENU_W, Math.max(1, rows) * ROW_H + 8, canvas())}
                    outcomes={outcomes}
                    canInsert={canInsert}
                    canRemove={canRemove}
                    onChoose={(choice) => chooseLine(link, choice)}
                    onClose={finish}
                />
            );
        }
    }

    if (menu && menu.kind === 'context') {
        const { label, items, run } = contextItems(menu.target);
        overlay = (
            <CanvasMenu open at={clampInto(menu.screen, LINE_MENU_W, items.length * ROW_H + 8, canvas())} label={label} items={items} onChoose={(id) => run(id, menu.screen)} onClose={finish} />
        );
    }

    const notice = message && (
        <div data-testid="splice-message">
            <Message type="info" appearance="default">
                <span style={{ marginRight: 8 }}>{message}</span>
                <Button
                    appearance="secondary"
                    inline
                    label="Undo"
                    onClick={() => {
                        setMessage(null);
                        dispatch({ type: 'undo' });
                    }}
                />
            </Message>
        </div>
    );

    return {
        overlay,
        notice,
        /** Closes any popup without moving focus (the selection changed). */
        close: () => setMenu(null),
        openQuick,
        onPlus,
        onDropOnNode,
        onDropOnCanvas,
        onLineMenu,
        onContext,
        onSplice,
        canSpliceNode,
        /** Shows `text` with an Undo button for 10 s (call before the edit it is about). */
        notify: showMessage,
    };
}
