import type { ScheduleJob } from '../api/types';
import {
    barFill,
    defaultWindow,
    loadAt,
    loadSegments,
    orderRows,
    pct,
    place,
    ticks,
    withTime,
} from '../features/schedule/layout';

const job = (key: string, upstream: string | null = null): ScheduleJob => ({
    key,
    name: key,
    hidden: false,
    upstream,
    next_run: null,
    bars: [],
});

describe('schedule layout', () => {
    test('pct clamps and defaultWindow puts now a third in', () => {
        expect(pct(50, 0, 100)).toBe(50);
        expect(pct(-5, 0, 100)).toBe(0);
        expect(pct(500, 0, 100)).toBe(100);
        const w = defaultWindow(86400 * 3, 'day');
        expect(w.to - w.from).toBe(86400);
        expect(pct(86400 * 3, w.from, w.to)).toBeCloseTo(33.3, 0);
    });

    test('barFill uses the run timeline vocabulary', () => {
        expect(barFill({ state: 'scheduled', start: 0, end: 1 })).toBe('scheduled');
        expect(barFill({ state: 'failed', start: 0, end: 1 })).toBe('failed');
        expect(barFill({ state: 'succeeded', start: 0, end: 1, delayed: true })).toBe('delayed');
        expect(barFill({ state: 'running', start: 0, end: 1 })).toBe('running');
        expect(barFill({ state: 'queued', start: 0, end: 1 })).toBe('queued');
        expect(barFill({ state: 'succeeded', start: 0, end: 1 })).toBe('done');
    });

    test('place gives the queued share of an actual run', () => {
        expect(place({ start: 0, end: 100, started: 25 }, 0, 200)).toEqual({ leftPct: 0, widthPct: 50, queuedPct: 25 });
        expect(place({ start: 0, end: 100, started: null }, 0, 200).queuedPct).toBe(100);
        expect(place({ start: 0, end: 100 }, 0, 200).queuedPct).toBe(0);
        expect(place({ start: 10, end: 10 }, 0, 200).widthPct).toBeGreaterThan(0);
    });

    test('loadSegments drops zeros and marks counts over the limit', () => {
        const segs = loadSegments([[0, 0], [10, 3], [20, 5], [30, 0]], 0, 100, 4);
        expect(segs).toEqual([
            { leftPct: 10, widthPct: 10, count: 3, over: false },
            { leftPct: 20, widthPct: 10, count: 5, over: true },
        ]);
        expect(loadAt([[0, 0], [10, 3], [20, 5]], 15)).toBe(3);
    });

    test('orderRows puts dependents under their upstream', () => {
        const rows = orderRows([job('a'), job('b'), job('c', 'a'), job('x', 'y'), job('p', 'q'), job('q', 'p')]);
        expect(rows.map((r) => `${r.job.key}:${r.depth}`)).toEqual(['a:0', 'c:1', 'b:0', 'x:0', 'p:0', 'q:1']);
    });

    test('withTime changes only minute and hour', () => {
        expect(withTime('0 2 * * 1-5', 2, 40)).toBe('40 2 * * 1-5');
        expect(withTime('  5 23 1 * *', 0, 5)).toBe('5 0 1 * *');
        expect(withTime('bad', 1, 1)).toBe('bad');
    });

    test('ticks every 3 hours for a day and at midnights for a week', () => {
        const from = Date.UTC(2026, 11, 1) / 1000;
        expect(ticks(from, from + 86400, 'UTC')).toHaveLength(8);
        expect(ticks(from, from + 7 * 86400, 'UTC')).toHaveLength(7);
    });
});
