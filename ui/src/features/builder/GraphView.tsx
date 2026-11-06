/* The step graph, read-only: dagre top-to-bottom layout, each node with its name and either
 * its run status (plain text with an icon) or its step type. Used by the run page; the
 * builder's Canvas draws with the same primitives. All colour comes from theme tokens. */
import React, { useMemo } from 'react';
import styled from 'styled-components';
import { variables } from '@splunk/themes';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Edge, StepDef, StepStatus } from '../../api/types';
import { isStepDelayed, statusIcon, statusLabel } from '../../components/StatusText';
import { autoLayout, NODE_H, NODE_W, Pos, Positions } from './graphLogic';

export type Theme = Record<string, string>;

export type GraphStep = Pick<StepDef, 'id'> & Partial<Pick<StepDef, 'name' | 'type' | 'saved_search_ref'>>;
export type GraphEdge = Pick<Edge, 'from' | 'to'> & Partial<Pick<Edge, 'condition' | 'expression'>>;

/** A focusable node or edge: the keyboard focus ring is drawn on its box or line. */
export const NodeGroup = styled.g`
    outline: none;
    &:focus-visible > rect:first-of-type,
    &:focus-visible > path:first-of-type {
        stroke: ${variables.focusColor};
        stroke-width: 3px;
    }
`;

export const stepLabel = (s: GraphStep) => s.name || s.id;

/** A short label for an edge's condition; none for the default on_success. */
export function conditionLabel(e: GraphEdge): string {
    switch (e.condition) {
        case 'on_failure':
            return 'on failure';
        case 'always':
            return 'always';
        case 'expression': {
            const text = (e.expression || '').trim();
            return text.length > 24 ? `if ${text.slice(0, 23)}…` : `if ${text}`;
        }
        default:
            return '';
    }
}

/** Bottom centre of `a` to top centre of `b`. */
export function edgePath(a: Pos, b: Pos): string {
    const x1 = a.x + NODE_W / 2;
    const y1 = a.y + NODE_H;
    const x2 = b.x + NODE_W / 2;
    const y2 = b.y;
    const dy = Math.max(30, Math.abs(y2 - y1) / 2);
    return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
}

/** Bounds of the laid-out nodes, with a margin. */
export function extent(positions: Positions): { width: number; height: number } {
    const ps = Object.values(positions);
    const width = Math.max(NODE_W, ...ps.map((p) => p.x + NODE_W)) + 20;
    const height = Math.max(NODE_H, ...ps.map((p) => p.y + NODE_H)) + 20;
    return { width, height };
}

export function ArrowMarker({ id, theme }: { id: string; theme: Theme }) {
    return (
        <defs>
            <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={theme.borderColorStrong} />
            </marker>
        </defs>
    );
}

export interface EdgeLineProps {
    edge: GraphEdge;
    a: Pos;
    b: Pos;
    theme: Theme;
    markerId: string;
    selected?: boolean;
}

export function EdgeLine({ edge, a, b, theme, markerId, selected = false }: EdgeLineProps) {
    const label = conditionLabel(edge);
    const mx = (a.x + b.x) / 2 + NODE_W / 2;
    const my = (a.y + NODE_H + b.y) / 2;
    return (
        <>
            <path
                data-testid="edge"
                d={edgePath(a, b)}
                fill="none"
                stroke={selected ? theme.focusColor : theme.borderColorStrong}
                strokeWidth={selected ? 2.5 : 1.5}
                strokeDasharray={edge.condition && edge.condition !== 'on_success' ? '5 4' : undefined}
                markerEnd={`url(#${markerId})`}
            />
            {label && (
                <text x={mx + 6} y={my} fontSize={11} fill={theme.contentColorMuted} fontFamily={theme.fontFamily}>
                    {label}
                </text>
            )}
        </>
    );
}

export interface NodeBoxProps {
    step: GraphStep;
    theme: Theme;
    /** The second line, such as a status or the step type. */
    detail: React.ReactNode;
    detailColor?: string;
    icon?: React.ComponentType<React.SVGProps<SVGSVGElement> & { 'aria-hidden'?: boolean }>;
    stroke?: string;
    selected?: boolean;
}

