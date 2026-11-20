/* The side panel for a selected trigger node: a cron schedule or "after another job",
 * whether it is enabled, and removing it. The time zone lives in Settings. Under a schedule,
 * the busy-times strip shows how busy other jobs are around its runs. */
import React, { useEffect, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Select from '@splunk/react-ui/Select';
import Switch from '@splunk/react-ui/Switch';
import Text from '@splunk/react-ui/Text';
import type { Job, JobDefinition, SchedulePreviewResponse, Trigger } from '../../api/types';
import useDebounced from '../../hooks/useDebounced';
import { withTime } from '../schedule/layout';
import BusyStrip from './BusyStrip';
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
    /** Other jobs' load around the draft's schedules; without it there is no busy-times strip. */
    schedulePreview?: (job: JobDefinition) => Promise<SchedulePreviewResponse>;
    /** The saved job's id, so its own runs aren't counted as other jobs; none for a new job. */
    savedJobId?: string | null;
}

/** How long the schedule must stay unchanged before the busy-times strip reloads. */
export const BUSY_DELAY_MS = 600;

/** The parts of the draft the busy-times projection reads. */
function projectionInput(job: JobDefinition, jobId?: string | null): JobDefinition {
    return { id: jobId || undefined, name: job.name, enabled: true, timezone: job.timezone, triggers: job.triggers, steps: job.steps, edges: job.edges } as JobDefinition;
}

function Busy({ job, index, savedJobId, schedulePreview, onUseTime }: { job: JobDefinition; index: number; savedJobId?: string | null; schedulePreview: NonNullable<TriggerPanelProps['schedulePreview']>; onUseTime: (cron: string) => void }) {
    const cron = ((job.triggers || [])[index] || {}).cron || '';
    const input = useDebounced(JSON.stringify(projectionInput(job, savedJobId)), BUSY_DELAY_MS);
    const [busy, setBusy] = useState<SchedulePreviewResponse | null>(null);
    const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
    useEffect(() => {
        let live = true;
        schedulePreview(JSON.parse(input) as JobDefinition)
            .then((res) => live && setBusy(res))
            .catch(() => live && setBusy(null)); // the strip is a hint: no strip on failure
        return () => {
            live = false;
        };
    }, [input, schedulePreview]);
    const sched = busy && busy.schedules.find((x) => x.index === index);
    if (!busy || !sched) {
        return null;
    }
    const key = `${index}:${cron}`;
    return (
        <BusyStrip
            preview={busy}
            schedule={sched}
            dismissed={!!dismissed[key]}
            onDismiss={() => setDismissed({ ...dismissed, [key]: true })}
            onUseTime={(hour, minute) => onUseTime(withTime(cron, hour, minute))}
        />
    );
}

export default function TriggerPanel({ job, index, jobs, nextSlots, dispatch, onRequestRemove, onOpenSettings, schedulePreview, savedJobId }: TriggerPanelProps) {
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
                    {schedulePreview && <Busy job={job} index={index} savedJobId={savedJobId} schedulePreview={schedulePreview} onUseTime={(cron) => update({ cron })} />}
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
