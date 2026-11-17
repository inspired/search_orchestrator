/* The Flow tab's side panel: the editor for whatever is selected on the canvas (a step, an
 * action, a trigger, a condition, a step-to-step line, the whole job, several nodes or a group), or a hint
 * when nothing is. Each editor is keyed by the selection so its drafts never carry over to another node. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { AlertAction, Destination, Issue, Job, JobDefinition, PreviewInput } from '../../api/types';
import ActionPanel from './ActionPanel';
import type { BuilderApi } from './BuilderPage';
import EdgePanel from './EdgePanel';
import { issuesForAction } from './issueTabs';
import type { FlowSelection } from './FlowCanvas';
import OutputPanel from './OutputPanel';
import JobNodePanel from './JobNodePanel';
import { FlowGraph, JOB_KEY, stepKey } from './nodeModel';
import type { BuilderAction } from './reducer';
import type { NextSlots } from './ScheduleEditor';
import type { Arrange } from './align';
import SelectionPanel from './SelectionPanel';
import StepPanel from './StepPanel';
import { availableTokens } from './tokens';
import TriggerPanel from './TriggerPanel';
import type { PreviewContext } from './previewLogic';
import type { PreviewView } from './usePreviews';

export const EMPTY_HINT =
    'Select a node to edit it. Click + on a node to add what happens next, or drag from + onto another node. Press / to add a node.';

const EXPRESSION_CODES = ['bad_expression', 'unknown_token', 'condition_writes'];
/** Codes that are about a line only when their message names one ("dependency a->b: ..."). */
const LINE_CODES = ['unsafe_token_position', 'bad_edge', 'duplicate_edge'];
const aboutEdge = (i: Issue, edge: { from: string; to: string }): boolean => {
    const named = `dependency ${edge.from}->${edge.to}`;
    return EXPRESSION_CODES.includes(i.code) || (LINE_CODES.includes(i.code) && i.message.startsWith(named) && [':', ' '].includes(i.message[named.length]));
};

export interface NodePanelProps {
    job: JobDefinition;
    graph: FlowGraph;
    selection: FlowSelection;
    /** Issues grouped by step id. */
    byStep: Record<string, Issue[]>;
    dispatch: React.Dispatch<BuilderAction>;
    onSelect: (sel: FlowSelection) => void;
    /** The page confirms, then removes the node with this key. */
    onRequestRemove: (key: string) => void;
    /** The same for several nodes at once. */
    onRequestRemoveNodes?: (keys: string[]) => void;
    /** Align or distribute several nodes (one undo step). */
    onArrange?: (keys: string[], how: Arrange) => void;
    /** Tidy up the selected nodes (the caller knows the node size in use). */
    onTidy?: (keys: string[]) => void;
    onOpenSettings: () => void;
    destinations: Destination[];
    alertActions: AlertAction[] | null;
    jobs: Pick<Job, 'id' | 'name'>[];
    nextSlots?: NextSlots;
    previewFields: Record<string, string[]>;
    scheduledTime: number;
    resolveTimeRange: BuilderApi['resolveTimeRange'];
    previews: Record<string, PreviewView | undefined>;
    /** For testing a condition: the job as previewed, its preview context and input. */
    previewJob?: JobDefinition;
    previewCtx?: PreviewContext;
    inputFor?: (stepId: string, withSelf?: boolean) => PreviewInput;
    onPreview?: (stepId: string, opts?: { anyway?: boolean }) => void;
    onCancelPreview?: (stepId: string) => void;
    /** "Input from" is live: steps upstream run first, so their writing commands count too. */
    previewLive?: boolean;
    /** The panel for a selected group (see useGroups). */
    groupPanel?: React.ReactNode;
    /** Roles an approval step's Who may approve offers (the caller's own). */
    roles?: string[];
    /** Save as snippet for a multi-selection (absent: not offered). */
    onSaveSnippet?: (keys: string[]) => void;
}

