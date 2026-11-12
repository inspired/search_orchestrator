/* The Runs table: job, scheduled time, state, duration and trigger, with filters. */
import React from 'react';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Link from '@splunk/react-ui/Link';
import Progress from '@splunk/react-ui/Progress';
import Select from '@splunk/react-ui/Select';
import Table from '@splunk/react-ui/Table';
import Text from '@splunk/react-ui/Text';
import { RUN_STATES } from '../../api/types';
import type { RunFilters, RunState, RunSummary } from '../../api/types';
import StatusText, { isRunDelayed, statusLabel } from '../../components/StatusText';
import { pageHref } from '../../components/PageShell';
import { formatDuration, formatTime } from '../../format';

export type RunsTableFilters = Pick<RunFilters, 'q' | 'state'>;

/** The server applies the filters; this hides rows at once when the state changes. */
export function filterRuns(runs: RunSummary[], filters: RunsTableFilters): RunSummary[] {
    return runs.filter((r) => !filters.state || r.state === filters.state);
}

const IN_PROGRESS = ['running', 'paused', 'blocked'];
const FINISHED_STEP = ['succeeded', 'failed', 'skipped', 'cancelled', 'abandoned'];

/** Steps finished out of all steps, for a run that has started and not ended; else null. */
export function stepProgress(run: Pick<RunSummary, 'state' | 'steps'>): { done: number; total: number } | null {
    const steps = Object.values(run.steps || {});
    if (!IN_PROGRESS.includes(run.state) || steps.length === 0) {
        return null;
    }
    return { done: steps.filter((s) => FINISHED_STEP.includes(s.state)).length, total: steps.length };
}

function RunProgress({ run }: { run: RunSummary }) {
    const p = stepProgress(run);
    if (!p) {
        return null;
    }
    const label = `${p.done} of ${p.total} step${p.total === 1 ? '' : 's'} done`;
    return (
        <div style={{ marginTop: '4px', maxWidth: '160px' }} data-testid="run-progress" aria-label={label}>
            <Progress percentage={(p.done / p.total) * 100} type={run.state === 'blocked' ? 'error' : 'info'} tooltip={label} />
        </div>
    );
}

function duration(run: RunSummary, now: number): string {
    if (!run.started_at) {
        return '';
    }
    return formatDuration((run.ended_at || now) - run.started_at);
}

export interface RunsTableProps {
    runs: RunSummary[];
    /** Job id to name, for the Job column. */
    jobNames: Record<string, string>;
    filters: RunsTableFilters;
    onFiltersChange: (filters: RunsTableFilters) => void;
    /** Epoch seconds, for the duration of runs still going. */
    now?: number;
}

const ALL = '';

export default function RunsTable({ runs, jobNames, filters, onFiltersChange, now }: RunsTableProps) {
    const at = now !== undefined ? now : Math.floor(Date.now() / 1000);
    const rows = filterRuns(runs, filters);
    return (
        <>
            <div style={{ display: 'flex', gap: '24px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <ControlGroup label="Search by job name" labelFor="runs-search" labelPosition="top">
                    <Text
                        inputId="runs-search"
                        value={filters.q || ''}
                        canClear
                        onChange={(_e: unknown, { value }: { value: string }) =>
                            onFiltersChange({ ...filters, q: value })
                        }
                    />
                </ControlGroup>
                <ControlGroup label="State" labelFor="runs-filter-state" labelPosition="top">
                    <Select
                        inputId="runs-filter-state"
                        value={filters.state || ALL}
                        onChange={(_e: unknown, { value }: { value: unknown }) =>
                            onFiltersChange({ ...filters, state: value ? (String(value) as RunState) : undefined })
                        }
                    >
                        <Select.Option label="All states" value={ALL} />
                        {RUN_STATES.map((s) => (
                            <Select.Option key={s} label={statusLabel(s)} value={s} />
                        ))}
                    </Select>
                </ControlGroup>
            </div>
            {rows.length === 0 ? (
                <p>{runs.length || filters.q || filters.state ? 'No runs match these filters.' : 'No runs yet.'}</p>
            ) : (
                <Table>
                    <Table.Head>
                        <Table.HeadCell>Job</Table.HeadCell>
                        <Table.HeadCell>Scheduled time</Table.HeadCell>
                        <Table.HeadCell>State</Table.HeadCell>
                        <Table.HeadCell>Duration</Table.HeadCell>
                        <Table.HeadCell>Trigger</Table.HeadCell>
                    </Table.Head>
                    <Table.Body>
                        {rows.map((run) => (
                            <Table.Row key={run.id}>
                                <Table.Cell>{jobNames[run.job_id] || run.job_id}</Table.Cell>
                                <Table.Cell>
                                    <Link to={pageHref('run', { run_id: run.id })}>{formatTime(run.scheduled_time)}</Link>
                                </Table.Cell>
                                <Table.Cell>
                                    <StatusText state={run.state} delayed={isRunDelayed(run)} />
                                    <RunProgress run={run} />
                                </Table.Cell>
                                <Table.Cell>{duration(run, at)}</Table.Cell>
                                <Table.Cell>{run.catchup ? `${run.trigger} (catch-up)` : run.trigger}</Table.Cell>
                            </Table.Row>
                        ))}
                    </Table.Body>
                </Table>
            )}
        </>
    );
}
