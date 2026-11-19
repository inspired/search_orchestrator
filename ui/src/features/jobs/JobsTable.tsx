/* The Jobs table: name, owner, next run, the last run and the newest runs as status icons,
 * enabled switch, Run now (for users who may run the job) and a ⋯ menu with Backfill… and
 * Delete (only for users who may edit it). Above it: search, a Show filter (all, last run
 * failed, disabled, scheduled, mine) and the sort order, both remembered in this browser. */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Dropdown from '@splunk/react-ui/Dropdown';
import Menu from '@splunk/react-ui/Menu';
import Select from '@splunk/react-ui/Select';
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
import RecentRuns from './RecentRuns';
import { SHOW_LABEL, SORT_LABEL, showJobs, sortJobs } from './jobsView';
import type { Show, Sort } from './jobsView';

const VIEW_KEY = 'so.jobs.view';

function storedView(): { show: Show; sort: Sort } {
    try {
        const v = JSON.parse(window.localStorage.getItem(VIEW_KEY) || '{}');
        return { show: v.show in SHOW_LABEL ? v.show : 'all', sort: v.sort in SORT_LABEL ? v.sort : 'name' };
    } catch (e) {
        return { show: 'all', sort: 'name' };
    }
}

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
    const [view, setViewState] = useState(storedView);
    const setView = (patch: Partial<{ show: Show; sort: Sort }>) => {
        const next = { ...view, ...patch };
        setViewState(next);
        try {
            window.localStorage.setItem(VIEW_KEY, JSON.stringify(next));
        } catch (e) {
            // not remembered; it still applies on this page
        }
    };
    if (!jobs.length) {
        return loadFailed ? null : <JobsEmpty me={me} onBrowseExamples={onBrowseExamples} />;
    }
    const names: Record<string, string> = {};
    jobs.forEach((j) => {
        names[j.id] = j.name;
    });
    const shown = sortJobs(showJobs(filterJobs(jobs, query), view.show, me), view.sort);
    return (
        <>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 320px', maxWidth: '480px' }}>
                    <ControlGroup label="Find jobs" labelPosition="top">
                        <Search inline value={query} onChange={(_e: unknown, { value }: { value: string }) => setQuery(value)} />
                    </ControlGroup>
                </div>
                <ControlGroup label="Show" labelFor="jobs-show" labelPosition="top">
                    <Select inputId="jobs-show" value={view.show} onChange={(_e: unknown, { value }: { value: unknown }) => setView({ show: value as Show })}>
                        {(Object.keys(SHOW_LABEL) as Show[]).map((s) => (
                            <Select.Option key={s} value={s} label={SHOW_LABEL[s]} />
                        ))}
                    </Select>
                </ControlGroup>
                <ControlGroup label="Sort by" labelFor="jobs-sort" labelPosition="top">
                    <Select inputId="jobs-sort" value={view.sort} onChange={(_e: unknown, { value }: { value: unknown }) => setView({ sort: value as Sort })}>
                        {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
                            <Select.Option key={s} value={s} label={SORT_LABEL[s]} />
                        ))}
                    </Select>
                </ControlGroup>
            </div>
            {!shown.length && <p>{query.trim() ? `No jobs match "${query.trim()}".` : `No jobs here: ${SHOW_LABEL[view.show].toLowerCase()}.`}</p>}
            {shown.length > 0 && (
                <Table>
                    <Table.Head>
                        <Table.HeadCell>Name</Table.HeadCell>
                        <Table.HeadCell>Owner</Table.HeadCell>
                        <Table.HeadCell>Next run</Table.HeadCell>
                        <Table.HeadCell>Last runs</Table.HeadCell>
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
                                        {/* One block, so the name and its summary stack instead of running together. */}
                                        <div>
                                            <div>
                                                {canEdit ? (
                                                    <Link to={pageHref('builder', { job_id: job.id })}>{job.name}</Link>
                                                ) : (
                                                    job.name
                                                )}
                                            </div>
                                            <div style={{ fontSize: '12px', color: theme.contentColorMuted }}>
                                                {jobSummary(job, names)}
                                            </div>
                                            {(job.warnings || []).map((w) => (
                                                <div key={`${w.code}-${w.step}`} style={{ fontSize: '12px' }}>
                                                    {w.step ? `Step ${w.step}: ${w.message}` : w.message}
                                                </div>
                                            ))}
                                        </div>
                                    </Table.Cell>
                                    <Table.Cell>{job.owner}</Table.Cell>
                                    <Table.Cell>
                                        {nextRunText(job)}
                                    </Table.Cell>
                                    <Table.Cell>
                                        <div>
                                            {last && (
                                                <Link to={pageHref('run', { run_id: last.id })} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5em', lineHeight: '20px' }}>
                                                    <StatusText state={last.state} delayed={isRunDelayed(last)} />
                                                    <span>{formatTime(last.scheduled_time)}</span>
                                                </Link>
                                            )}
                                            <RecentRuns job={job} />
                                        </div>
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
                                            {((canRun && onBackfill) || (canEdit && onDelete)) && (
                                                <Dropdown toggle={<Button appearance="subtle" label="⋯" aria-label={`More actions for ${job.name}`} />}>
                                                    <Menu>
                                                        {canEdit && <Menu.Item to={pageHref('builder', { job_id: job.id })}>Edit</Menu.Item>}
                                                        {canRun && onBackfill && (
                                                            <Menu.Item disabled={!job.enabled} onClick={() => onBackfill(job)} description={job.enabled ? undefined : 'Enable the job first'}>
                                                                Backfill…
                                                            </Menu.Item>
                                                        )}
                                                        {canEdit && onDelete && (
                                                            <Menu.Item disabled={Boolean(busy[job.id])} onClick={(e: React.MouseEvent) => onDelete(job, e.currentTarget as HTMLElement)}>
                                                                Delete…
                                                            </Menu.Item>
                                                        )}
                                                    </Menu>
                                                </Dropdown>
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
