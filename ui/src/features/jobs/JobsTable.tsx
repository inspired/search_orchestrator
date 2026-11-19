/* The Jobs table: name (with warnings), owner, next run (and how soon), the last run and the
 * newest runs as status icons, how long the last run took against the usual time, enabled switch, Run now (for users who may run the job) and a ⋯ menu with Backfill… and
 * Delete (only for users who may edit it). Above it: search, a Show filter (all, last run
 * failed, disabled, scheduled, mine) and the sort order, both remembered in this browser. Colour only on warnings,
 * failures and runs much slower than usual. */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Dropdown from '@splunk/react-ui/Dropdown';
import ExclamationTriangle from '@splunk/react-icons/ExclamationTriangle';
import Bell from '@splunk/react-icons/Bell';
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
import { formatDuration, formatTime } from '../../format';
import JobsEmpty from './JobsEmpty';
import { filterJobs, jobSummary } from './jobSummary';
import RecentRuns from './RecentRuns';
import { allTags, hasTag } from './tags';
import { SHOW_LABEL, SORT_LABEL, inText, lastDuration, showJobs, slowRatio, sortJobs, typicalDuration } from './jobsView';
import type { Show, Sort } from './jobsView';

const VIEW_KEY = 'so.jobs.view';

interface View {
    show: Show;
    sort: Sort;
    /** A tag, or '' for every job. */
    tag: string;
}

