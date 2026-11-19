/* The Runs table: job, scheduled time, state, duration and trigger, with filters. By default
 * runs are grouped by job: one row per job (its latest run, how many runs are in each state,
 * and a mark when a step waits for approval) that opens to list all its runs. "All runs" shows
 * them in one list, newest first; picking one job shows its runs. The choice is remembered in
 * this browser (`so.runs.grouped`). With `bulk`, runs can be ticked (a job row ticks all its
 * runs) for Cancel, Re-run, Approve and Reject on all of them at once. */
import React, { useState } from 'react';
import RadioBar from '@splunk/react-ui/RadioBar';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Link from '@splunk/react-ui/Link';
import Message from '@splunk/react-ui/Message';
import Select from '@splunk/react-ui/Select';
import Table from '@splunk/react-ui/Table';
import { RUN_STATES } from '../../api/types';
import type { RunFilters, RunState, RunSummary } from '../../api/types';
import StatusText, { isRunDelayed, statusLabel } from '../../components/StatusText';
import { QueueReasonLine } from '../../components/WaitReason';
import { pageHref } from '../../components/PageShell';
import { formatDuration, formatTime } from '../../format';
import type { BulkAction, BulkResult } from '../../api/client';
import BulkActions, { outcomeText } from './BulkActions';
import type { Outcome } from './BulkActions';

/** The state filter: a run state, or 'attention' for blocked, failed and held runs and runs waiting for approval. */
export type RunsTableFilters = Omit<Pick<RunFilters, 'job_id' | 'state'>, 'state'> & {
    state?: RunState | 'attention';
};

/** A step of the run is waiting for someone to approve or reject it. */
export function awaitsApproval(run: RunSummary): boolean {
    return Object.values(run.steps || {}).some((s) => s && s.state === 'awaiting_approval');
}

/** Blocked or failed runs, held runs of any state, and runs waiting for approval. */
export function needsAttention(run: RunSummary): boolean {
    return run.state === 'blocked' || run.state === 'failed' || run.held === true || awaitsApproval(run);
}

export function filterRuns(runs: RunSummary[], filters: RunsTableFilters): RunSummary[] {
    return runs.filter(
        (r) =>
            (!filters.state ||
                (filters.state === 'attention' ? needsAttention(r) : r.state === filters.state)) && (!filters.job_id || r.job_id === filters.job_id)
    );
}

const GROUPED_KEY = 'so.runs.grouped';

function storedGrouped(): boolean {
    try {
        return window.localStorage.getItem(GROUPED_KEY) !== '0';
    } catch (err) {
        return true;
    }
}

export interface JobGroup {
    jobId: string;
    runs: RunSummary[];
    counts: Partial<Record<RunState, number>>;
    approvals: number;
}

/** The runs grouped by job, the job with the newest run first; each group newest first. */
export function groupByJob(runs: RunSummary[]): JobGroup[] {
    const by = new Map<string, JobGroup>();
    runs.forEach((r) => {
        let g = by.get(r.job_id);
        if (!g) {
            g = { jobId: r.job_id, runs: [], counts: {}, approvals: 0 };
            by.set(r.job_id, g);
        }
        g.runs.push(r);
        g.counts[r.state] = (g.counts[r.state] || 0) + 1;
        if (awaitsApproval(r)) {
            g.approvals += 1;
        }
    });
    const groups = Array.from(by.values());
    groups.forEach((g) => g.runs.sort((a, b) => b.created_at - a.created_at));
    return groups.sort((a, b) => b.runs[0].created_at - a.runs[0].created_at);
}

const COUNT_ORDER: RunState[] = ['running', 'queued', 'blocked', 'paused', 'failed', 'succeeded', 'cancelled'];

function duration(run: RunSummary, now: number): string {
    if (!run.started_at) {
        return '';
    }
    return formatDuration((run.ended_at || now) - run.started_at);
}

export interface RunsTableProps {
    runs: RunSummary[];
    /** Job id to name, for the Job column and filter. */
    jobNames: Record<string, string>;
    filters: RunsTableFilters;
    onFiltersChange: (filters: RunsTableFilters) => void;
    /** Epoch seconds, for the duration of runs still going. */
    now?: number;
    /** Sends an action for many runs; without it, rows have no tick boxes. */
    bulk?: (action: BulkAction, runIds: string[], comment?: string) => Promise<BulkResult[]>;
    /** The user may approve, so Approve and Reject are offered. */
    canApprove?: boolean;
    /** Called after a bulk action, to reload the runs. */
    onChanged?: () => void;
}

const ALL = '';

