/* The Job actions tab: what happens when the whole job starts, succeeds, fails, finishes, is
 * delayed or misses its deadline (job.actions). These used to hang off a "Whole job" node on
 * the canvas; the canvas now holds only triggers, steps and the steps' own actions. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import NumberInput from '@splunk/react-ui/Number';
import Select from '@splunk/react-ui/Select';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Action, AlertAction, Destination, JobDefinition } from '../../api/types';
import { ActionFields } from './ActionsEditor';
import { DEFAULT_RETRIES, DEFAULT_RETRY_WAIT, retryText } from './ActionPanel';
import type { BuilderAction } from './reducer';

export const JOB_HOOKS: Array<{ value: Action['hook']; label: string }> = [
    { value: 'on_failure', label: 'The job fails' },
    { value: 'on_success', label: 'The job succeeds' },
    { value: 'on_complete', label: 'The job finishes, either way' },
    { value: 'on_start', label: 'The job starts' },
    { value: 'on_delayed', label: 'A step is delayed' },
    { value: 'on_late', label: 'The job misses its deadline' },
];

export interface JobActionsTabProps {
    job: JobDefinition;
    dispatch: (action: BuilderAction) => void;
    destinations: Destination[];
    alertActions?: AlertAction[] | null;
    canEdit?: boolean;
}

export default function JobActionsTab({ job, dispatch, destinations, alertActions, canEdit = true }: JobActionsTabProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const actions = job.actions || [];
    const add = () => dispatch({ type: 'setJobField', field: 'actions', value: [...actions, { hook: 'on_failure', type: 'email', to: '' } as Action] });
    return (
        <div style={{ maxWidth: '760px' }} data-testid="job-actions-tab">
            <p style={{ marginTop: 0 }}>
                Actions for the whole job: tell someone, write an event or start another job when the job fails, succeeds, is delayed or misses its deadline. A step&apos;s own actions are on the Flow
                tab, from the step&apos;s + handle. With no failure or delay action here, your admin&apos;s fallback notification is used.
            </p>
            {actions.length === 0 && <p style={{ color: theme.contentColorMuted }}>No job actions yet.</p>}
            {actions.map((a, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <section key={i} aria-label={`Job action ${i + 1}`} data-testid="job-action" style={{ border: `1px solid ${theme.borderColor}`, borderRadius: '4px', padding: '10px 14px', margin: '0 0 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Heading level={3} style={{ margin: 0 }}>{`Action ${i + 1}`}</Heading>
                        {canEdit && <Button appearance="subtle" label="Remove" aria-label={`Remove job action ${i + 1}`} onClick={() => dispatch({ type: 'removeAction', scope: 'job', index: i })} />}
                    </div>
                    <ControlGroup label="When" labelFor={`job-action-${i}-when`} labelPosition="top">
                        <Select
                            inputId={`job-action-${i}-when`}
                            value={a.hook}
                            disabled={!canEdit}
                            onChange={(_e: unknown, { value }: { value: unknown }) => dispatch({ type: 'moveAction', scope: 'job', index: i, toScope: 'job', hook: value as Action['hook'] })}
                        >
                            {JOB_HOOKS.map((h) => (
                                <Select.Option key={h.value} value={h.value} label={h.label} />
                            ))}
                        </Select>
                    </ControlGroup>
                    <ActionFields
                        action={a}
                        idPrefix={`job-action-${i}`}
                        destinations={destinations}
                        alertActions={alertActions}
                        onChange={(next) => {
                            const changes: Record<string, unknown> = {};
                            Object.keys({ ...a, ...next }).forEach((k) => {
                                if (JSON.stringify((next as Record<string, unknown>)[k]) !== JSON.stringify((a as Record<string, unknown>)[k])) {
                                    changes[k] = (next as Record<string, unknown>)[k];
                                }
                            });
                            dispatch({ type: 'updateAction', scope: 'job', index: i, changes: changes as Partial<Action> });
                        }}
                    />
                    {a.type !== 'start_job' && (
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                            <ControlGroup label="Retries" labelFor={`job-action-${i}-retries`} labelPosition="top" help="0 to 10">
                                <NumberInput
                                    inputId={`job-action-${i}-retries`}
                                    min={0}
                                    max={10}
                                    step={1}
                                    roundTo={0}
                                    value={typeof a.retries === 'number' ? a.retries : DEFAULT_RETRIES}
                                    onChange={(_e: unknown, { value }: { value?: number }) => {
                                        const v = value === undefined || Number.isNaN(value) ? undefined : Math.max(0, Math.min(10, Math.round(value)));
                                        dispatch({ type: 'updateAction', scope: 'job', index: i, changes: { retries: v === DEFAULT_RETRIES ? undefined : v } });
                                    }}
                                />
                            </ControlGroup>
                            <ControlGroup label="First wait (seconds)" labelFor={`job-action-${i}-wait`} labelPosition="top" help="10 to 3600; doubles each time">
                                <NumberInput
                                    inputId={`job-action-${i}-wait`}
                                    min={10}
                                    max={3600}
                                    step={10}
                                    roundTo={0}
                                    value={typeof a.retry_wait === 'number' ? a.retry_wait : DEFAULT_RETRY_WAIT}
                                    onChange={(_e: unknown, { value }: { value?: number }) => {
                                        const v = value === undefined || Number.isNaN(value) ? undefined : Math.max(10, Math.min(3600, Math.round(value)));
                                        dispatch({ type: 'updateAction', scope: 'job', index: i, changes: { retry_wait: v === DEFAULT_RETRY_WAIT ? undefined : v } });
                                    }}
                                />
                            </ControlGroup>
                            <p style={{ flex: '1 1 100%', margin: 0, fontSize: '12px', color: theme.contentColorMuted }}>
                                {retryText(typeof a.retries === 'number' ? a.retries : DEFAULT_RETRIES, typeof a.retry_wait === 'number' ? a.retry_wait : DEFAULT_RETRY_WAIT)}
                            </p>
                        </div>
                    )}
                </section>
            ))}
            {canEdit && <Button appearance="secondary" label="Add job action" onClick={add} />}
        </div>
    );
}
