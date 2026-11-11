import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ScheduleResponse } from '../api/types';
import RunsPage, { RunsApi } from '../features/runs/RunsPage';
import ScheduleTimeline from '../features/schedule/ScheduleTimeline';
import { NOW, renderThemed } from './fixtures';

const FROM = NOW - 8 * 3600;
const TO = NOW + 16 * 3600;

function data(over: Partial<ScheduleResponse> = {}): ScheduleResponse {
    return {
        from: FROM,
        to: TO,
        now: NOW,
        max_searches: 2,
        load: [
            [FROM, 0],
            [NOW - 3600, 1],
            [NOW + 3600, 3],
            [NOW + 3700, 0],
        ],
        jobs: [
            {
                key: 'daily',
                name: 'Daily summary',
                hidden: false,
                upstream: null,
                next_run: NOW + 3600,
                bars: [
                    { id: 'daily:r1', state: 'failed', start: NOW - 3600, started: NOW - 3500, end: NOW - 3000 },
                    { state: 'scheduled', start: NOW + 3600, end: NOW + 3700, estimated: true },
                ],
            },
            {
                key: 'report',
                name: 'Report',
                hidden: false,
                upstream: 'daily',
                next_run: null,
                bars: [{ state: 'scheduled', start: NOW + 3700, end: NOW + 3800, estimated: true, dependent: true }],
            },
            {
                key: 'hidden-1',
                name: 'Hidden job 1',
                hidden: true,
                upstream: null,
                next_run: null,
                bars: [{ state: 'succeeded', start: NOW - 7200, started: NOW - 7200, end: NOW - 7100 }],
            },
        ],
        idle_jobs: 4,
        partial: false,
        ...over,
    };
}

describe('ScheduleTimeline', () => {
    test('draws past, scheduled and hidden rows', () => {
        renderThemed(<ScheduleTimeline data={data()} from={FROM} to={TO} now={NOW} />);
        const items = screen.getAllByRole('listitem');
        expect(items.map((i) => i.textContent)).toEqual([
            expect.stringContaining('Daily summary'),
            expect.stringContaining('↳ Report'),
            expect.stringContaining('Hidden job 1'),
        ]);
        const bars = screen.getAllByTestId('schedule-bar');
        expect(bars.map((b) => b.getAttribute('data-fill'))).toEqual(['failed', 'scheduled', 'scheduled', 'done']);
        // a visible past run links to its run page; scheduled and hidden bars don't
        expect(bars[0].tagName).toBe('A');
        expect(bars[0]).toHaveAttribute('href', 'run?run_id=daily%3Ar1');
        expect(bars[1].tagName).toBe('DIV');
        expect(bars[3].tagName).toBe('DIV');
        expect(bars[1].style.border).toContain('dashed');
        expect(screen.getByText('Daily summary').closest('a')).toHaveAttribute('href', 'builder?job_id=daily');
        expect(screen.getByText('Hidden job 1').closest('a')).toBeNull();
        expect(screen.queryByText(/nothing in this window/)).toBeNull();
    });

    test('load row marks the part above the limit', () => {
        renderThemed(<ScheduleTimeline data={data()} from={FROM} to={TO} now={NOW} />);
        const segs = screen.getAllByTestId('load-segment');
        expect(segs.map((s) => s.getAttribute('data-over'))).toEqual(['false', 'true']);
        expect(screen.getByTestId('load-limit')).toBeInTheDocument();
        expect(screen.getByText('Limit 2')).toBeInTheDocument();
    });

    test('filters by name and by past state', () => {
        renderThemed(<ScheduleTimeline data={data()} from={FROM} to={TO} now={NOW} q="rep" state="succeeded" />);
        expect(screen.getAllByRole('listitem')).toHaveLength(1);
        expect(screen.getAllByTestId('schedule-bar')).toHaveLength(1); // the scheduled run stays
    });
});

describe('Runs page timeline view', () => {
    test('switches to the timeline and keeps it in the URL', async () => {
        window.history.replaceState(null, '', '/runs');
        const api = {
            listJobs: jest.fn(() => Promise.resolve([])),
            searchRuns: jest.fn(() => Promise.resolve({ runs: [] })),
            getSchedule: jest.fn(() => Promise.resolve(data())),
        } as unknown as RunsApi;
        renderThemed(<RunsPage api={api} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Timeline' }));
        await waitFor(() => expect(screen.getByText('Daily summary')).toBeInTheDocument());
        expect(window.location.search).toContain('view=timeline');
        const [from, to] = (api.getSchedule as jest.Mock).mock.calls[0];
        expect(to - from).toBe(86400);
        fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
        await waitFor(() => expect((api.getSchedule as jest.Mock).mock.calls.length).toBeGreaterThan(1));
        const last = (api.getSchedule as jest.Mock).mock.calls.slice(-1)[0];
        expect(last[1] - last[0]).toBe(7 * 86400);
        // searching in the timeline doesn't load the hidden table
        const tableCalls = (api.searchRuns as jest.Mock).mock.calls.length;
        fireEvent.change(screen.getByLabelText('Search by job name'), { target: { value: 'dai' } });
        await new Promise((r) => setTimeout(r, 400));
        expect((api.searchRuns as jest.Mock).mock.calls.length).toBe(tableCalls);
    });
});
