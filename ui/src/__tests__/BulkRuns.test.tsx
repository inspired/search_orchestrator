import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import RunsTable from '../features/runs/RunsTable';
import { applicable } from '../features/runs/BulkActions';
import type { RunSummary } from '../api/types';
import { NOW, renderThemed, runSummary } from './fixtures';

const waiting = runSummary({
    id: 'health:2',
    job_id: 'health',
    state: 'running',
    created_at: NOW - 60,
    steps: { approve: { state: 'awaiting_approval', approval_state: { requested_at: NOW - 300, message: '', decision: null } } } as RunSummary['steps'],
});
const runs = [
    waiting,
    runSummary({ id: 'daily:3', job_id: 'daily', state: 'failed', created_at: NOW - 100, number: 3 }),
    runSummary({ id: 'daily:2', job_id: 'daily', state: 'queued', created_at: NOW - 200, number: 2 }),
    runSummary({ id: 'daily:1', job_id: 'daily', created_at: NOW - 300, number: 1 }),
];
const names = { daily: 'Daily', health: 'Health' };
const tick = (row: HTMLElement) => fireEvent.click(within(row).getByRole('checkbox'));

describe('Bulk actions on runs', () => {
    beforeEach(() => window.localStorage.setItem('so.runs.grouped', '0'));

    test('applicable picks the runs each action can change', () => {
        expect(applicable(runs, 'cancel').map((r) => r.id)).toEqual(['health:2', 'daily:2']);
        expect(applicable(runs, 'rerun').map((r) => r.id)).toEqual(['daily:3']);
        expect(applicable(runs, 'approve').map((r) => r.id)).toEqual(['health:2']);
    });

    test('no tick boxes without bulk', () => {
        renderThemed(<RunsTable runs={runs} jobNames={names} filters={{}} onFiltersChange={jest.fn()} now={NOW} />);
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });

    test('tick runs, see the actions that apply, confirm, and read the outcome', async () => {
        const bulk = jest.fn().mockResolvedValue([
            { run_id: 'health:2', ok: true },
            { run_id: 'daily:2', ok: false, code: 'invalid_state', message: 'a succeeded run cannot be cancelled' },
        ]);
        const onChanged = jest.fn();
        renderThemed(<RunsTable runs={runs} jobNames={names} filters={{}} onFiltersChange={jest.fn()} now={NOW} bulk={bulk} canApprove={false} onChanged={onChanged} />);
        tick(screen.getByTestId('run-row-health:2'));
        tick(screen.getByTestId('run-row-daily:2'));
        tick(screen.getByTestId('run-row-daily:3'));
        const bar = screen.getByTestId('bulk-actions');
        expect(bar).toHaveTextContent('3 runs selected');
        expect(within(bar).getByRole('button', { name: 'Cancel 2' })).toBeInTheDocument();
        expect(within(bar).getByRole('button', { name: 'Re-run 1' })).toBeInTheDocument();
        expect(within(bar).queryByRole('button', { name: /Approve/ })).toBeNull(); // may not approve
        fireEvent.click(within(bar).getByRole('button', { name: 'Cancel 2' }));
        expect(screen.getByTestId('bulk-targets').querySelectorAll('li')).toHaveLength(2);
        expect(screen.getByText(/The other 1 run you selected/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel 2 runs' }));
        await waitFor(() => expect(screen.getByTestId('bulk-outcome')).toBeInTheDocument());
        expect(bulk).toHaveBeenCalledWith('cancel', ['health:2', 'daily:2'], undefined);
        expect(screen.getByTestId('bulk-outcome')).toHaveTextContent('Asked to cancel 1 run. 1 could not be changed:');
        expect(screen.getByTestId('bulk-outcome')).toHaveTextContent('Daily run #2');
        expect(onChanged).toHaveBeenCalled();
        expect(screen.queryByTestId('bulk-actions')).toBeNull(); // selection cleared
    });

    test('reject needs a comment', async () => {
        const bulk = jest.fn().mockResolvedValue([{ run_id: 'health:2', ok: true }]);
        renderThemed(<RunsTable runs={runs} jobNames={names} filters={{}} onFiltersChange={jest.fn()} now={NOW} bulk={bulk} canApprove />);
        tick(screen.getByTestId('run-row-health:2'));
        fireEvent.click(screen.getByRole('button', { name: 'Reject 1' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reject 1 run' }));
        expect(screen.getByText('Add a comment saying why you reject')).toBeInTheDocument();
        expect(bulk).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Comment (required)'), { target: { value: 'not today' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reject 1 run' }));
        await waitFor(() => expect(bulk).toHaveBeenCalledWith('reject', ['health:2'], 'not today'));
    });

    test('a job row ticks all its runs', () => {
        window.localStorage.setItem('so.runs.grouped', '1');
        renderThemed(<RunsTable runs={runs} jobNames={names} filters={{}} onFiltersChange={jest.fn()} now={NOW} bulk={jest.fn()} />);
        tick(screen.getByTestId('job-group-daily'));
        expect(screen.getByTestId('bulk-actions')).toHaveTextContent('3 runs selected');
    });
});