export default function RunsTable({ runs, jobNames, filters, onFiltersChange, now, bulk, canApprove = false, onChanged }: RunsTableProps) {
    const at = now !== undefined ? now : Math.floor(Date.now() / 1000);
    const rows = filterRuns(runs, filters);
    const jobIds = Object.keys(jobNames).sort((a, b) => jobNames[a].localeCompare(jobNames[b]));
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [grouped, setGroupedState] = useState(storedGrouped);
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [picked, setPicked] = useState<Record<string, boolean>>({});
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    // Only runs still listed count as ticked (a filter or a reload can drop some).
    const selected = rows.filter((r) => picked[r.id]);
    const setMany = (ids: string[], on: boolean) =>
        setPicked((p) => {
            const next = { ...p };
            ids.forEach((id) => {
                if (on) {
                    next[id] = true;
                } else {
                    delete next[id];
                }
            });
            return next;
        });
    const tickState = (ids: string[]): boolean | 'some' => {
        const n = ids.filter((id) => picked[id]).length;
        return n === 0 ? false : n === ids.length ? true : 'some';
    };
    const allTick = tickState(rows.map((r) => r.id));
    const runLabel = (runId: string) => {
        const r = runs.find((x) => x.id === runId);
        return r ? `${jobNames[r.job_id] || r.job_id}${r.number ? ` run #${r.number}` : ''} (${formatTime(r.scheduled_time)})` : runId;
    };
    const setGrouped = (v: boolean) => {
        setGroupedState(v);
        try {
            window.localStorage.setItem(GROUPED_KEY, v ? '1' : '0');
        } catch (err) {
            // Not remembered; it still switches for this page.
        }
    };
    // One job picked: its runs, ungrouped.
    const showGroups = grouped && !filters.job_id;
    const stateCell = (run: RunSummary) => (
        <>
            <StatusText state={run.state} delayed={isRunDelayed(run)} detail={awaitsApproval(run) ? 'waiting for approval' : undefined} />
            {run.state === 'queued' && run.queue_reason && <QueueReasonLine reason={run.queue_reason} />}
        </>
    );
    const runRow = (run: RunSummary, nested: boolean) => (
        <Table.Row
            key={run.id}
            data-testid={`run-row-${run.id}`}
            onRequestToggle={bulk ? () => setMany([run.id], !picked[run.id]) : undefined}
            selected={bulk ? Boolean(picked[run.id]) : undefined}
            style={nested ? { boxShadow: `inset 3px 0 0 ${theme.borderColorStrong || theme.borderColor}` } : undefined}>
            <Table.Cell>
                {nested ? (
                    <span style={{ paddingLeft: '22px', color: theme.contentColorMuted, fontVariantNumeric: 'tabular-nums' }}>{run.number ? `Run #${run.number}` : 'Run'}</span>
                ) : (
                    jobNames[run.job_id] || run.job_id
                )}
            </Table.Cell>
            <Table.Cell>
                <Link to={pageHref('run', { run_id: run.id })}>{formatTime(run.scheduled_time)}</Link>
            </Table.Cell>
            <Table.Cell>{stateCell(run)}</Table.Cell>
            <Table.Cell>{duration(run, at)}</Table.Cell>
            <Table.Cell>{run.catchup ? `${run.trigger} (catch-up)` : run.trigger}</Table.Cell>
        </Table.Row>
    );
    return (
        <>
            <div style={{ display: 'flex', gap: '24px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {!filters.job_id && (
                    <ControlGroup label="Show" labelPosition="top">
                        <RadioBar aria-label="Show" value={grouped ? 'jobs' : 'runs'} onChange={(_e: unknown, { value }: { value: unknown }) => setGrouped(value === 'jobs')}>
                            <RadioBar.Option label="By job" value="jobs" />
                            <RadioBar.Option label="All runs" value="runs" />
                        </RadioBar>
                    </ControlGroup>
                )}
                <ControlGroup label="Job" labelFor="runs-filter-job" labelPosition="top">
                    <Select
                        inputId="runs-filter-job"
                        value={filters.job_id || ALL}
                        onChange={(_e: unknown, { value }: { value: unknown }) =>
                            onFiltersChange({ ...filters, job_id: value ? String(value) : undefined })
                        }
                    >
                        <Select.Option label="All jobs" value={ALL} />
                        {jobIds.map((id) => (
                            <Select.Option key={id} label={jobNames[id]} value={id} />
                        ))}
                    </Select>
                </ControlGroup>
                <ControlGroup label="State" labelFor="runs-filter-state" labelPosition="top">
                    <Select
                        inputId="runs-filter-state"
                        value={filters.state || ALL}
                        onChange={(_e: unknown, { value }: { value: unknown }) =>
                            onFiltersChange({ ...filters, state: value ? (String(value) as RunState | 'attention') : undefined })
                        }
                    >
                        <Select.Option label="All states" value={ALL} />
                        <Select.Option label="Needs attention" value="attention" />
                        {RUN_STATES.map((s) => (
                            <Select.Option key={s} label={statusLabel(s)} value={s} />
                        ))}
                    </Select>
                </ControlGroup>
            </div>
            {outcome && (() => {
                const text = outcomeText(outcome, runLabel);
                return (
                    <div data-testid="bulk-outcome" style={{ marginBottom: '8px' }}>
                        <Message type={text.failed.length ? 'warning' : 'success'} appearance="default" onRequestRemove={() => setOutcome(null)}>
                            <div>
                                {text.ok}
                                {text.failed.length > 0 && ` ${text.failed.length} could not be changed:`}
                            </div>
                            {text.failed.length > 0 && (
                                <ul style={{ margin: '4px 0 0', paddingLeft: '20px' }}>
                                    {text.failed.map((f) => (
                                        <li key={f}>{f}</li>
                                    ))}
                                </ul>
                            )}
                        </Message>
                    </div>
                );
            })()}
            {bulk && selected.length > 0 && (
                <BulkActions
                    selected={selected}
                    canApprove={canApprove}
                    jobNames={jobNames}
                    onClear={() => setPicked({})}
                    send={bulk}
                    onDone={(o) => {
                        setOutcome(o);
                        setPicked({});
                        if (onChanged) {
                            onChanged();
                        }
                    }}
                />
            )}
            {rows.length === 0 ? (
                <p>{runs.length ? 'No runs match these filters.' : 'No runs yet.'}</p>
            ) : (
                <Table
                    onRequestToggleAllRows={bulk ? () => setMany(rows.map((r) => r.id), allTick !== true) : undefined}
                    rowSelection={bulk ? (allTick === true ? 'all' : allTick === 'some' ? 'some' : 'none') : undefined}
                >
                    <Table.Head>
                        <Table.HeadCell>Job</Table.HeadCell>
                        <Table.HeadCell>{showGroups ? 'Latest run' : 'Scheduled time'}</Table.HeadCell>
                        <Table.HeadCell>State</Table.HeadCell>
                        <Table.HeadCell>{showGroups ? 'Runs' : 'Duration'}</Table.HeadCell>
                        <Table.HeadCell>Trigger</Table.HeadCell>
                    </Table.Head>
                    <Table.Body>
                        {showGroups
                            ? groupByJob(rows).flatMap((g) => {
                                  const isOpen = Boolean(open[g.jobId]);
                                  const latest = g.runs[0];
                                  const head = (
                                      <Table.Row
                                          key={`job:${g.jobId}`}
                                          data-testid={`job-group-${g.jobId}`}
                                          onRequestToggle={bulk ? () => setMany(g.runs.map((r) => r.id), tickState(g.runs.map((r) => r.id)) !== true) : undefined}
                                          selected={bulk ? tickState(g.runs.map((r) => r.id)) : undefined}
                                      >
                                          <Table.Cell>
                                              <button
                                                  type="button"
                                                  aria-expanded={isOpen}
                                                  onClick={() => setOpen((o) => ({ ...o, [g.jobId]: !isOpen }))}
                                                  style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                                              >
                                                  {`${isOpen ? '▾' : '▸'} ${jobNames[g.jobId] || g.jobId}`}
                                              </button>
                                              {g.approvals > 0 && (
                                                  <span
                                                      style={{
                                                          marginLeft: '8px',
                                                          padding: '1px 8px',
                                                          borderRadius: '10px',
                                                          fontSize: '12px',
                                                          fontWeight: 600,
                                                          border: `1px solid ${theme.statusColorMedium}`,
                                                          color: theme.statusColorMedium,
                                                      }}
                                                  >
                                                      {`⚑ ${g.approvals} waiting for approval`}
                                                  </span>
                                              )}
                                          </Table.Cell>
                                          <Table.Cell>
                                              <Link to={pageHref('run', { run_id: latest.id })}>{formatTime(latest.scheduled_time)}</Link>
                                          </Table.Cell>
                                          <Table.Cell>{stateCell(latest)}</Table.Cell>
                                          <Table.Cell>
                                              {[
                                                  `${g.runs.length} run${g.runs.length === 1 ? '' : 's'}`,
                                                  ...COUNT_ORDER.filter((s) => g.counts[s]).map((s) => `${g.counts[s]} ${statusLabel(s).toLowerCase()}`),
                                              ].join(' · ')}
                                          </Table.Cell>
                                          <Table.Cell>
                                              <Link onClick={() => onFiltersChange({ ...filters, job_id: g.jobId })}>Only this job</Link>
                                          </Table.Cell>
                                      </Table.Row>
                                  );
                                  // The server numbers each run within its job (oldest first, over all
                                  // its runs), so a run keeps its number in every filter.
                                  return isOpen ? [head, ...g.runs.map((run) => runRow(run, true))] : [head];
                              })
                            : rows.map((run) => runRow(run, false))}
                    </Table.Body>
                </Table>
            )}
        </>
    );
}
