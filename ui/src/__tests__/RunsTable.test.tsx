import React from 'react';
import { screen, within } from '@testing-library/react';
import RunsTable, { filterRuns } from '../features/runs/RunsTable';
import { formatTime } from '../format';
import { NOW, renderThemed, runSummary } from './fixtures';

const runs = [
    runSummary({ id: 'daily:1', state: 'succeeded', scheduled_time: NOW - 7200 }),
    runSummary({ id: 'daily:2', state: 'failed', scheduled_time: NOW - 3600, trigger: 'manual' }),
    runSummary({ id: 'weekly:1', job_id: 'weekly', state: 'running', ended_at: null, delay_alerted: true }),
];
const jobNames = { daily: 'Daily summary', weekly: 'Weekly rollup' };

describe('RunsTable', () => {
    test('RunsTable filters by state', () => {
        expect(filterRuns(runs, { state: 'failed' }).map((r) => r.id)).toEqual(['daily:2']);
        expect(filterRuns(runs, { job_id: 'weekly' }).map((r) => r.id)).toEqual(['weekly:1']);
        expect(filterRuns(runs, {}).length).toBe(3);

        renderThemed(
            <RunsTable runs={runs} jobNames={jobNames} filters={{ state: 'failed' }} onFiltersChange={jest.fn()} now={NOW} />
        );
        const rows = screen.getAllByRole('row').slice(1);
        expect(rows).toHaveLength(1);
        expect(within(rows[0]).getByText('Failed')).toBeInTheDocument();
        expect(within(rows[0]).getByText('manual')).toBeInTheDocument();
        expect(screen.queryByText('Succeeded')).toBeNull();
    });

    test('shows job, scheduled time, state, duration and trigger', () => {
        renderThemed(<RunsTable runs={runs} jobNames={jobNames} filters={{}} onFiltersChange={jest.fn()} now={NOW} />);
        const row = screen.getAllByRole('row')[3];
        expect(within(row).getByText('Weekly rollup')).toBeInTheDocument();
        expect(within(row).getByText('Delayed')).toBeInTheDocument();
        expect(within(row).getByText('1h 0m')).toBeInTheDocument();
        const link = within(screen.getAllByRole('row')[1]).getByRole('link', { name: formatTime(NOW - 7200) });
        expect(link.getAttribute('href')).toContain('run?run_id=daily%3A1');
    });

    test('says so when nothing matches', () => {
        renderThemed(
            <RunsTable runs={runs} jobNames={jobNames} filters={{ state: 'paused' }} onFiltersChange={jest.fn()} now={NOW} />
        );
        expect(screen.getByText('No runs match these filters.')).toBeInTheDocument();
    });
});