export function NodeBox({ step, theme, detail, detailColor, icon: Icon, stroke, selected = false }: NodeBoxProps) {
    const name = stepLabel(step);
    const shown = name.length > 24 ? `${name.slice(0, 23)}…` : name;
    return (
        <>
            <rect
                width={NODE_W}
                height={NODE_H}
                rx={4}
                fill={theme.backgroundColorSection}
                stroke={selected ? theme.focusColor : stroke || theme.borderColorStrong}
                strokeWidth={selected ? 2.5 : 1.5}
            />
            <text x={10} y={20} fontSize={13} fill={theme.contentColorDefault} fontFamily={theme.fontFamily} fontWeight={theme.fontWeightSemiBold}>
                {shown}
            </text>
            {Icon && (
                <svg x={10} y={29} width={13} height={13} viewBox="0 0 24 24" style={{ color: detailColor || theme.contentColorMuted }}>
                    <Icon aria-hidden width={24} height={24} />
                </svg>
            )}
            <text
                x={Icon ? 28 : 10}
                y={40}
                fontSize={11}
                fill={detailColor || theme.contentColorMuted}
                fontFamily={theme.fontFamily}
            >
                {detail}
            </text>
        </>
    );
}

export function stepTypeLabel(step: GraphStep): string {
    if (step.type === 'saved_search') {
        return step.saved_search_ref ? `Saved search: ${step.saved_search_ref}` : 'Saved search';
    }
    return 'Search';
}

export interface GraphViewProps {
    steps: GraphStep[];
    edges: GraphEdge[];
    statusByStep?: Record<string, StepStatus | undefined>;
    onSelect?: (id: string) => void;
    selected?: string | null;
}

export default function GraphView({ steps, edges, statusByStep, onSelect, selected = null }: GraphViewProps) {
    const theme = useSplunkTheme() as unknown as Theme;
    const positions = useMemo(() => autoLayout(steps, edges), [steps, edges]);
    const { width, height } = extent(positions);
    const markerId = 'so-graph-arrow';

    return (
        <svg role="group" aria-label="Step graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: '100%' }}>
            <ArrowMarker id={markerId} theme={theme} />
            {edges.map((e) =>
                positions[e.from] && positions[e.to] ? (
                    <EdgeLine key={`${e.from}>${e.to}`} edge={e} a={positions[e.from]} b={positions[e.to]} theme={theme} markerId={markerId} />
                ) : null
            )}
            {steps.map((s) => {
                const st = statusByStep ? statusByStep[s.id] : undefined;
                const delayed = st ? isStepDelayed(st) : false;
                let color: string | undefined;
                if (delayed) {
                    color = theme.statusColorMedium;
                } else if (st && st.state === 'failed') {
                    color = theme.statusColorHigh;
                }
                const detail = statusByStep
                    ? statusLabel(st ? st.state : 'waiting', delayed, st && st.skip_kind)
                    : stepTypeLabel(s);
                const select = onSelect ? () => onSelect(s.id) : undefined;
                return (
                    <NodeGroup
                        key={s.id}
                        data-testid={`node-${s.id}`}
                        transform={`translate(${positions[s.id].x},${positions[s.id].y})`}
                        role={select ? 'button' : undefined}
                        tabIndex={select ? 0 : undefined}
                        aria-label={select ? `Step ${stepLabel(s)}, ${detail}` : undefined}
                        aria-pressed={select ? selected === s.id : undefined}
                        onClick={select}
                        onKeyDown={
                            select
                                ? (ev) => {
                                      if (ev.key === 'Enter' || ev.key === ' ') {
                                          ev.preventDefault();
                                          select();
                                      }
                                  }
                                : undefined
                        }
                        style={{ cursor: select ? 'pointer' : undefined }}
                    >
                        <NodeBox
                            step={s}
                            theme={theme}
                            detail={detail}
                            detailColor={color}
                            icon={statusByStep ? statusIcon(st ? st.state : 'waiting', delayed) : undefined}
                            stroke={color}
                            selected={selected === s.id}
                        />
                    </NodeGroup>
                );
            })}
        </svg>
    );
}
