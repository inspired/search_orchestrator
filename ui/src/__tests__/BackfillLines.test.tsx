import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Backfill } from '../api/backfills';
import BackfillLines from '../features/runs/BackfillLines';
import { renderThemed } from './fixtures';

const backfill = (over: Partial<Backfill> = {}): Backfill => ({
    id: 'bf0123456789ab',
    job_id: 'daily',
    created_by: 'alice',
    created_at: 1700000000,
    from: 1700000000,
    to: 1702592000,
    source: 'schedule',
    step: null,
    concurrency: 1,
    next: 13,
    count: 30,
    state: 'running',
    run_ids: [],
    ...over,
});

function runs() {
    const out = [];
    for (let i = 0; i < 12; i += 1) {
        out.push({ id: `daily:backfill-bf0123456789ab:${i}`, state: i === 3 ? 'failed' : 'succeeded', scheduled_time: i });
    }
    out.push({ id: 'daily:backfill-bf0123456789ab:12', state: 'running', scheduled_time: 12 });
    return out;
}

function api(over = {}) {
    return {
        listBackfills: jest.fn().mockResolvedValue([backfill()]),
        getBackfill: jest.fn().mockResolvedValue({ backfill: backfill(), runs: runs() }),
        cancelBackfill: jest.fn().mockResolvedValue({ command_id: 'c1' }),
        ...over,
    };
}

describe('BackfillLines', () => {
    test('one line per running backfill of the job', async () => {
        const a = api();
        renderThemed(<BackfillLines jobId="daily" api={a} />);
        expect(await screen.findByText('Backfill of 30 runs: 12 finished, 1 running, 17 to go.')).toBeInTheDocument();
        expect(a.listBackfills).toHaveBeenCalledWith({ job_id: 'daily', state: 'running' });
        expect(a.getBackfill).toHaveBeenCalledWith('bf0123456789ab');
    });

    test('Cancel backfill asks first, then cancels', async () => {
        const a = api();
        renderThemed(<BackfillLines jobId="daily" api={a} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel backfill' }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Cancel this backfill?')).toBeInTheDocument();
        expect(within(dialog).getByText('Runs that already finished are kept.')).toBeInTheDocument();
        expect(a.cancelBackfill).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel backfill' }));
        await waitFor(() => expect(a.cancelBackfill).toHaveBeenCalledWith('bf0123456789ab'));
    });

    test('Keep backfill closes the question without cancelling', async () => {
        const a = api();
        renderThemed(<BackfillLines jobId="daily" api={a} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel backfill' }));
        fireEvent.click(screen.getByRole('button', { name: 'Keep backfill' }));
        await waitFor(() => expect(screen.queryByText('Cancel this backfill?')).toBeNull());
        expect(a.cancelBackfill).not.toHaveBeenCalled();
    });

    test('nothing shows without a running backfill', async () => {
        const a = api({ listBackfills: jest.fn().mockResolvedValue([]) });
        const { container } = renderThemed(<BackfillLines jobId="daily" api={a} />);
        await waitFor(() => expect(a.listBackfills).toHaveBeenCalled());
        expect(container.textContent).toBe('');
    });
});
