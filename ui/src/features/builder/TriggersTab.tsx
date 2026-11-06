/* Triggers: cron schedules and "after job X succeeds/completes", plus the job's time zone
 * and catch-up policy for missed cron slots. Manual, REST and search-command runs need no
 * trigger. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Select from '@splunk/react-ui/Select';
import Switch from '@splunk/react-ui/Switch';
import Text from '@splunk/react-ui/Text';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Job, JobDefinition, Trigger } from '../../api/types';
import type { BuilderAction } from './reducer';

export interface TriggersTabProps {
    job: JobDefinition;
    /** Other jobs, for completion triggers. */
    jobs: Pick<Job, 'id' | 'name'>[];
    dispatch: (action: BuilderAction) => void;
}

export default function TriggersTab({ job, jobs, dispatch }: TriggersTabProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const triggers = job.triggers || [];
    const setTriggers = (value: Trigger[]) => dispatch({ type: 'setJobField', field: 'triggers', value });
    const update = (i: number, changes: Partial<Trigger>) => setTriggers(triggers.map((t, j) => (j === i ? { ...t, ...changes } : t)));
    const remove = (i: number) => setTriggers(triggers.filter((_t, j) => j !== i));
    const others = jobs.filter((j) => j.id !== job.id);
    const row = { borderTop: `1px solid ${theme.borderColor}`, padding: '8px 0' };

    return (
        <div style={{ maxWidth: '640px' }}>
            <Heading level={3}>Schedules</Heading>
            {triggers.map((t, i) => {
                if (t.type !== 'cron') {
                    return null;
                }
                const id = `trigger-${triggers.length}-${i}`;
                return (
                    <div key={id} style={row}>
                        <ControlGroup label="Cron" labelFor={`${id}-cron`} labelPosition="top" help="minute hour day-of-month month day-of-week, in the job's time zone.">
                            <Text inputId={`${id}-cron`} value={t.cron || ''} placeholder="0 1 * * *" onChange={(_e: unknown, { value }: { value: string }) => update(i, { cron: value })} />
                        </ControlGroup>
                        <Switch
                            appearance="toggle"
                            selected={t.enabled !== false}
                            onClick={() => update(i, { enabled: t.enabled === false })}
                        >
                            Enabled
                        </Switch>
                        <Button appearance="subtle" label="Remove schedule" onClick={() => remove(i)} />
                    </div>
                );
            })}
            <Button appearance="secondary" label="Add schedule" onClick={() => setTriggers([...triggers, { type: 'cron', cron: '0 1 * * *' }])} />

            <Heading level={3}>After another job</Heading>
            {triggers.map((t, i) => {
                if (t.type !== 'completion') {
                    return null;
                }
                const id = `trigger-${triggers.length}-${i}`;
                return (
                    <div key={id} style={row}>
                        <ControlGroup label="Job" labelFor={`${id}-job`} labelPosition="top">
                            {others.length ? (
                                <Select
                                    inputId={`${id}-job`}
                                    value={t.job || ''}
                                    placeholder="Pick a job"
                                    filter
                                    onChange={(_e: unknown, { value }: { value: unknown }) => update(i, { job: String(value) })}
                                >
                                    {others.map((j) => (
                                        <Select.Option key={j.id} label={j.name || j.id} value={j.id} />
                                    ))}
                                </Select>
                            ) : (
                                <Text inputId={`${id}-job`} value={t.job || ''} placeholder="Job id" onChange={(_e: unknown, { value }: { value: string }) => update(i, { job: value })} />
                            )}
                        </ControlGroup>
                        <ControlGroup label="Start when it" labelFor={`${id}-on`} labelPosition="top">
                            <Select
                                inputId={`${id}-on`}
                                value={t.on || 'success'}
                                onChange={(_e: unknown, { value }: { value: unknown }) => update(i, { on: value as Trigger['on'] })}
                            >
                                <Select.Option label="Succeeds" value="success" />
                                <Select.Option label="Completes (success or failure)" value="complete" />
                            </Select>
                        </ControlGroup>
                        <Button appearance="subtle" label="Remove" onClick={() => remove(i)} />
                    </div>
                );
            })}
            <Button
                appearance="secondary"
                label="Add job completion trigger"
                onClick={() => setTriggers([...triggers, { type: 'completion', job: '', on: 'success' }])}
            />

            <Heading level={3}>Schedule options</Heading>
            <ControlGroup label="Time zone" labelFor="job-timezone" labelPosition="top" help="An IANA name such as Europe/Oslo. Empty uses the server's time zone.">
                <Text
                    inputId="job-timezone"
                    value={job.timezone || ''}
                    placeholder="Server time zone"
                    onChange={(_e: unknown, { value }: { value: string }) => dispatch({ type: 'setJobField', field: 'timezone', value: value || undefined })}
                />
            </ControlGroup>
            <ControlGroup label="Missed runs" labelFor="job-catchup" labelPosition="top" help="What to do with cron slots missed while Splunk or the engine was down.">
                <Select
                    inputId="job-catchup"
                    value={job.catchup || 'all'}
                    onChange={(_e: unknown, { value }: { value: unknown }) => dispatch({ type: 'setJobField', field: 'catchup', value })}
                >
                    <Select.Option label="Run each missed slot (up to 7)" value="all" />
                    <Select.Option label="Run only the latest missed slot" value="latest" />
                    <Select.Option label="Skip missed slots" value="none" />
                </Select>
            </ControlGroup>
        </div>
    );
}
