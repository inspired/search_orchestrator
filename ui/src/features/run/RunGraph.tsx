/* The run's step graph: the builder's read-only GraphView, each node marked with its state. */
import React from 'react';
import type { Edge, StepStatus } from '../../api/types';
import GraphView from '../builder/GraphView';

export interface GraphNode {
    id: string;
    label: string;
}

export interface RunGraphProps {
    nodes: GraphNode[];
    edges: Pick<Edge, 'from' | 'to' | 'condition' | 'expression'>[];
    states: Record<string, StepStatus | undefined>;
    onSelect?: (id: string) => void;
    selected?: string | null;
}

export default function RunGraph({ nodes, edges, states, onSelect, selected }: RunGraphProps) {
    const steps = React.useMemo(() => nodes.map((n) => ({ id: n.id, name: n.label })), [nodes]);
    return <GraphView steps={steps} edges={edges} statusByStep={states} onSelect={onSelect} selected={selected} />;
}
