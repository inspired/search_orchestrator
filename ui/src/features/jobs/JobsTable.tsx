/* The Jobs table: name, owner, next run, last run outcome, enabled switch and Run now. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import Link from '@splunk/react-ui/Link';
import Switch from '@splunk/react-ui/Switch';
import Table from '@splunk/react-ui/Table';
import type { Job, Me } from '../../api/types';
import StatusText, { isRunDelayed } from '../../components/StatusText';
import { pageHref } from '../../components/PageShell';
import { formatTime } from '../../format';

export interface JobsTableProps {
    jobs: Job[];
    me: Me | null | undefined;
    onRunNow: (job: Job) => void;
    onToggleEnabled: (job: Job, enabled: boolean) => void;
    /** Job ids with a save in flight: their switch is disabled. */
    busy?: Record<string, boolean>;
}

export default function JobsTable({ jobs, me, onRunNow, onToggleEnabled, busy = {} }: JobsTableProps) {
    if (!jobs.length) {
        return <p>No jobs yet.{me && me.can_build ? ' Use New job to build one.' : ''}</p>;
    }
    return (
        <Table stripeRows>
            <Table.Head>
                <Table.HeadCell>Name</Table.HeadCell>
                <Table.HeadCell>Owner</Table.HeadCell>
                <Table.HeadCell>Next run</Table.HeadCell>
                <Table.HeadCell>Last run</Table.HeadCell>
                <Table.HeadCell>Enabled</Table.HeadCell>
                <Table.HeadCell>
                    <span style={{ position: 'absolute', left: '-10000px' }}>Actions</span>
                </Table.HeadCell>
            </Table.Head>
            <Table.Body>
                {jobs.map((job) => {
                    const last = job.last_run;
                    const canEdit = job.permissions.can_edit;
                    const canRun = job.permissions.can_run && (!me || me.can_run || me.can_admin);
                    return (
                        <Table.Row key={job.id}>
                            <Table.Cell>
                                {canEdit ? (
                                    <Link to={pageHref('builder', { job_id: job.id })}>{job.name}</Link>
                                ) : (
                                    job.name
                                )}
                            </Table.Cell>
                            <Table.Cell>{job.owner}</Table.Cell>
                            <Table.Cell>
                                {job.next_run ? formatTime(job.next_run) : job.enabled ? 'Not scheduled' : 'Disabled'}
                            </Table.Cell>
                            <Table.Cell>
                                {last ? (
                                    <Link to={pageHref('run', { run_id: last.id })}>
                                        <StatusText state={last.state} delayed={isRunDelayed(last)} />
                                        <span style={{ marginLeft: '0.5em' }}>{formatTime(last.scheduled_time)}</span>
                                    </Link>
                                ) : (
                                    'Never run'
                                )}
                            </Table.Cell>
                            <Table.Cell>
                                <Switch
                                    appearance="toggle"
                                    selected={job.enabled}
                                    disabled={!canEdit || Boolean(busy[job.id])}
                                    onClick={() => onToggleEnabled(job, !job.enabled)}
                                >
                                    <span style={{ position: 'absolute', left: '-10000px' }}>
                                        {`Enable ${job.name}`}
                                    </span>
                                </Switch>
                            </Table.Cell>
                            <Table.Cell>
                                {canRun && (
                                    <Button
                                        appearance="secondary"
                                        label="Run now"
                                        aria-label={`Run now: ${job.name}`}
                                        disabled={!job.enabled}
                                        onClick={() => onRunNow(job)}
                                    />
                                )}
                            </Table.Cell>
                        </Table.Row>
                    );
                })}
            </Table.Body>
        </Table>
    );
}
