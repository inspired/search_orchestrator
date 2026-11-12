import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import RunsTable, { filterRuns, stepProgress } from '../features/runs/RunsTable';
import RunsPage, { RunsApi } from '../features/runs/RunsPage';
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

    test('says no runs match when a search returned nothing', () => {
        renderThemed(<RunsTable runs={[]} jobNames={{}} filters={{ q: 'sales' }} onFiltersChange={jest.fn()} now={NOW} />);
        expect(screen.getByText('No runs match these filters.')).toBeInTheDocument();
    });

    test('says no runs yet only when nothing is filtered', () => {
        renderThemed(<RunsTable runs={[]} jobNames={{}} filters={{}} onFiltersChange={jest.fn()} now={NOW} />);
        expect(screen.getByText('No runs yet.')).toBeInTheDocument();
    });

    test('the search box replaces the job dropdown', () => {
        const onFiltersChange = jest.fn();
        renderThemed(<RunsTable runs={runs} jobNames={jobNames} filters={{ state: 'failed' }} onFiltersChange={onFiltersChange} now={NOW} />);
        expect(screen.queryByText('All jobs')).toBeNull();
        fireEvent.change(screen.getByRole('textbox', { name: 'Search by job name' }), { target: { value: 'sales' } });
        expect(onFiltersChange).toHaveBeenCalledWith({ state: 'failed', q: 'sales' });
    });
});

describe('Run progress', () => {
    const steps = {
        a: { state: 'succeeded' as const },
        b: { state: 'skipped' as const },
        c: { state: 'running' as const },
        d: { state: 'waiting' as const },
    };

    test('counts finished steps for runs in progress only', () => {
        expect(stepProgress(runSummary({ state: 'running', steps }))).toEqual({ done: 2, total: 4 });
        expect(stepProgress(runSummary({ state: 'blocked', steps }))).toEqual({ done: 2, total: 4 });
        expect(stepProgress(runSummary({ state: 'queued', steps }))).toBeNull();
        expect(stepProgress(runSummary({ state: 'succeeded', steps }))).toBeNull();
        expect(stepProgress(runSummary({ state: 'running', steps: {} }))).toBeNull();
    });

    test('shows a progress bar with the step count on running runs', () => {
        const runs = [runSummary({ id: 'r1', state: 'running', steps }), runSummary({ id: 'r2', state: 'succeeded', steps })];
        renderThemed(<RunsTable runs={runs} jobNames={{}} filters={{}} onFiltersChange={jest.fn()} now={NOW} />);
        const bars = screen.getAllByTestId('run-progress');
        expect(bars).toHaveLength(1);
        expect(bars[0]).toHaveAttribute('aria-label', '2 of 4 steps done');
    });
});

describe('RunsPage', () => {
    afterEach(() => window.history.replaceState(null, '', '/'));

    function runsApi(over: Partial<RunsApi> = {}): RunsApi {
        return {
            listJobs: jest.fn(() => Promise.resolve([])),
            searchRuns: jest.fn(() => Promise.resolve({ runs })),
            ...over,
        } as unknown as RunsApi;
    }

    test('typing searches by job name after a pause and keeps it in the URL', async () => {
        const api = runsApi();
        renderThemed(<RunsPage api={api} />);
        const box = await screen.findByRole('textbox', { name: 'Search by job name' });
        fireEvent.change(box, { target: { value: 'sales' } });
        await waitFor(() => expect(api.searchRuns).toHaveBeenLastCalledWith({ q: 'sales', state: undefined }));
        expect(window.location.search).toBe('?q=sales');
    });

    test('an old job_id link becomes a search for that id', async () => {
        window.history.replaceState(null, '', '/?job_id=daily');
        const api = runsApi();
        renderThemed(<RunsPage api={api} />);
        await waitFor(() => expect(api.searchRuns).toHaveBeenCalledWith({ q: 'daily', state: undefined }));
    });

    test('job names come from the list of jobs, and a deleted job shows its id', async () => {
        const api = runsApi({ listJobs: jest.fn(() => Promise.resolve([{ id: 'daily', name: 'Daily summary' }])) } as unknown as Partial<RunsApi>);
        renderThemed(<RunsPage api={api} />);
        expect((await screen.findAllByText('Daily summary')).length).toBeGreaterThan(0);
        expect(screen.getByText('weekly')).toBeInTheDocument();
    });

    test('warns when a search stopped before looking at every run', async () => {
        renderThemed(<RunsPage api={runsApi({ searchRuns: jest.fn(() => Promise.resolve({ runs, partial: true })) } as Partial<RunsApi>)} />);
        expect(await screen.findByText(/Older matching runs may be missing/)).toBeInTheDocument();
    });
});
