/* The run's flow: the builder's node editor, read-only, each node marked with its state. */
import React, { useMemo } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { ActionRun, JobDefinition, StepStatus } from '../../api/types';
import { isStepDelayed, statusIcon, statusLabel } from '../../components/StatusText';
import FlowCanvas, { FlowSelection } from '../builder/FlowCanvas';
import { layoutFlow } from '../builder/flowLayout';
import { buildGraph, stepKey } from '../builder/nodeModel';
import type { Theme } from '../builder/GraphView';
import { actionStates, actionStatusText } from './actionStates';

export interface RunGraphProps {
    definition: JobDefinition;
    states: Record<string, StepStatus | undefined>;
    actions: ActionRun[];
    onSelect?: (stepId: string) => void;
    selected?: string | null;
}

type Status = { text: string; icon?: React.ReactNode; color?: string };

export default function RunGraph({ definition, states, actions, onSelect, selected = null }: RunGraphProps) {
    const theme = useSplunkTheme() as unknown as Theme;
    const graph = useMemo(() => buildGraph(definition), [definition]);
    const positions = useMemo(() => layoutFlow(graph, definition.layout?.nodes), [graph, definition]);
    const status = useMemo(() => {
        const out: Record<string, Status> = {};
        (definition.steps || []).forEach((s) => {
            const st = states[s.id];
            const delayed = st ? isStepDelayed(st) : false;
            const Icon = statusIcon(st ? st.state : 'waiting', delayed);
            let color: string | undefined;
            if (delayed) {
                color = theme.statusColorMedium;
            } else if (st && st.state === 'failed') {
                color = theme.statusColorHigh;
            }
            out[stepKey(s.id)] = {
                text: statusLabel(st ? st.state : 'waiting', delayed, st && st.skip_kind),
                icon: <Icon aria-hidden width={24} height={24} />,
                color,
            };
        });
        const acts = actionStates(definition, actions);
        Object.keys(acts).forEach((key) => {
            out[key] = {
                text: actionStatusText(acts[key]),
                color: acts[key].state === 'failed' ? theme.statusColorHigh : undefined,
            };
        });
        return out;
    }, [definition, states, actions, theme]);
    const selection: FlowSelection = selected ? { kind: 'node', key: stepKey(selected) } : null;
    const handle = (sel: FlowSelection) => {
        if (sel && sel.kind === 'node' && sel.key.startsWith('step:') && onSelect) {
            onSelect(sel.key.slice('step:'.length));
        }
    };
    return <FlowCanvas graph={graph} positions={positions} selected={selection} issues={[]} readOnly status={status} onSelect={handle} />;
}
