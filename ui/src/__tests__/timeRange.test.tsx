import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import TimeRangeField from '../features/builder/TimeRangeField';
import { TIME_RANGE_PRESETS, timeRangeChoice } from '../features/builder/timeRange';
import { ApiError } from '../api/client';
import { renderThemed } from './fixtures';

describe('timeRangeChoice', () => {
    test('matches presets, all time and custom', () => {
        expect(timeRangeChoice('-1d@d', '@d')).toBe('previous_day');
        expect(timeRangeChoice('', '')).toBe('all_time');
        expect(timeRangeChoice(undefined, undefined)).toBe('all_time');
        expect(timeRangeChoice('-2d@d', '@d')).toBe('custom');
    });

    test('presets are the agreed five', () => {
        expect(TIME_RANGE_PRESETS.map((p) => [p.key, p.earliest, p.latest])).toEqual([
            ['previous_hour', '-1h@h', '@h'],
            ['previous_day', '-1d@d', '@d'],
            ['previous_week', '-1w@w1', '@w1'],
            ['previous_month', '-1mon@mon', '@mon'],
            ['last_24h', '-24h', 'now'],
        ]);
    });
});

const flush = async () => {
    await act(async () => {
        jest.advanceTimersByTime(450);
    });
};

describe('TimeRangeField', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const base = { idPrefix: 'step-a', scheduledTime: 1762390800, timezone: 'UTC' };

    test('choosing a preset sets earliest and latest', () => {
        const onChange = jest.fn();
        const resolve = jest.fn().mockResolvedValue({ earliest: 1, latest: 2 });
        renderThemed(<TimeRangeField {...base} earliest="" latest="" resolve={resolve} onChange={onChange} />);
        fireEvent.click(screen.getByRole('combobox', { name: 'Time range' }));
        fireEvent.click(screen.getByRole('option', { name: 'The day before' }));
        expect(onChange).toHaveBeenCalledWith('-1d@d', '@d');
    });

    test('shows the window a run would search, in the job zone', async () => {
        const resolve = jest.fn().mockResolvedValue({ earliest: 1762300800, latest: 1762387200 });
        renderThemed(<TimeRangeField {...base} earliest="-1d@d" latest="@d" resolve={resolve} onChange={jest.fn()} />);
        await flush();
        expect(resolve).toHaveBeenCalledWith('-1d@d', '@d', 1762390800);
        expect(screen.getByText('For a run scheduled Thu 6 Nov 01:00, this searches Wed 5 Nov 00:00 to Thu 6 Nov 00:00')).toBeInTheDocument();
    });

    test('all time warns and does not resolve', async () => {
        const resolve = jest.fn();
        renderThemed(<TimeRangeField {...base} earliest="" latest="" resolve={resolve} onChange={jest.fn()} />);
        await flush();
        expect(screen.getByText('Searches all time. Pick a range unless the search sets its own.')).toBeInTheDocument();
        expect(resolve).not.toHaveBeenCalled();
    });

    test('custom shows the fields with current values', () => {
        const resolve = jest.fn().mockResolvedValue({ earliest: 1, latest: 2 });
        renderThemed(<TimeRangeField {...base} earliest="-2d@d" latest="@d" resolve={resolve} onChange={jest.fn()} />);
        expect(screen.getByLabelText('Earliest')).toHaveValue('-2d@d');
        expect(screen.getByLabelText('Latest')).toHaveValue('@d');
    });

    test('a bad_time reply marks the named field', async () => {
        const resolve = jest.fn().mockRejectedValue(new ApiError(400, 'bad_time', 'Invalid latest time.', [], { field: 'latest' }));
        renderThemed(<TimeRangeField {...base} earliest="-2d@d" latest="zzz" resolve={resolve} onChange={jest.fn()} />);
        await flush();
        expect(screen.getByText('Invalid latest time.')).toBeInTheDocument();
    });
});
