/* The Standard view's Actions section under a step's panel: the step's actions (which the
 * Advanced view draws as nodes), each with when it fires and what it does. Add action picks
 * when and what; a row opens the same action panel Advanced uses. All edits are the
 * builder's usual actions (addNode from the step's outcome, updateAction, moveAction,
 * removeAction), so the job is the same in every view. */
import React, { useEffect, useMemo, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Select from '@splunk/react-ui/Select';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Action, AlertAction, Issue, JobDefinition } from '../../api/types';
import ActionPanel from './ActionPanel';
import { CATALOG, isBeta, targetKinds } from './nodeCatalog';
import { actionKey, buildGraph, HOOK_FOR_PORT, NodeKind, nodeKindOfStep, outputPorts, PortId, portForHook, stepKey } from './nodeModel';
import { outcomeLabel } from './outcomes';
import type { BuilderAction } from './reducer';
import type { TokenGroup } from './tokens';

export interface StepActionsProps {
    job: JobDefinition;
    stepId: string;
    alertActions?: AlertAction[] | null;
    tokenGroups?: TokenGroup[];
    issues?: Issue[];
    dispatch: React.Dispatch<BuilderAction>;
    /** The page confirms, then removes (by the action's node key). */
    onRequestRemove: (key: string) => void;
    /** Open this action's panel (a problem's Go to); `n` changes to open it again. */
    openAction?: { index: number; n: number } | null;
}

const kindLabel = (kind: NodeKind) => {
    const entry = CATALOG.find((e) => e.kind === kind);
    const label = entry ? entry.label : kind;
    return isBeta(kind) ? `${label} · Beta` : label;
};

export default function StepActions({ job, stepId, alertActions, tokenGroups, issues = [], dispatch, onRequestRemove, openAction }: StepActionsProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const step = (job.steps || []).find((s) => s.id === stepId);
    const [open, setOpen] = useState<number | null>(null);
    const [adding, setAdding] = useState(false);
    const [port, setPort] = useState<PortId | ''>('');
    const [kind, setKind] = useState<NodeKind | ''>('');
    const nodes = useMemo(() => buildGraph(job).nodes, [job]);
    const openN = openAction ? openAction.n : 0;
    useEffect(() => {
        if (openAction) {
            setOpen(openAction.index);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openN]);
    if (!step) {
        return null;
    }
    const stepKind = nodeKindOfStep(step);
    const ports = outputPorts(stepKind).filter((p) => HOOK_FOR_PORT[p]);
    const kinds = targetKinds('start', stepKind);
    const actions: Action[] = step.actions || [];
    const add = () => {
        if (!port || !kind) {
            return;
        }
        dispatch({ type: 'addNode', kind, from: { key: stepKey(stepId), port } });
        setOpen(actions.length);
        setAdding(false);
        setPort('');
        setKind('');
    };
    return (
        <section aria-label="Actions" style={{ marginTop: '20px', borderTop: `1px solid ${theme.borderColor}`, paddingTop: '12px' }}>
            <Heading level={3}>Actions</Heading>
            {!actions.length && <p style={{ color: theme.contentColorMuted, margin: '4px 0 8px' }}>No actions. Add one to send an email, call a webhook or start another job when this step ends.</p>}
            <ul aria-label={`Actions of ${step.name || step.id}`} style={{ listStyle: 'none', padding: 0, margin: '4px 0 8px' }}>
                {actions.map((a, i) => {
                    const node = nodes.find((n) => n.key === actionKey(stepId, i));
                    const when = outcomeLabel(stepKind, portForHook(a.hook) as Exclude<PortId, 'then'>);
                    return (
                        <li key={`${a.hook}-${i}`} style={{ marginBottom: '6px' }}>
                            <Button
                                appearance={open === i ? 'secondary' : 'subtle'}
                                label={`${when} · ${node ? node.label : a.type}${node && node.detail ? `: ${node.detail}` : ''}`}
                                aria-expanded={open === i}
                                onClick={() => setOpen(open === i ? null : i)}
                            />
                            {open === i && (
                                <div style={{ padding: '8px 0 8px 12px', borderLeft: `2px solid ${theme.borderColor}` }}>
                                    <ActionPanel
                                        job={job}
                                        scope={stepId}
                                        index={i}
                                        alertActions={alertActions}
                                        tokenGroups={tokenGroups}
                                        issues={issues}
                                        dispatch={dispatch}
                                        onMoved={() => setOpen(null)}
                                        onRequestRemove={(key) => {
                                            setOpen(null);
                                            onRequestRemove(key);
                                        }}
                                    />
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
            {!adding ? (
                <Button appearance="secondary" label="Add action" onClick={() => setAdding(true)} />
            ) : (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <ControlGroup label="When" labelFor={`${stepId}-new-action-when`} labelPosition="top">
                        <Select inputId={`${stepId}-new-action-when`} value={port} placeholder="Pick when" onChange={(_e: unknown, { value }: { value: unknown }) => setPort(value as PortId)}>
                            {ports.map((p) => (
                                <Select.Option key={p} value={p} label={outcomeLabel(stepKind, p as Exclude<PortId, 'then'>)} />
                            ))}
                        </Select>
                    </ControlGroup>
                    <ControlGroup label="Action" labelFor={`${stepId}-new-action-kind`} labelPosition="top">
                        <Select inputId={`${stepId}-new-action-kind`} value={kind} placeholder="Pick what" onChange={(_e: unknown, { value }: { value: unknown }) => setKind(value as NodeKind)}>
                            {kinds.map((k) => (
                                <Select.Option key={k} value={k} label={kindLabel(k)} />
                            ))}
                        </Select>
                    </ControlGroup>
                    <Button appearance="primary" label="Add" disabled={!port || !kind} onClick={add} />
                    <Button appearance="subtle" label="Cancel" onClick={() => setAdding(false)} />
                </div>
            )}
        </section>
    );
}
