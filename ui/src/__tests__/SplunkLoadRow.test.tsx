import React from 'react';
import { screen, within } from '@testing-library/react';
import type { ScheduleResponse, SplunkLoad } from '../api/types';
import ScheduleTimeline from '../features/schedule/ScheduleTimeline';
import SplunkLoadRow, { maxBetween, splunkBars } from '../features/schedule/SplunkLoadRow';
import { NOW, renderThemed } from './fixtures';

const B = 300;
const FROM = NOW - 2 * 3600;
const TO = NOW + 2 * 3600;

function load(over: Partial<SplunkLoad> = {}): SplunkLoad {
    return {
        from: FROM,
        to: TO,
        now: NOW,
        bucket: B,
        past: [
            [FROM, 1, 2, 3],
            [FROM + B, 0, 20, 0],
        ],
        future: [[FROM + Math.ceil((NOW - FROM) / B) * B, 4]],
        limit: { searches: 18, scheduled: 9 },
        projected_searches: 32,
        skipped_crons: 0,
        notes: [],
        searches: [],
        ...over,
    };
}

const schedule = (over: Partial<ScheduleResponse> = {}): ScheduleResponse => ({ from: FROM, to: TO, now: NOW, max_searches: 10, load: [[FROM, 0]], jobs: [], idle_jobs: 0, partial: false, ...over });

describe('All Splunk searches', () => {
    test('maxBetween is the highest count of a change-point series in a window', () => {
        const series: [number, number][] = [
            [0, 1],
            [10, 4],
            [20, 2],
        ];
        expect(maxBetween(series, 5, 15)).toBe(4);
        expect(maxBetween(series, 25, 30)).toBe(2);
        expect(maxBetween([], 0, 10)).toBe(0);
    });

    test('past bars by kind, future bars add this app\'s own projected searches', () => {
        const first = FROM + Math.ceil((NOW - FROM) / B) * B;
        const bars = splunkBars(load(), [
            [FROM, 0],
            [first + 10, 2],
            [first + 100, 0],
        ]);
        expect(bars[0]).toEqual({ t: FROM, future: false, app: 1, scheduled: 2, other: 3 });
        const future = bars.filter((b) => b.future);
        expect(future).toEqual([{ t: first, future: true, app: 2, scheduled: 4, other: 0 }]);
    });

    test('the row marks a bar over Splunk\'s limit and draws the limit', () => {
        renderThemed(<SplunkLoadRow data={load()} appLoad={[]} from={FROM} to={TO} now={NOW} />);
        const bars = screen.getAllByTestId('splunk-load-bar');
        expect(bars.map((b) => b.getAttribute('data-over'))).toEqual(['false', 'true', 'false']);
        expect(bars[2]).toHaveAttribute('data-future', 'true');
        expect(bars[0].getAttribute('title')).toMatch(/up to 6 searches at once \(1 this app, 2 scheduled, 3 other\)/);
        expect(screen.getByTestId('splunk-load-limit')).toBeInTheDocument();
        expect(screen.getByRole('img')).toHaveAccessibleName("Up to 20 Splunk searches at once; Splunk's limit is 18.");
        expect(screen.queryByTestId('splunk-load-scale')).toBeNull(); // a short strip has no scale
    });

    test('the timeline shows the row with its limit, key and notes, or why it failed', () => {
        const { unmount } = renderThemed(<ScheduleTimeline data={schedule()} from={FROM} to={TO} now={NOW} splunk={load({ notes: ['Needs _audit'], skipped_crons: 2 })} />);
        const row = screen.getByTestId('splunk-load');
        // On the timeline both graphs are tall, with their scale at the top.
        expect(screen.getByTestId('load-row')).toHaveStyle({ height: '120px' });
        expect(screen.getByTestId('splunk-load-row')).toHaveStyle({ height: '120px' });
        expect(screen.getByTestId('splunk-load-scale')).toHaveTextContent('20'); // the tallest bar, above the limit
        expect(within(row).getByText('All Splunk searches')).toBeInTheDocument();
        expect(within(row).getByText('Splunk limit 18')).toBeInTheDocument();
        expect(within(row).getByText('Scheduled searches')).toBeInTheDocument();
        expect(within(row).getByText('Needs _audit')).toBeInTheDocument();
        expect(within(row).getByText(/2 scheduled searches have schedules the app can't read/)).toBeInTheDocument();
        unmount();
        renderThemed(<ScheduleTimeline data={schedule()} from={FROM} to={TO} now={NOW} splunkError="Splunk's searches could not be loaded: boom" />);
        expect(screen.getByTestId('splunk-load')).toHaveTextContent('could not be loaded: boom');
    });

    test('without the Splunk data the timeline has no such row', () => {
        renderThemed(<ScheduleTimeline data={schedule()} from={FROM} to={TO} now={NOW} />);
        expect(screen.queryByTestId('splunk-load')).toBeNull();
    });
});
