import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RunsTable, { filterRuns, needsAttention } from '../features/runs/RunsTable';
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

    test('needsAttention keeps blocked, failed and held runs', () => {
        expect(needsAttention(runSummary({ state: 'succeeded', held: true }))).toBe(true);
        expect(needsAttention(runSummary({ state: 'blocked' }))).toBe(true);
        expect(needsAttention(runSummary({ state: 'failed' }))).toBe(true);
        expect(needsAttention(runSummary({ state: 'succeeded' }))).toBe(false);
        expect(needsAttention(runSummary({ state: 'running' }))).toBe(false);
    });

    test('Needs attention option follows All states', async () => {
        const user = userEvent.setup();
        renderThemed(<RunsTable runs={runs} jobNames={jobNames} filters={{}} onFiltersChange={jest.fn()} now={NOW} />);
        await user.click(screen.getByLabelText('State'));
        const labels = screen.getAllByRole('option').map((o) => o.textContent);
        expect(labels.slice(0, 2)).toEqual(['All states', 'Needs attention']);
    });

    test('attention filter shows only runs that need attention', () => {
        const mixed = [...runs, runSummary({ id: 'daily:3', state: 'succeeded', held: true })];
        renderThemed(
            <RunsTable runs={mixed} jobNames={jobNames} filters={{ state: 'attention' }} onFiltersChange={jest.fn()} now={NOW} />
        );
        expect(screen.getAllByRole('row').slice(1)).toHaveLength(2);
    });

    test('a run with a step waiting for approval says so and needs attention', () => {
        const waiting = runSummary({
            id: 'daily:9',
            state: 'running',
            ended_at: null,
            steps: { a: { state: 'succeeded' }, gate: { state: 'awaiting_approval', approval_state: { requested_at: NOW - 60, message: 'ok?', decision: null } } },
        });
        expect(needsAttention(waiting)).toBe(true);
        expect(needsAttention(runSummary({ state: 'running', ended_at: null, steps: { a: { state: 'running' } } }))).toBe(false);
        renderThemed(
            <RunsTable runs={[...runs, waiting]} jobNames={jobNames} filters={{ state: 'attention' }} onFiltersChange={jest.fn()} now={NOW} />
        );
        const rows = screen.getAllByRole('row').slice(1);
        expect(rows).toHaveLength(2);
        expect(within(rows[1]).getByText('Running · waiting for approval')).toBeInTheDocument();
        expect(within(rows[0]).queryByText(/waiting for approval/)).toBeNull();
    });
});
