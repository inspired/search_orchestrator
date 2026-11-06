/* The Runs table: job, scheduled time, state, duration and trigger, with filters. */
import React from 'react';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Link from '@splunk/react-ui/Link';
import Select from '@splunk/react-ui/Select';
import Table from '@splunk/react-ui/Table';
import { RUN_STATES } from '../../api/types';
import type { RunFilters, RunState, RunSummary } from '../../api/types';
import StatusText, { isRunDelayed, statusLabel } from '../../components/StatusText';
import { pageHref } from '../../components/PageShell';
import { formatDuration, formatTime } from '../../format';

export type RunsTableFilters = Pick<RunFilters, 'job_id' | 'state'>;

export function filterRuns(runs: RunSummary[], filters: RunsTableFilters): RunSummary[] {
    return runs.filter(
        (r) => (!filters.state || r.state === filters.state) && (!filters.job_id || r.job_id === filters.job_id)
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
    /** Job id to name, for the Job column and filter. */
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
    const jobIds = Object.keys(jobNames).sort((a, b) => jobNames[a].localeCompare(jobNames[b]));
    return (
        <>
            <div style={{ display: 'flex', gap: '24px', marginBottom: '16px', flexWrap: 'wrap' }}>
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
                <p>{runs.length ? 'No runs match these filters.' : 'No runs yet.'}</p>
            ) : (
                <Table stripeRows>
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
