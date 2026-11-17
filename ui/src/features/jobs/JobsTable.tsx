/* The Jobs table: name, owner, next run, last run outcome, enabled switch, Run now and
 * Backfill… (for users who may run the job) and Delete (only for users who may edit it). */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Link from '@splunk/react-ui/Link';
import Search from '@splunk/react-ui/Search';
import Switch from '@splunk/react-ui/Switch';
import Table from '@splunk/react-ui/Table';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Job, Me } from '../../api/types';
import StatusText, { isRunDelayed, srOnly } from '../../components/StatusText';
import { pageHref } from '../../components/PageShell';
import { formatTime } from '../../format';
import JobsEmpty from './JobsEmpty';
import { filterJobs, jobSummary } from './jobSummary';

export interface JobsTableProps {
    jobs: Job[];
    /** The last load failed: with no jobs, show nothing (the page shows the error). */
    loadFailed?: boolean;
    me: Me | null | undefined;
    onRunNow: (job: Job) => void;
    /** Opens the Backfill dialog; the button shows only when this is given. */
    onBackfill?: (job: Job) => void;
    onToggleEnabled: (job: Job, enabled: boolean) => void;
    /** Shown only for jobs the user may edit. The event's target is the button, for focus. */
    onDelete?: (job: Job, opener: HTMLElement) => void;
    /** Job ids with a save in flight: their switch is disabled. */
    busy?: Record<string, boolean>;
    /** Opens the example jobs (offered on the empty page to builders). */
    onBrowseExamples?: () => void;
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

export default function JobsTable({ jobs, loadFailed = false, me, onRunNow, onBackfill, onToggleEnabled, onDelete, busy = {}, onBrowseExamples }: JobsTableProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [query, setQuery] = useState('');
    if (!jobs.length) {
        return loadFailed ? null : <JobsEmpty me={me} onBrowseExamples={onBrowseExamples} />;
    }
    const names: Record<string, string> = {};
    jobs.forEach((j) => {
        names[j.id] = j.name;
    });
    const shown = filterJobs(jobs, query);
    return (
        <>
            <ControlGroup label="Find jobs" labelPosition="top">
                <Search
                    inline
                    value={query}
                    onChange={(_e: unknown, { value }: { value: string }) => setQuery(value)}
                />
            </ControlGroup>
            {!shown.length && <p>{`No jobs match "${query.trim()}".`}</p>}
            {shown.length > 0 && (
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
                        {shown.map((job) => {
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
                                        <div style={{ fontSize: '12px', color: theme.contentColorMuted }}>
                                            {jobSummary(job, names)}
                                        </div>
                                        {(job.warnings || []).map((w) => (
                                            <div key={`${w.code}-${w.step}`} style={{ fontSize: '12px' }}>
                                                {w.step ? `Step ${w.step}: ${w.message}` : w.message}
                                            </div>
                                        ))}
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
                                            {canRun && onBackfill && (
                                                <Button
                                                    appearance="secondary"
                                                    label="Backfill…"
                                                    aria-label={`Backfill ${job.name}`}
                                                    disabled={!job.enabled}
                                                    onClick={() => onBackfill(job)}
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
            )}
        </>
    );
}
