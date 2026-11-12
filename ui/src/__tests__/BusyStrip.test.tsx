import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { JobDefinition, SchedulePreviewResponse } from '../api/types';
import TriggersTab from '../features/builder/TriggersTab';
import { NOW, renderThemed } from './fixtures';

function response(over: Partial<SchedulePreviewResponse> = {}): SchedulePreviewResponse {
    return {
        from: NOW,
        to: NOW + 86400,
        now: NOW,
        timezone: 'Europe/Oslo',
        ticks: [[NOW + 3600, '03:00']],
        max_searches: 10,
        load: [
            [NOW, 0],
            [NOW + 3600, 9],
            [NOW + 4200, 0],
        ],
        schedules: [
            {
                index: 0,
                runs: [{ start: NOW + 3600, end: NOW + 3700 }],
                suggestion: { hour: 2, minute: 40, peak: 3, base_peak: 9 },
            },
        ],
        ...over,
    };
}

const job: JobDefinition = {
    id: 'daily',
    name: 'Daily',
    enabled: true,
    timezone: 'Europe/Oslo',
    triggers: [{ type: 'cron', cron: '0 2 * * 1-5' }],
    steps: [],
    edges: [],
};

describe('Busy-times strip', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('shows the strip and a suggestion, and changes only minute and hour', async () => {
        const preview = jest.fn(() => Promise.resolve(response()));
        const dispatch = jest.fn();
        renderThemed(<TriggersTab job={job} jobs={[]} dispatch={dispatch} jobId="daily" schedulePreview={preview} />);
        await act(async () => {
            jest.advanceTimersByTime(1000);
        });
        await waitFor(() => expect(screen.getByTestId('busy-strip')).toBeInTheDocument());
        expect(preview).toHaveBeenCalledWith(expect.objectContaining({ id: 'daily', timezone: 'Europe/Oslo' }));
        expect(screen.getByText(/next 24 hours \(Europe\/Oslo\)/)).toBeInTheDocument();
        expect(screen.getByRole('status').textContent).toBe(
            'Quieter nearby: 02:40, with up to 3 other searches running instead of 9.Use this timeDismiss'
        );
        expect(screen.getAllByTestId('load-overlay')).toHaveLength(1);
        expect(screen.getByText('03:00')).toBeInTheDocument(); // the server's ticks, in the job's zone
        fireEvent.click(screen.getByRole('button', { name: 'Use this time' }));
        expect(dispatch).toHaveBeenCalledWith({
            type: 'setJobField',
            field: 'triggers',
            value: [{ type: 'cron', cron: '40 2 * * 1-5' }],
        });
    });

    test('dismiss hides the hint but keeps the strip', async () => {
        renderThemed(
            <TriggersTab job={job} jobs={[]} dispatch={jest.fn()} schedulePreview={() => Promise.resolve(response())} />
        );
        await act(async () => {
            jest.advanceTimersByTime(1000);
        });
        await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.getByTestId('busy-strip')).toBeInTheDocument();
    });

    test('no suggestion, no hint; a failed request shows no strip', async () => {
        const none = response({ schedules: [{ index: 0, runs: [], suggestion: null }] });
        const { unmount } = renderThemed(
            <TriggersTab job={job} jobs={[]} dispatch={jest.fn()} schedulePreview={() => Promise.resolve(none)} />
        );
        await act(async () => {
            jest.advanceTimersByTime(1000);
        });
        await waitFor(() => expect(screen.getByTestId('busy-strip')).toBeInTheDocument());
        expect(screen.queryByRole('status')).toBeNull();
        unmount();
        renderThemed(
            <TriggersTab job={job} jobs={[]} dispatch={jest.fn()} schedulePreview={() => Promise.reject(new Error('x'))} />
        );
        await act(async () => {
            jest.advanceTimersByTime(1000);
        });
        expect(screen.queryByTestId('busy-strip')).toBeNull();
    });

    test('a job without a time zone says it uses the server time zone', async () => {
        renderThemed(
            <TriggersTab
                job={{ ...job, timezone: undefined }}
                jobs={[]}
                dispatch={jest.fn()}
                schedulePreview={() => Promise.resolve(response({ timezone: null }))}
            />
        );
        await act(async () => {
            jest.advanceTimersByTime(1000);
        });
        await waitFor(() => expect(screen.getByText(/next 24 hours \(the server's time zone\)/)).toBeInTheDocument());
    });

    test('a far-off monthly run shows the days around it', async () => {
        renderThemed(
            <TriggersTab
                job={job}
                jobs={[]}
                dispatch={jest.fn()}
                schedulePreview={() => Promise.resolve(response({ from: NOW + 10 * 86400, to: NOW + 17 * 86400 }))}
            />
        );
        await act(async () => {
            jest.advanceTimersByTime(1000);
        });
        await waitFor(() => expect(screen.getByText(/the 7 days around the next run/)).toBeInTheDocument());
    });

    test('no cron schedule, no request', async () => {
        const preview = jest.fn(() => Promise.resolve(response()));
        renderThemed(<TriggersTab job={{ ...job, triggers: [] }} jobs={[]} dispatch={jest.fn()} schedulePreview={preview} />);
        await act(async () => {
            jest.advanceTimersByTime(1000);
        });
        expect(preview).not.toHaveBeenCalled();
    });
});
