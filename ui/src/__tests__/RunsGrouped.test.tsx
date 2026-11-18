import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react';
import RunsTable, { groupByJob } from '../features/runs/RunsTable';
import ApprovalAlert, { pendingApprovals, reviewHref } from '../components/ApprovalAlert';
import type { RunSummary } from '../api/types';
import { NOW, renderThemed, runSummary } from './fixtures';

const waiting = (over: Partial<RunSummary> = {}) =>
    runSummary({
        id: 'health:2',
        job_id: 'health',
        state: 'running',
        created_at: NOW - 60,
        steps: { approve: { state: 'awaiting_approval', approval_state: { requested_at: NOW - 300, message: 'Open an incident?', decision: null } } } as RunSummary['steps'],
        ...over,
    });

const runs = [
    waiting(),
    runSummary({ id: 'daily:3', job_id: 'daily', state: 'failed', created_at: NOW - 100 }),
    runSummary({ id: 'daily:2', job_id: 'daily', created_at: NOW - 200 }),
    runSummary({ id: 'daily:1', job_id: 'daily', created_at: NOW - 300 }),
];

describe('Runs grouped by job', () => {
    beforeEach(() => window.localStorage.setItem('so.runs.grouped', '1'));

    test('groupByJob: newest job first, counts and approvals', () => {
        const g = groupByJob(runs);
        expect(g.map((x) => x.jobId)).toEqual(['health', 'daily']);
        expect(g[1].counts).toEqual({ failed: 1, succeeded: 2 });
        expect(g[0].approvals).toBe(1);
    });

    test('one row per job that opens to its runs; Only this job filters', () => {
        const onFiltersChange = jest.fn();
        renderThemed(<RunsTable runs={runs} jobNames={{ daily: 'Daily', health: 'Health' }} filters={{}} onFiltersChange={onFiltersChange} now={NOW} />);
        expect(screen.getAllByRole('row')).toHaveLength(3); // head + 2 jobs
        const daily = screen.getByTestId('job-group-daily');
        expect(daily).toHaveTextContent('3 runs · 1 failed · 2 succeeded');
        expect(screen.getByTestId('job-group-health')).toHaveTextContent('⚑ 1 waiting for approval');
        fireEvent.click(within(daily).getByRole('button', { name: /Daily/ }));
        expect(screen.getAllByRole('row')).toHaveLength(6);
        fireEvent.click(within(daily).getByText('Only this job'));
        expect(onFiltersChange).toHaveBeenCalledWith({ job_id: 'daily' });
    });

    test('All runs shows the flat list, and is remembered', () => {
        renderThemed(<RunsTable runs={runs} jobNames={{}} filters={{}} onFiltersChange={jest.fn()} now={NOW} />);
        fireEvent.click(screen.getByRole('radio', { name: 'All runs' }));
        expect(screen.getAllByRole('row')).toHaveLength(5);
        expect(window.localStorage.getItem('so.runs.grouped')).toBe('0');
    });
});

describe('Approval alert', () => {
    test('lists steps waiting for approval, longest first, with Review to the step', async () => {
        const second = waiting({ id: 'health:3', created_at: NOW - 10 });
        second.steps = { gate: { state: 'awaiting_approval', approval_state: { requested_at: NOW - 900, message: '', decision: null } } } as RunSummary['steps'];
        const pending = pendingApprovals([waiting(), second]);
        expect(pending.map((p) => p.stepId)).toEqual(['gate', 'approve']);
        expect(reviewHref(pending[1])).toBe('run?run_id=health%3A2&step=approve');
        renderThemed(<ApprovalAlert load={() => Promise.resolve([waiting(), second])} />);
        await act(async () => {
            await Promise.resolve();
        });
        const alert = screen.getByRole('alert', { name: 'Waiting for approval' });
        expect(alert).toHaveTextContent('⚑ 2 steps are waiting for approval');
        expect(alert).toHaveTextContent('“Open an incident?”');
        expect(within(alert).getAllByRole('link', { name: 'Review' })[0].getAttribute('href')).toBe('run?run_id=health%3A3&step=gate');
    });

    test('shows nothing when nothing waits', async () => {
        renderThemed(<ApprovalAlert load={() => Promise.resolve([runSummary()])} />);
        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.queryByTestId('approval-alert')).toBeNull();
    });
});
