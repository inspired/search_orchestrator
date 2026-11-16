import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import TriggerPanel from '../features/builder/TriggerPanel';
import { formatSlot, zoneLabel } from '../features/builder/ScheduleEditor';
import type { JobDefinition } from '../api/types';
import { ApiError } from '../api/client';
import { renderThemed } from './fixtures';

const SLOTS = [1762390800, 1762477200, 1762563600];

function jobWith(triggers: JobDefinition['triggers'], timezone?: string): JobDefinition {
    return { name: 'j', steps: [{ id: 'a', type: 'inline', spl: '| makeresults' }], triggers, timezone } as JobDefinition;
}

function reply(over: Record<string, unknown> = {}) {
    return { slots: SLOTS, utc_offsets: [0, 0, 0], timezone: null, timezone_status: 'ok', ...over };
}

function setup(job: JobDefinition, nextSlots?: jest.Mock, index = 0, jobs: { id: string; name: string }[] = []) {
    const dispatch = jest.fn();
    const onRequestRemove = jest.fn();
    const onOpenSettings = jest.fn();
    const next = nextSlots || jest.fn().mockResolvedValue(reply());
    renderThemed(
        <TriggerPanel job={job} index={index} jobs={jobs} nextSlots={next} dispatch={dispatch} onRequestRemove={onRequestRemove} onOpenSettings={onOpenSettings} />
    );
    return { dispatch, next, onRequestRemove, onOpenSettings };
}

describe('TriggerPanel schedule', () => {
    test('a cron no preset matches opens as Custom and is not rewritten', async () => {
        const { dispatch, next } = setup(jobWith([{ type: 'cron', cron: '0 1 * * 1-5' }]));
        expect(screen.getByRole('radio', { name: 'Custom' })).toBeChecked();
        expect(screen.getByLabelText('Cron')).toHaveValue('0 1 * * 1-5');
        await waitFor(() => expect(next).toHaveBeenCalledWith('0 1 * * 1-5', null, 3));
        expect(dispatch).not.toHaveBeenCalled();
    });

    test('shows only the selected trigger', () => {
        setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }, { type: 'cron', cron: '*/15 * * * *' }]), undefined, 1);
        expect(screen.getByRole('radio', { name: 'Custom' })).toBeChecked();
        expect(screen.getByLabelText('Cron')).toHaveValue('*/15 * * * *');
    });

    test('picking Daily dispatches updateTrigger with the preset cron', () => {
        const { dispatch } = setup(jobWith([{ type: 'cron', cron: '*/15 * * * *' }]));
        fireEvent.click(screen.getByRole('radio', { name: 'Daily' }));
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'updateTrigger', index: 0, changes: { cron: '0 1 * * *' } });
    });

    test('editing the time sends the new cron to that trigger', () => {
        const { dispatch } = setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }, { type: 'cron', cron: '0 3 * * *' }]), undefined, 1);
        fireEvent.change(screen.getByLabelText('Time (HH:MM)'), { target: { value: '02:30' } });
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'updateTrigger', index: 1, changes: { cron: '30 2 * * *' } });
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
        await waitFor(() => expect(screen.getAllByText(/02:00/)).toHaveLength(3));
    });

    test('with no job zone the next runs use the server offset and say so', async () => {
        const next = jest.fn().mockResolvedValue(reply({ utc_offsets: [-18000, -18000, -18000] }));
        setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }]), next);
        expect(await screen.findByText("Every day at 01:00, in the server's time zone (UTC-05:00)")).toBeInTheDocument();
        await waitFor(() => expect(screen.getAllByText(/20:00/)).toHaveLength(3));
    });

    test('an unknown job zone says the times are in server time', async () => {
        const next = jest.fn().mockResolvedValue(reply({ utc_offsets: [3600, 3600, 3600], timezone_status: 'unknown' }));
        setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }], 'Etc/Unknown'), next);
        expect(await screen.findByText('Unknown time zone; times are shown in server time.')).toBeInTheDocument();
    });

    test('a weekly schedule with no days says to pick one and sends nothing', async () => {
        const { dispatch } = setup(jobWith([{ type: 'cron', cron: '30 6 * * 1' }]));
        fireEvent.click(screen.getByRole('option', { name: /^Remove Monday/ }));
        await waitFor(() => expect(screen.queryByText(/Every Monday/)).not.toBeInTheDocument());
        expect(screen.getAllByText('Pick at least one day.')).toHaveLength(2);
        expect(dispatch).not.toHaveBeenCalled();
    });

    test('a bad_cron reply is the Custom field error', async () => {
        const next = jest.fn().mockRejectedValue(new ApiError(400, 'bad_cron', 'Cron needs five fields.'));
        setup(jobWith([{ type: 'cron', cron: '* *' }]), next);
        expect(await screen.findByText('Cron needs five fields.')).toBeInTheDocument();
    });
});

describe('TriggerPanel time zone, enabled and remove', () => {
    test('names the job time zone and links to Settings', () => {
        const { onOpenSettings } = setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }], 'Europe/Oslo'));
        expect(screen.getByText(/Times are in Europe\/Oslo\./)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Change time zone' }));
        expect(onOpenSettings).toHaveBeenCalled();
    });

    test('with no job zone it says the server time zone', () => {
        setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }]));
        expect(screen.getByText(/Times are in the server's time zone\./)).toBeInTheDocument();
    });

    test('Enabled toggles through updateTrigger', () => {
        const { dispatch } = setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }]));
        fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'updateTrigger', index: 0, changes: { enabled: false } });
    });

    test('Remove trigger asks the page to remove that node', () => {
        const { dispatch, onRequestRemove } = setup(jobWith([{ type: 'cron', cron: '0 1 * * *' }, { type: 'cron', cron: '0 2 * * *' }]), undefined, 1);
        fireEvent.click(screen.getByRole('button', { name: 'Remove trigger' }));
        expect(onRequestRemove).toHaveBeenCalledWith('trigger:1');
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('TriggerPanel completion', () => {
    const job = jobWith([{ type: 'completion', job: 'other', on: 'success' }]);
    const jobs = [{ id: 'j', name: 'This' }, { id: 'other', name: 'Other job' }, { id: 'third', name: 'Third' }];

    test('picks the job and when it starts', () => {
        const { dispatch } = setup({ ...job, id: 'j' }, undefined, 0, jobs);
        fireEvent.click(screen.getByRole('combobox', { name: 'Job' }));
        fireEvent.click(screen.getByRole('option', { name: 'Third' }));
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'updateTrigger', index: 0, changes: { job: 'third' } });
        fireEvent.click(screen.getByRole('combobox', { name: 'Start when it' }));
        fireEvent.click(screen.getByRole('option', { name: 'Completes (success or failure)' }));
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'updateTrigger', index: 0, changes: { on: 'complete' } });
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
