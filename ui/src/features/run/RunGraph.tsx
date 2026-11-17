/* The run's flow: the builder's node editor, read-only, each node marked with its state. Groups
 * are drawn too, always expanded, so running steps are never hidden. While the run is active the
 * graph is live: lines show what fired, what flows into a running step and what will not fire
 * (runFlow), finished search steps put their row counts on their data lines, running steps get
 * a pulsing outline, a spinner and a timer, waiting steps are dimmed and (while the run is
 * active) say what they wait for,
 * and actions show their live text ("Retrying in 30 s"). `now` is the page's one-second clock.
 * The canvas follows the running steps until the user pans, zooms or selects a step; "Follow the run" turns it
 * back on. A finished run shows the final picture with no animation. */
import React, { useEffect, useMemo, useState } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { ActionRun, JobDefinition, StepStatus } from '../../api/types';
import { isStepDelayed, statusIcon, statusLabel } from '../../components/StatusText';
import { formatClock, formatElapsed } from '../../format';
import FlowCanvas, { FlowSelection } from '../builder/FlowCanvas';
import useCompactPref from '../builder/useCompactPref';
import { layoutFlow } from '../builder/flowLayout';
import { readGroups } from '../builder/groups';
import { buildGraph, stepKey } from '../builder/nodeModel';
import type { Theme } from '../builder/GraphView';
import type { Detail } from '../builder/FlowNodeView';
import { actionLiveText, actionStates, actionStatusIcon } from './actionStates';
import { lineStates, LineState, rowLabels, waitingFor } from './runFlow';

export interface RunGraphProps {
    definition: JobDefinition;
    states: Record<string, StepStatus | undefined>;
    actions: ActionRun[];
    onSelect?: (stepId: string) => void;
    selected?: string | null;
    /** The run is queued, running, paused or blocked: animate and follow. */
    active?: boolean;
    /** Epoch seconds (useNow), for timers and countdowns. */
    now?: number;
}

const RUNNING = ['running', 'starting'];
const FINISHED = ['succeeded', 'failed', 'skipped'];

export default function RunGraph({ definition, states, actions, onSelect, selected = null, active = false, now = Math.floor(Date.now() / 1000) }: RunGraphProps) {
    const theme = useSplunkTheme() as unknown as Theme;
    const graph = useMemo(() => buildGraph(definition), [definition]);
    const [compact, toggleCompact] = useCompactPref();
    // Selecting a step (here or in the timeline) turns follow off, so the next poll never pans
    // away from the step just revealed.
    const [follow, setFollow] = useState(!selected);
    useEffect(() => {
        if (selected) {
            setFollow(false);
        }
    }, [selected]);
    const positions = useMemo(() => layoutFlow(graph, definition.layout?.nodes, compact), [graph, definition, compact]);
    const groups = useMemo(() => readGroups(definition), [definition]);
    const acts = useMemo(() => actionStates(definition, actions), [definition, actions]);
    const running = useMemo(
        () => (active ? (definition.steps || []).filter((s) => RUNNING.includes(states[s.id]?.state || '')).map((s) => stepKey(s.id)) : []),
        [definition, states, active]
    );
    const lines = useMemo(() => {
        const out: Record<string, LineState> = lineStates(definition, states, graph, acts);
        if (!active) {
            // The final picture: nothing flows any more.
            Object.keys(out).forEach((k) => {
                out[k] = out[k] === 'flowing' ? 'fired' : out[k];
            });
        }
        return out;
    }, [definition, states, graph, acts, active]);
    const labels = useMemo(() => rowLabels(definition, states, graph), [definition, states, graph]);
    const status = useMemo(() => {
        const out: Record<string, Detail> = {};
        (definition.steps || []).forEach((s) => {
            const st = states[s.id];
            const state = st ? st.state : 'waiting';
            const delayed = st ? isStepDelayed(st) : false;
            const Icon = statusIcon(state, delayed);
            let color: string | undefined;
            if (delayed) {
                color = theme.statusColorMedium;
            } else if (state === 'failed') {
                color = theme.statusColorHigh;
            }
            let text = statusLabel(state, delayed, st && st.skip_kind);
            if (st && FINISHED.includes(state) && st.started_at && st.ended_at) {
                text = `${text} · ${formatElapsed(st.ended_at - st.started_at)}`;
            }
            // Only a live run waits; a finished one just shows the state it was left in.
            const wait = active ? waitingFor(definition, states, s.id) : null;
            const isRunning = active && RUNNING.includes(state);
            out[stepKey(s.id)] = {
                text: wait || text,
                icon: <Icon aria-hidden width={24} height={24} />,
                color,
                dim: state === 'waiting' || state === 'ready' || state === 'skipped',
                timer: isRunning && st && st.started_at ? formatClock(now - st.started_at) : undefined,
            };
        });
        Object.keys(acts).forEach((key) => {
            const Icon = actionStatusIcon(acts[key]);
            out[key] = {
                text: actionLiveText(acts[key], now),
                icon: <Icon aria-hidden width={24} height={24} />,
                color: acts[key].state === 'failed' ? theme.statusColorHigh : undefined,
            };
        });
        return out;
    }, [definition, states, acts, theme, now, active]);
    const selection: FlowSelection = selected ? { kind: 'node', key: stepKey(selected) } : null;
    const handle = (sel: FlowSelection) => {
        if (sel && sel.kind === 'node' && sel.key.startsWith('step:') && onSelect) {
            onSelect(sel.key.slice('step:'.length));
        }
    };
    return (
        <FlowCanvas
            graph={graph}
            positions={positions}
            selected={selection}
            issues={[]}
            readOnly
            compact={compact}
            onToggleCompact={toggleCompact}
            status={status}
            onSelect={handle}
            groups={groups}
            lineStates={lines}
            lineLabels={labels}
            running={running}
            follow={active && follow}
            onUserView={() => setFollow(false)}
            onFollow={active ? () => setFollow(true) : undefined}
        />
    );
}
