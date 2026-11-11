import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import TriggersTab from '../features/builder/TriggersTab';
import { formatSlot, zoneLabel } from '../features/builder/ScheduleEditor';
import type { JobDefinition } from '../api/types';
import { ApiError } from '../api/client';
import { renderThemed } from './fixtures';

const SLOTS = [1762390800, 1762477200, 1762563600]; // 2025-11-06 01:00 UTC, then daily

function jobWith(triggers: JobDefinition['triggers'], timezone?: string): JobDefinition {
    return { name: 'j', steps: [{ id: 'a', type: 'inline', spl: '| makeresults' }], triggers, timezone } as JobDefinition;
}

function reply(over: Record<string, unknown> = {}) {
    return { slots: SLOTS, utc_offsets: [0, 0, 0], timezone: null, timezone_status: 'ok', ...over };
}

function setup(job: JobDefinition, nextSlots?: jest.Mock) {
    const dispatch = jest.fn();
    const next = nextSlots || jest.fn().mockResolvedValue(reply());
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

    test('two schedules each open in their own mode and edit independently', () => {
        const triggers = [
            { type: 'cron' as const, cron: '0 1 * * *' },
            { type: 'cron' as const, cron: '*/15 * * * *' },
        ];
        const { dispatch } = setup(jobWith(triggers));
        expect(screen.getAllByRole('radio', { name: 'Daily' })[0]).toBeChecked();
        expect(screen.getAllByRole('radio', { name: 'Custom' })[1]).toBeChecked();
        expect(screen.getByLabelText('Cron')).toHaveValue('*/15 * * * *');
        expect(dispatch).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Time (HH:MM)'), { target: { value: '02:30' } });
        expect(dispatch).toHaveBeenLastCalledWith({
            type: 'setJobField',
            field: 'triggers',
            value: [
                { type: 'cron', cron: '30 2 * * *' },
                { type: 'cron', cron: '*/15 * * * *' },
            ],
        });
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
        const next = jest.fn().mockResolvedValue(reply({ timezone: 'Europe/Oslo', utc_offsets: [3600, 3600, 3600] }));
        setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }], 'Europe/Oslo'), next);
        expect(screen.getByText('Every day at 01:00, in Europe/Oslo')).toBeInTheDocument();
        expect(await screen.findByText('Next runs')).toBeInTheDocument();
        // 01:00 UTC is 02:00 in Oslo.
        await waitFor(() => expect(screen.getAllByText(/02:00/)).toHaveLength(3));
    });

    test('with no job zone the next runs use the server offset and say so', async () => {
        // The server is at UTC-05:00: 01:00 UTC is 20:00 the evening before.
        const next = jest.fn().mockResolvedValue(reply({ utc_offsets: [-18000, -18000, -18000] }));
        setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }]), next);
        expect(screen.getByText("Every day at 01:00, in the server's time zone")).toBeInTheDocument();
        expect(await screen.findByText("Every day at 01:00, in the server's time zone (UTC-05:00)")).toBeInTheDocument();
        await waitFor(() => expect(screen.getAllByText(/20:00/)).toHaveLength(3));
        expect(screen.queryByText(/Unknown time zone/)).not.toBeInTheDocument();
    });

    test('an unknown job zone says the times are in server time', async () => {
        const next = jest.fn().mockResolvedValue(reply({ utc_offsets: [3600, 3600, 3600], timezone_status: 'unknown' }));
        setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }], 'Etc/Unknown'), next);
        expect(await screen.findByText('Unknown time zone; times are shown in server time.')).toBeInTheDocument();
        expect(screen.getByText("Every day at 01:00, in the server's time zone (UTC+01:00)")).toBeInTheDocument();
        await waitFor(() => expect(screen.getAllByText(/02:00/)).toHaveLength(3));
    });

    test('a weekly schedule with no days says to pick one instead of the old summary', async () => {
        const { dispatch } = setup(jobWith([{ type: 'cron', cron: '30 6 * * 1' }]));
        expect(screen.getByText('Every Monday at 06:30, in the server\'s time zone')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('option', { name: /^Remove Monday/ }));
        await waitFor(() => expect(screen.queryByText(/Every Monday/)).not.toBeInTheDocument());
        // The field help and the summary line both say it.
        expect(screen.getAllByText('Pick at least one day.')).toHaveLength(2);
        expect(screen.queryByText(/in the server's time zone/)).not.toBeInTheDocument();
        expect(dispatch).not.toHaveBeenCalled();
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

describe('next-run formatting', () => {
    test('formatSlot shows the wall time at the given offset', () => {
        expect(formatSlot(1762390800, 0)).toBe('Thu, 6 Nov 2025, 01:00');
        expect(formatSlot(1762390800, 3600)).toBe('Thu, 6 Nov 2025, 02:00');
        expect(formatSlot(1762390800, -18000)).toBe('Wed, 5 Nov 2025, 20:00');
        expect(formatSlot(1762390800, 19800)).toBe('Thu, 6 Nov 2025, 06:30');
    });

    test('zoneLabel names the zone, or the server zone with its offset', () => {
        expect(zoneLabel('Europe/Oslo', 3600)).toBe('in Europe/Oslo');
        expect(zoneLabel(null, 3600)).toBe("in the server's time zone (UTC+01:00)");
        expect(zoneLabel(null, -16200)).toBe("in the server's time zone (UTC-04:30)");
        expect(zoneLabel(null, 0)).toBe("in the server's time zone (UTC+00:00)");
        expect(zoneLabel(null, null)).toBe("in the server's time zone");
    });
});