function storedView(): View {
    try {
        const v = JSON.parse(window.localStorage.getItem(VIEW_KEY) || '{}');
        return { show: v.show in SHOW_LABEL ? v.show : 'all', sort: v.sort in SORT_LABEL ? v.sort : 'name', tag: typeof v.tag === 'string' ? v.tag : '' };
    } catch (e) {
        return { show: 'all', sort: 'name', tag: '' };
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
    /** Opens Follow for a job (anyone who can see it). */
    onFollow?: (job: Job, opener: HTMLElement) => void;
    /** Downloads the jobs shown (after Find and Show) as an export file. */
    onExport?: (shown: Job[]) => void;
    /** Epoch seconds for "in 6 min" and running times; defaults to the clock. */
    now?: number;
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

function DurationCell({ job, now, theme }: { job: Job; now: number; theme: Record<string, string> }) {
    const last = lastDuration(job, now);
    const usual = typicalDuration(job);
    const slow = slowRatio(job, now);
    const running = Boolean(job.last_run && !job.last_run.ended_at);
    if (last === null && usual === null) {
        return null;
    }
    return (
        <div>
            {last !== null && (
                <div style={{ fontVariantNumeric: 'tabular-nums', color: slow ? theme.statusColorMedium : undefined, display: 'flex', alignItems: 'center', gap: '0.35em' }}>
                    {slow && <ExclamationTriangle aria-hidden width="14" height="14" />}
                    {running ? `${formatDuration(last)} so far` : formatDuration(last)}
                </div>
            )}
            {usual !== null && (
                <div style={{ fontSize: '12px', color: slow ? theme.statusColorMedium : theme.contentColorMuted }}>
                    {slow ? `${slow.toFixed(1).replace(/\.0$/, '')}× the usual ${formatDuration(usual)}` : `usually ${formatDuration(usual)}`}
                </div>
            )}
        </div>
    );
}

export default function JobsTable({ jobs, loadFailed = false, me, onRunNow, onBackfill, onToggleEnabled, onDelete, busy = {}, onBrowseExamples, onExport, onFollow, now }: JobsTableProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const at = now ?? Math.floor(Date.now() / 1000);
    const [query, setQuery] = useState('');
    const [view, setViewState] = useState(storedView);
    const setView = (patch: Partial<View>) => {
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
    const tags = allTags(jobs);
    // A remembered tag no job has any more filters nothing.
    const tag = tags.some((t) => t.toLowerCase() === view.tag.toLowerCase()) ? view.tag : '';
    const shown = sortJobs(showJobs(filterJobs(jobs, query), view.show, me), view.sort).filter((j) => hasTag(j, tag));
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
                {tags.length > 0 && (
                    <ControlGroup label="Tag" labelFor="jobs-tag" labelPosition="top">
                        <Select inputId="jobs-tag" value={tag} onChange={(_e: unknown, { value }: { value: unknown }) => setView({ tag: String(value) })}>
                            <Select.Option value="" label="All tags" />
                            {tags.map((t) => (
                                <Select.Option key={t} value={t} label={t} />
                            ))}
                        </Select>
                    </ControlGroup>
                )}
                <ControlGroup label="Sort by" labelFor="jobs-sort" labelPosition="top">
                    <Select inputId="jobs-sort" value={view.sort} onChange={(_e: unknown, { value }: { value: unknown }) => setView({ sort: value as Sort })}>
                        {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
                            <Select.Option key={s} value={s} label={SORT_LABEL[s]} />
                        ))}
                    </Select>
                </ControlGroup>
                {onExport && (
                    <div style={{ marginLeft: 'auto', alignSelf: 'flex-end', paddingBottom: '8px' }}>
                        <Button
                            appearance="secondary"
                            label={`Export ${shown.length === jobs.length ? 'all jobs' : `${shown.length} shown`}`}
                            disabled={!shown.length}
                            onClick={() => onExport(shown)}
                        />
                    </div>
                )}
            </div>
            {!shown.length && <p>{query.trim() ? `No jobs match "${query.trim()}".` : tag ? `No jobs tagged ${tag} here.` : `No jobs here: ${SHOW_LABEL[view.show].toLowerCase()}.`}</p>}
            {shown.length > 0 && (
                <Table>
                    <Table.Head>
                        <Table.HeadCell>Name</Table.HeadCell>
                        <Table.HeadCell>Owner</Table.HeadCell>
                        <Table.HeadCell>Next run</Table.HeadCell>
                        <Table.HeadCell>Last runs</Table.HeadCell>
                        <Table.HeadCell>Duration</Table.HeadCell>
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
                                                {job.following && (
                                                    <span data-testid="following" title="You follow this job" style={{ marginLeft: '6px', color: theme.contentColorMuted, display: 'inline-flex', verticalAlign: 'middle' }}>
                                                        <Bell aria-hidden width="14" height="14" />
                                                        <span style={srOnly}>You follow this job</span>
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ fontSize: '12px', color: theme.contentColorMuted }}>
                                                {jobSummary(job, names)}
                                            </div>
                                            {(job.tags || []).length > 0 && (
                                                <div data-testid="job-tags" style={{ fontSize: '12px', color: theme.contentColorMuted, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                    {(job.tags || []).map((t) => (
                                                        <Link key={t} onClick={() => setView({ tag: t })} aria-label={`Show jobs tagged ${t}`}>
                                                            {`#${t}`}
                                                        </Link>
                                                    ))}
                                                </div>
                                            )}
                                            {(job.warnings || []).map((w, i) => (
                                                <div key={`${w.code}-${w.step}-${i}`} data-testid="job-warning" style={{ fontSize: '12px', color: theme.statusColorMedium, display: 'flex', alignItems: 'flex-start', gap: '0.35em', marginTop: '2px' }}>
                                                    <ExclamationTriangle aria-hidden width="12" height="12" style={{ flex: 'none', marginTop: '2px' }} />
                                                    <span>
                                                        <span style={srOnly}>Warning: </span>
                                                        {w.step ? `Step ${w.step}: ${w.message}` : w.message}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </Table.Cell>
                                    <Table.Cell>{job.owner}</Table.Cell>
                                    <Table.Cell>
                                        <div>
                                            <div>{nextRunText(job)}</div>
                                            {job.next_run ? <div style={{ fontSize: '12px', color: theme.contentColorMuted }}>{inText(job.next_run - at)}</div> : null}
                                        </div>
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
                                        <DurationCell job={job} now={at} theme={theme} />
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
                                            {((canRun && onBackfill) || (canEdit && onDelete) || onFollow) && (
                                                <Dropdown toggle={<Button appearance="subtle" label="⋯" aria-label={`More actions for ${job.name}`} />}>
                                                    <Menu>
                                                        {canEdit && <Menu.Item to={pageHref('builder', { job_id: job.id })}>Edit</Menu.Item>}
                                                        {onFollow && (
                                                            <Menu.Item onClick={(e: React.MouseEvent) => onFollow(job, e.currentTarget as HTMLElement)}>{job.following ? 'Following…' : 'Follow…'}</Menu.Item>
                                                        )}
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
