/* The side panel for a selected trigger node: a cron schedule or "after another job",
 * whether it is enabled, and removing it. The time zone lives in Settings. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Select from '@splunk/react-ui/Select';
import Switch from '@splunk/react-ui/Switch';
import Text from '@splunk/react-ui/Text';
import type { Job, JobDefinition, Trigger } from '../../api/types';
import ScheduleEditor, { NextSlots } from './ScheduleEditor';
import { triggerKey } from './nodeModel';
import type { BuilderAction } from './reducer';

export interface TriggerPanelProps {
    job: JobDefinition;
    index: number;
    /** Other jobs, for completion triggers. */
    jobs: Pick<Job, 'id' | 'name'>[];
    nextSlots?: NextSlots;
    dispatch: React.Dispatch<BuilderAction>;
    /** The page confirms, then removes. */
    onRequestRemove: (key: string) => void;
    onOpenSettings: () => void;
}

export default function TriggerPanel({ job, index, jobs, nextSlots, dispatch, onRequestRemove, onOpenSettings }: TriggerPanelProps) {
    const trigger = (job.triggers || [])[index];
    if (!trigger) {
        return null;
    }
    const update = (changes: Partial<Trigger>) => dispatch({ type: 'updateTrigger', index, changes });
    const id = `trigger-${index}`;
    const others = jobs.filter((j) => j.id !== job.id);
    return (
        <section aria-label="Trigger">
            <Heading level={2}>{trigger.type === 'completion' ? 'After another job' : 'Schedule'}</Heading>
            {trigger.type === 'completion' ? (
                <>
                    <ControlGroup label="Job" labelFor={`${id}-job`} labelPosition="top">
                        {others.length ? (
                            <Select
                                inputId={`${id}-job`}
                                value={trigger.job || ''}
                                placeholder="Pick a job"
                                filter
                                onChange={(_e: unknown, { value }: { value: unknown }) => update({ job: String(value) })}
                            >
                                {others.map((j) => (
                                    <Select.Option key={j.id} label={j.name || j.id} value={j.id} />
                                ))}
                            </Select>
                        ) : (
                            <Text inputId={`${id}-job`} value={trigger.job || ''} placeholder="Job id" onChange={(_e: unknown, { value }: { value: string }) => update({ job: value })} />
                        )}
                    </ControlGroup>
                    <ControlGroup label="Start when it" labelFor={`${id}-on`} labelPosition="top">
                        <Select
                            inputId={`${id}-on`}
                            value={trigger.on || 'success'}
                            onChange={(_e: unknown, { value }: { value: unknown }) => update({ on: value as Trigger['on'] })}
                        >
                            <Select.Option label="Succeeds" value="success" />
                            <Select.Option label="Completes (success or failure)" value="complete" />
                        </Select>
                    </ControlGroup>
                </>
            ) : (
                <>
                    <ScheduleEditor id={id} cron={trigger.cron || ''} timezone={job.timezone} nextSlots={nextSlots} jobId={job.id} onChange={(cron) => update({ cron })} />
                    <p>
                        Times are in {job.timezone || "the server's time zone"}.{' '}
                        <Button appearance="subtle" label="Change time zone" onClick={onOpenSettings} />
                    </p>
                </>
            )}
            <Switch appearance="toggle" selected={trigger.enabled !== false} onClick={() => update({ enabled: trigger.enabled === false })}>
                Enabled
            </Switch>
            <div style={{ marginTop: '12px' }}>
                <Button appearance="destructive" label="Remove trigger" onClick={() => onRequestRemove(triggerKey(index))} />
            </div>
        </section>
    );
}
