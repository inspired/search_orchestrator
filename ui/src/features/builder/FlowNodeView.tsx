/* The flow canvas's nodes: each node's group (shape, detail line, + handle and outcome tabs) with
 * its accessible name, and, for compact nodes, the full-node overlay shown on hover or selection.
 * The overlay is drawn in its own layer after every node (`NodeOverlays`), taking no pointer
 * events, so a later node never paints over it; a drawn-only copy of the node's + and tabs goes
 * over the overlay (the real ones, right below, still take the pointer). The detail line shows, in order: run status,
 * issues, or the step's preview (rows and time with a bar, "Previewing…", "Preview failed: …" or a
 * muted "Out of date"). */
import React from 'react';
import CrossCircle from '@splunk/react-icons/CrossCircle';
import ExclamationTriangle from '@splunk/react-icons/ExclamationTriangle';
import type { Issue } from '../../api/types';
import { issuesByStep, Positions } from './graphLogic';
import { NodeGroup, Theme } from './GraphView';
import type { FlowNode, PortId } from './nodeModel';
import { barFraction, previewLine, PreviewSummary } from './nodePreview';
import { FAMILY_OF, FAMILY_STYLE, hasHandle } from './nodeStyle';
import { NodeShape, NodeShapeProps } from './NodeShape';
import PlusHandle from './PlusHandle';

export interface Detail {
    text: string;
    icon?: React.ReactNode;
    color?: string;
}

export type NodeStatus = Record<string, Detail | undefined>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export interface NodeLookOptions {
    issues: Issue[];
    status?: NodeStatus;
    previews: Record<string, PreviewSummary | undefined>;
    /** The largest previewed row count on the canvas, for the bars. */
    mostRows: number;
    theme: Theme;
}

/** How each node looks: its detail line, its accessible name and the NodeShape props of its preview. */
export function nodeLook({ issues, status, previews, mostRows, theme }: NodeLookOptions) {
    const byStep = issuesByStep(issues);
    return (n: FlowNode) => {
        const mine = n.stepId ? byStep[n.stepId] || [] : [];
        const errors = mine.filter((i) => i.level === 'error').length;
        const warnings = mine.length - errors;
        const counts = [errors ? plural(errors, 'error') : '', warnings ? plural(warnings, 'warning') : ''].filter(Boolean);
        const st = status ? status[n.key] : undefined;
        let detail: Detail | null = null;
        if (st) {
            detail = st;
        } else if (errors) {
            detail = { text: counts[0], icon: <CrossCircle aria-hidden width={24} height={24} />, color: theme.statusColorHigh };
        } else if (warnings) {
            detail = { text: counts[0], icon: <ExclamationTriangle aria-hidden width={24} height={24} />, color: theme.statusColorMedium };
        }
        const preview = n.stepId ? previews[n.stepId] : undefined;
        const line = previewLine(preview);
        // Issues and run status keep the detail line; a preview takes it otherwise.
        const lineColor = line && line.failed ? theme.statusColorHigh : line && line.muted ? theme.contentColorDisabled : undefined;
        const previewProps: Partial<NodeShapeProps> = {
            status: detail ? detail.text : line ? line.text : undefined,
            statusIcon: detail ? detail.icon : line && line.failed ? <CrossCircle aria-hidden width={24} height={24} /> : undefined,
            statusColor: detail ? detail.color : lineColor,
            previewId: n.stepId,
            bar: n.stepId ? barFraction(preview, mostRows) : 0,
        };
        const family = FAMILY_STYLE[FAMILY_OF[n.kind]].label;
        const head = family === n.label ? n.label : `${family} ${n.label}`;
        const label = [head, st ? st.text : n.detail, ...counts, line ? line.text : ''].filter(Boolean).join(', ');
        return { detail, label, previewProps };
    };
}

type Look = ReturnType<ReturnType<typeof nodeLook>>;

export interface FlowNodesProps {
    nodes: FlowNode[];
    shown: Positions;
    look: (n: FlowNode) => Look;
    chosen: Set<string>;
    tabsOf: Record<string, PortId[]>;
    theme: Theme;
    compact: boolean;
    readOnly: boolean;
    canMove: boolean;
    /** The pointer entered (true) or left (false) node `key`. */
    onHover: (key: string, on: boolean) => void;
    onNodeDown: (ev: React.PointerEvent, key: string) => void;
    onLineDown: (ev: React.PointerEvent, key: string, outcome?: PortId) => void;
}

export function FlowNodes({ nodes, shown, look, chosen, tabsOf, theme, compact, readOnly, canMove, onHover, onNodeDown, onLineDown }: FlowNodesProps) {
    return (
        <>
            {nodes.map((n) => {
                const p = shown[n.key];
                if (!p) {
                    return null;
                }
                const isSelected = chosen.has(n.key);
                const { detail, label, previewProps } = look(n);
                return (
                    <NodeGroup
                        key={n.key}
                        data-testid={`node-${n.key}`}
                        data-node-key={n.key}
                        transform={`translate(${p.x},${p.y})`}
                        role="button"
                        tabIndex={0}
                        aria-label={label}
                        aria-pressed={isSelected}
                        onPointerEnter={() => onHover(n.key, true)}
                        onPointerLeave={() => onHover(n.key, false)}
                        onPointerDown={(ev) => {
                            ev.stopPropagation();
                            onNodeDown(ev, n.key);
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
                        {hasHandle(n.kind) && (
                            <PlusHandle
                                nodeKey={n.key}
                                kind={n.kind}
                                theme={theme}
                                tabs={tabsOf[n.key] || []}
                                plus={!readOnly}
                                compact={compact}
                                onPlusDown={readOnly ? undefined : (ev) => onLineDown(ev, n.key)}
                                onTabDown={readOnly ? undefined : (ev, outcome) => onLineDown(ev, n.key, outcome)}
                            />
                        )}
                    </NodeGroup>
                );
            })}
        </>
    );
}

export interface NodeOverlaysProps {
    nodes: FlowNode[];
    shown: Positions;
    look: (n: FlowNode) => Look;
    chosen: Set<string>;
    hovered: string | null;
    theme: Theme;
    tabsOf: Record<string, PortId[]>;
    readOnly: boolean;
}

/** Compact nodes: the full node over the hovered or selected ones, above every node. */
export function NodeOverlays({ nodes, shown, look, chosen, hovered, theme, tabsOf, readOnly }: NodeOverlaysProps) {
    return (
        <>
            {nodes.map((n) => {
                const p = shown[n.key];
                const isSelected = chosen.has(n.key);
                if (!p || n.kind === 'condition' || !(hovered === n.key || isSelected)) {
                    return null;
                }
                const { detail, previewProps } = look(n);
                return (
                    <g key={n.key} data-testid={`node-full-${n.key}`} transform={`translate(${p.x},${p.y})`} pointerEvents="none" aria-hidden>
                        <NodeShape node={n} theme={theme} selected={isSelected} stroke={detail ? detail.color : undefined} {...previewProps} />
                        {hasHandle(n.kind) && <PlusHandle nodeKey={n.key} kind={n.kind} theme={theme} tabs={tabsOf[n.key] || []} plus={!readOnly} compact testIdPrefix="overlay-" />}
                    </g>
                );
            })}
        </>
    );
}