export default function NodePanel(props: NodePanelProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const { job, graph, selection, byStep, dispatch, onSelect, onRequestRemove, previewFields } = props;
    const selectNode = (key: string) => onSelect({ kind: 'node', key });

    const edgePanel = (key: string, edge: { from: string; to: string }) => (
        <EdgePanel
            key={key}
            job={job}
            from={edge.from}
            to={edge.to}
            issues={(byStep[edge.to] || []).filter((i) => aboutEdge(i, edge))}
            dispatch={dispatch}
            onRemoved={() => onSelect(null)}
            previewFields={previewFields}
            scheduledTime={props.scheduledTime}
            resolveTimeRange={props.resolveTimeRange}
            conditionTest={props.previewCtx && props.inputFor ? { job: props.previewJob || job, ctx: props.previewCtx, inputFor: props.inputFor, preview: props.onPreview } : undefined}
        />
    );

    if (selection && selection.kind === 'group' && props.groupPanel) {
        return <>{props.groupPanel}</>;
    }
    if (selection && selection.kind === 'nodes') {
        return (
            <SelectionPanel
                keys={selection.keys}
                onTidy={(keys) => (props.onTidy ? props.onTidy(keys) : dispatch({ type: 'tidyLayout', keys }))}
                onArrange={props.onArrange}
                onRequestRemove={(keys) => props.onRequestRemoveNodes && props.onRequestRemoveNodes(keys)}
                onSaveSnippet={props.onSaveSnippet}
            />
        );
    }
    if (selection && selection.kind === 'link') {
        const link = graph.links.find((l) => l.key === selection.key);
        if (link && link.kind === 'edge') {
            return edgePanel(selection.key, { from: link.from.slice('step:'.length), to: link.to.slice('step:'.length) });
        }
        const cond = link && link.kind === 'condition' ? graph.nodes.find((n) => n.edge && (n.key === link.from || n.key === link.to)) : undefined;
        if (cond && cond.edge) {
            return edgePanel(selection.key, cond.edge);
        }
    }

    const node = selection && selection.kind === 'node' ? graph.nodes.find((n) => n.key === selection.key) : undefined;
    if (node && node.stepId) {
        // An approval node gets the step panel too, which shows its ApprovalPanel in place of a search.
        const id = node.stepId;
        if (node.kind === 'summary_index' || node.kind === 'lookup') {
            return (
                <OutputPanel
                    key={node.key}
                    job={job}
                    stepId={id}
                    issues={byStep[id] || []}
                    dispatch={dispatch}
                    onRequestRemove={(stepId) => onRequestRemove(stepKey(stepId))}
                    live={props.previewLive}
                />
            );
        }
        return (
            <StepPanel
                key={node.key}
                job={job}
                stepId={id}
                scheduledTime={props.scheduledTime}
                resolveTimeRange={props.resolveTimeRange}
                issues={byStep[id] || []}
                dispatch={dispatch}
                onRename={(_from, to) => selectNode(stepKey(to))}
                onRequestRemove={(stepId) => onRequestRemove(stepKey(stepId))}
                preview={props.previews[id]}
                onPreview={props.onPreview}
                onCancelPreview={props.onCancelPreview}
                live={props.previewLive}
                previewFields={previewFields}
                roles={props.roles}
            />
        );
    }
    if (node && node.action) {
        const { scope, index } = node.action;
        return (
            <ActionPanel
                key={node.key}
                job={job}
                scope={scope}
                index={index}
                destinations={props.destinations}
                alertActions={props.alertActions}
                tokenGroups={availableTokens(job, scope === 'job' ? null : scope, previewFields)}
                issues={issuesForAction(job, byStep[scope === 'job' ? '' : scope] || [], scope, index)}
                dispatch={dispatch}
                onMoved={selectNode}
                onRequestRemove={onRequestRemove}
            />
        );
    }
    if (node && node.trigger !== undefined) {
        return (
            <TriggerPanel
                key={node.key}
                job={job}
                index={node.trigger}
                jobs={props.jobs}
                nextSlots={props.nextSlots}
                dispatch={dispatch}
                onRequestRemove={onRequestRemove}
                onOpenSettings={props.onOpenSettings}
            />
        );
    }
    if (node && node.edge) {
        return edgePanel(node.key, node.edge);
    }
    if (node && node.key === JOB_KEY) {
        return <JobNodePanel key={node.key} job={job} onSelect={selectNode} />;
    }
    return <p style={{ color: theme.contentColorMuted }}>{EMPTY_HINT}</p>;
}
