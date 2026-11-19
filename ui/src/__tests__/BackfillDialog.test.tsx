import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../api/client';
import BackfillDialog from '../features/jobs/BackfillDialog';
import JobsTable from '../features/jobs/JobsTable';
import { job, me, NOW, renderThemed } from './fixtures';

const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime() / 1000;

function midnight(epoch: number, daysBack: number): number {
    const d = new Date(epoch * 1000);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - daysBack);
    return d.getTime() / 1000;
}

const daily = job({
    triggers: [{ type: 'cron', cron: '0 1 * * *', enabled: true }],
    params: [{ name: 'region', label: 'Region', default: 'eu' }],
});

function open(over: Record<string, unknown> = {}) {
    const props = {
        job: daily,
        open: true,
        onClose: jest.fn(),
        onStarted: jest.fn(),
        now: NOW,
        planBackfill: jest.fn().mockResolvedValue({ slots: [at(2025, 10, 1, 1, 0), at(2025, 10, 30, 1, 0)], count: 30 }),
        createBackfill: jest.fn().mockResolvedValue({ id: 'bf0123456789ab', job_id: 'daily' }),
        ...over,
    };
    renderThemed(<BackfillDialog {...(props as React.ComponentProps<typeof BackfillDialog>)} />);
    return props;
}

const start = () => screen.getByRole('button', { name: 'Start backfill' });

describe('BackfillDialog', () => {
    test('the summary comes from planBackfill', async () => {
        const props = open();
        expect(await screen.findByText('30 runs, from 1 Oct 01:00 to 30 Oct 01:00.', undefined, { timeout: 2000 })).toBeInTheDocument();
        expect(props.planBackfill).toHaveBeenCalledWith('daily', {
            from: midnight(NOW, 30),
            to: midnight(NOW, 0),
            source: 'schedule',
            concurrency: 1,
            params: { region: 'eu' },
        });
        expect(start()).not.toHaveAttribute('aria-disabled', 'true');
    });

    test('a too_many_slots reply shows its message and dims Start backfill', async () => {
        const message = 'This covers 240 runs; the most is 100. Shorten the range or use a longer step.';
        open({ planBackfill: jest.fn().mockRejectedValue(new ApiError(400, 'too_many_slots', message)) });
        expect(await screen.findByText(message, undefined, { timeout: 2000 })).toBeInTheDocument();
        expect(start()).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByText('Fix the problem shown above first.')).toBeInTheDocument();
    });

    test('Start backfill sends epoch times, the step and the queue limit', async () => {
        const props = open();
        fireEvent.click(screen.getByRole('radio', { name: /Every/ }));
        await waitFor(() => expect(props.planBackfill).toHaveBeenLastCalledWith('daily', expect.objectContaining({ source: 'step' })), { timeout: 2000 });
        await waitFor(() => expect(start()).not.toHaveAttribute('aria-disabled', 'true'));
        fireEvent.click(start());
        await waitFor(() => expect(props.createBackfill).toHaveBeenCalled());
        expect(props.createBackfill).toHaveBeenCalledWith('daily', {
            from: midnight(NOW, 30),
            to: midnight(NOW, 0),
            source: 'step',
            step: 86400,
            concurrency: 1,
            params: { region: 'eu' },
        });
        await waitFor(() => expect(props.onStarted).toHaveBeenCalledWith(expect.objectContaining({ id: 'bf0123456789ab' })));
    });

    test('every field has a label', () => {
        open();
        fireEvent.click(screen.getByRole('radio', { name: /Every/ }));
        ['From', 'From time (HH:MM)', 'To', 'To time (HH:MM)', 'Runs in the queue at once', 'Region'].forEach((label) =>
            expect(screen.getByLabelText(label)).toBeInTheDocument()
        );
        // The step's amount and its unit both carry the Every label.
        expect(screen.getByRole('spinbutton', { name: 'Every' })).toHaveValue('1');
        expect(screen.getAllByLabelText('Every')).toHaveLength(2);
        expect(screen.getByRole('radio', { name: /The job's schedule/ })).toBeInTheDocument();
    });

    test('a bad time asks for HH:MM and plans nothing', async () => {
        const props = open();
        await waitFor(() => expect(props.planBackfill).toHaveBeenCalledTimes(1), { timeout: 2000 });
        fireEvent.change(screen.getByLabelText('To time (HH:MM)'), { target: { value: '25:00' } });
        expect(await screen.findByText('Use HH:MM, 24-hour.')).toBeInTheDocument();
        expect(start()).toHaveAttribute('aria-disabled', 'true');
        await act(() => new Promise((r) => setTimeout(r, 600)));
        expect(props.planBackfill).toHaveBeenCalledTimes(1);
    });

    test('Escape closes', () => {
        const props = open();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(props.onClose).toHaveBeenCalled();
    });

    test('Backfill… is in the ⋯ menu, only for users who may run the job', () => {
        const onBackfill = jest.fn();
        const runnable = job();
        const viewOnly = job({ id: 'v', name: 'View only', permissions: { can_edit: false, can_run: false } });
        renderThemed(<JobsTable jobs={[runnable, viewOnly]} me={me} onRunNow={jest.fn()} onBackfill={onBackfill} onToggleEnabled={jest.fn()} />);
        expect(screen.queryByRole('button', { name: 'More actions for View only' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'More actions for Daily summary' }));
        fireEvent.click(screen.getByRole('menuitem', { name: /Backfill…/ }));
        expect(onBackfill).toHaveBeenCalledWith(expect.objectContaining({ id: 'daily' }));
    });
});
