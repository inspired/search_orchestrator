/* A minimal read-only graph of the run's steps: layered left to right, each node marked
 * with its state. Task 12's shared GraphView replaces this behind the same props. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Edge, StepStatus } from '../../api/types';
import { isStepDelayed, statusLabel } from '../../components/StatusText';

export interface GraphNode {
    id: string;
    label: string;
}

export interface RunGraphProps {
    nodes: GraphNode[];
    edges: Pick<Edge, 'from' | 'to'>[];
    states: Record<string, StepStatus | undefined>;
    onSelect?: (id: string) => void;
}

const W = 150;
const H = 36;
const GAP_X = 60;
const GAP_Y = 20;

/** Longest-path layer per node; a cycle (which the server rejects) is cut at 0. */
export function layers(nodes: GraphNode[], edges: Pick<Edge, 'from' | 'to'>[]): Record<string, number> {
    const level: Record<string, number> = {};
    const visiting = new Set<string>();
    const depth = (id: string): number => {
        if (level[id] !== undefined) {
            return level[id];
        }
        if (visiting.has(id)) {
            return 0;
        }
        visiting.add(id);
        const preds = edges.filter((e) => e.to === id).map((e) => e.from);
        level[id] = preds.length ? Math.max(...preds.map(depth)) + 1 : 0;
        visiting.delete(id);
        return level[id];
    };
    nodes.forEach((n) => depth(n.id));
    return level;
}

export default function RunGraph({ nodes, edges, states, onSelect }: RunGraphProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const level = layers(nodes, edges);
    const rowOf: Record<string, number> = {};
    const counts: Record<number, number> = {};
    nodes.forEach((n) => {
        const l = level[n.id] || 0;
        rowOf[n.id] = counts[l] || 0;
        counts[l] = (counts[l] || 0) + 1;
    });
    const pos = (id: string) => ({
        x: 10 + (level[id] || 0) * (W + GAP_X),
        y: 10 + rowOf[id] * (H + GAP_Y),
    });
    const maxLevel = Math.max(0, ...Object.values(level));
    const maxRows = Math.max(1, ...Object.values(counts));
    const width = 20 + (maxLevel + 1) * W + maxLevel * GAP_X;
    const height = 20 + maxRows * H + (maxRows - 1) * GAP_Y;

    return (
        <svg
            role="img"
            aria-label="Step graph"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            style={{ maxWidth: '100%' }}
        >
            {edges.map((e) => {
                if (!rowOf.hasOwnProperty(e.from) || !rowOf.hasOwnProperty(e.to)) {
                    return null;
                }
                const a = pos(e.from);
                const b = pos(e.to);
                return (
                    <path
                        key={`${e.from}>${e.to}`}
                        data-testid="edge"
                        d={`M${a.x + W},${a.y + H / 2} C${a.x + W + GAP_X / 2},${a.y + H / 2} ${b.x - GAP_X / 2},${b.y + H / 2} ${b.x},${b.y + H / 2}`}
                        fill="none"
                        stroke={theme.borderColorStrong}
                        strokeWidth={1.5}
                    />
                );
            })}
            {nodes.map((n) => {
                const p = pos(n.id);
                const st = states[n.id];
                const delayed = st ? isStepDelayed(st) : false;
                let stroke = theme.borderColorStrong;
                if (delayed) {
                    stroke = theme.statusColorMedium;
                } else if (st && st.state === 'failed') {
                    stroke = theme.statusColorHigh;
                }
                return (
                    <g
                        key={n.id}
                        data-testid={`node-${n.id}`}
                        transform={`translate(${p.x},${p.y})`}
                        onClick={onSelect ? () => onSelect(n.id) : undefined}
                        style={{ cursor: onSelect ? 'pointer' : undefined }}
                    >
                        <rect width={W} height={H} rx={4} fill={theme.backgroundColorSection} stroke={stroke} strokeWidth={1.5} />
                        <text x={8} y={15} fontSize={12} fill={theme.contentColorDefault}>
                            {n.label}
                        </text>
                        <text x={8} y={29} fontSize={11} fill={theme.contentColorMuted}>
                            {st ? statusLabel(st.state, delayed, st.skip_kind) : 'Waiting'}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}
