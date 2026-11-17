/* The run's flow: the builder's node editor, read-only, each node marked with its state. Groups
 * are drawn too, always expanded, so running steps are never hidden. */
import React, { useMemo } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { ActionRun, JobDefinition, StepStatus } from '../../api/types';
import { isStepDelayed, statusIcon, statusLabel } from '../../components/StatusText';
import FlowCanvas, { FlowSelection } from '../builder/FlowCanvas';
import useCompactPref from '../builder/useCompactPref';
import { layoutFlow } from '../builder/flowLayout';
import { readGroups } from '../builder/groups';
import { buildGraph, stepKey } from '../builder/nodeModel';
import type { Theme } from '../builder/GraphView';
import { actionStates, actionStatusIcon, actionStatusText } from './actionStates';

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
    const [compact, toggleCompact] = useCompactPref();
    const positions = useMemo(() => layoutFlow(graph, definition.layout?.nodes, compact), [graph, definition, compact]);
    const groups = useMemo(() => readGroups(definition), [definition]);
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
            const Icon = actionStatusIcon(acts[key]);
            out[key] = {
                text: actionStatusText(acts[key]),
                icon: <Icon aria-hidden width={24} height={24} />,
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
    return <FlowCanvas graph={graph} positions={positions} selected={selection} issues={[]} readOnly compact={compact} onToggleCompact={toggleCompact} status={status} onSelect={handle} groups={groups} />;
}
