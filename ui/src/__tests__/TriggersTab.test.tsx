import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import TriggersTab from '../features/builder/TriggersTab';
import type { JobDefinition } from '../api/types';
import { ApiError } from '../api/client';
import { renderThemed } from './fixtures';

const SLOTS = [1762390800, 1762477200, 1762563600]; // 2025-11-06 01:00 UTC, then daily

function jobWith(triggers: JobDefinition['triggers'], timezone?: string): JobDefinition {
    return { name: 'j', steps: [{ id: 'a', type: 'inline', spl: '| makeresults' }], triggers, timezone } as JobDefinition;
}

function setup(job: JobDefinition, nextSlots?: jest.Mock) {
    const dispatch = jest.fn();
    const next = nextSlots || jest.fn().mockResolvedValue({ slots: SLOTS, timezone_status: 'ok' });
    renderThemed(<TriggersTab job={job} jobs={[]} dispatch={dispatch} nextSlots={next} />);
    return { dispatch, next };
}

describe('TriggersTab schedules', () => {
    test('a cron no preset matches opens as Custom and is not rewritten', async () => {
        const job = jobWith([{ type: 'cron', cron: '0 1 * * 1-5' }]);
        const { dispatch, next } = setup(job);
        expect(screen.getByRole('radio', { name: 'Custom' })).toBeChecked();
        expect(screen.getByLabelText('Cron')).toHaveValue('0 1 * * 1-5');
        await waitFor(() => expect(next).toHaveBeenCalledWith('0 1 * * 1-5', null, 3));
        expect(dispatch).not.toHaveBeenCalled();
    });

    test('a daily cron opens as Daily with its time', () => {
        setup(jobWith([{ type: 'cron', cron: '30 2 * * *' }]));
        expect(screen.getByRole('radio', { name: 'Daily' })).toBeChecked();
        expect(screen.getByLabelText('Time (HH:MM)')).toHaveValue('02:30');
    });

    test('picking Daily and a time dispatches the cron', () => {
        const { dispatch } = setup(jobWith([{ type: 'cron', cron: '*/15 * * * *' }]));
        fireEvent.click(screen.getByRole('radio', { name: 'Daily' }));
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'setJobField', field: 'triggers', value: [{ type: 'cron', cron: '0 1 * * *' }] });
    });

    test('editing the time sends the new cron', () => {
        const { dispatch } = setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }]));
        fireEvent.change(screen.getByLabelText('Time (HH:MM)'), { target: { value: '02:30' } });
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'setJobField', field: 'triggers', value: [{ type: 'cron', cron: '30 2 * * *' }] });
    });

    test('a bad time is not sent', () => {
        const { dispatch } = setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }]));
        fireEvent.change(screen.getByLabelText('Time (HH:MM)'), { target: { value: '25:00' } });
        expect(dispatch).not.toHaveBeenCalled();
        expect(screen.getByText('Use HH:MM, 24-hour.')).toBeInTheDocument();
    });

    test('shows the summary and the next runs in the job time zone', async () => {
        setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }], 'Europe/Oslo'));
        expect(screen.getByText('Every day at 01:00, in Europe/Oslo')).toBeInTheDocument();
        expect(await screen.findByText('Next runs')).toBeInTheDocument();
        // 01:00 UTC is 02:00 in Oslo.
        await waitFor(() => expect(screen.getAllByText(/02:00/)).toHaveLength(3));
    });

    test('a bad_cron reply is the Custom field error', async () => {
        const next = jest.fn().mockRejectedValue(new ApiError(400, 'bad_cron', 'Cron needs five fields.'));
        setup(jobWith([{ type: 'cron', cron: '* *' }]), next);
        expect(await screen.findByText('Cron needs five fields.')).toBeInTheDocument();
    });

    test('a stored time zone the browser does not list stays selected', () => {
        setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }], 'Etc/Unknown'));
        expect(screen.getByLabelText('Time zone')).toHaveValue('Etc/Unknown');
    });

    test('Add schedule adds the daily default', () => {
        const { dispatch } = setup(jobWith([]));
        fireEvent.click(screen.getByRole('button', { name: 'Add schedule' }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'setJobField', field: 'triggers', value: [{ type: 'cron', cron: '0 1 * * *' }] });
    });
});
