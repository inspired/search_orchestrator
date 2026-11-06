/* The Jobs table: name, owner, next run, last run outcome, enabled switch, Run now and
 * Delete (only for users who may edit the job). */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import Link from '@splunk/react-ui/Link';
import Switch from '@splunk/react-ui/Switch';
import Table from '@splunk/react-ui/Table';
import type { Job, Me } from '../../api/types';
import StatusText, { isRunDelayed, srOnly } from '../../components/StatusText';
import { pageHref } from '../../components/PageShell';
import { formatTime } from '../../format';

export interface JobsTableProps {
    jobs: Job[];
    me: Me | null | undefined;
    onRunNow: (job: Job) => void;
    onToggleEnabled: (job: Job, enabled: boolean) => void;
    /** Shown only for jobs the user may edit. The event's target is the button, for focus. */
    onDelete?: (job: Job, opener: HTMLElement) => void;
    /** Job ids with a save in flight: their switch is disabled. */
    busy?: Record<string, boolean>;
}

function nextRunText(job: Job): string {
    if (job.next_run) {
        return formatTime(job.next_run);
    }
    if (!job.enabled) {
        return 'Disabled';
    }
    // Past the 400-day walk: the next slot is too far away to show.
    return job.next_run_beyond ? '\u2014' : 'Not scheduled';
}

export default function JobsTable({ jobs, me, onRunNow, onToggleEnabled, onDelete, busy = {} }: JobsTableProps) {
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
                    <span style={{ position: 'relative' }}>
                        <span style={srOnly}>Actions</span>
                    </span>
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
                                {nextRunText(job)}
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
                                    <span style={{ position: 'relative' }}>
                                        <span style={srOnly}>{`Enable ${job.name}`}</span>
                                    </span>
                                </Switch>
                            </Table.Cell>
                            <Table.Cell>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    {canRun && (
                                        <Button
                                            appearance="secondary"
                                            label="Run now"
                                            aria-label={`Run now: ${job.name}`}
                                            disabled={!job.enabled}
                                            onClick={() => onRunNow(job)}
                                        />
                                    )}
                                    {canEdit && onDelete && (
                                        <Button
                                            appearance="secondary"
                                            label="Delete"
                                            aria-label={`Delete ${job.name}`}
                                            disabled={Boolean(busy[job.id])}
                                            onClick={(e: React.MouseEvent) => onDelete(job, e.currentTarget as HTMLElement)}
                                        />
                                    )}
                                </div>
                            </Table.Cell>
                        </Table.Row>
                    );
                })}
            </Table.Body>
        </Table>
    );
}
