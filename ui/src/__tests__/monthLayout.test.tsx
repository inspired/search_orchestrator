import type { CalendarItem } from '../api/calendar';
import { addMonths, monthDays, summarizeDay } from '../features/calendar/monthLayout';

const at = (d: number, h: number) => Math.floor(new Date(2026, 10, d, h).getTime() / 1000);
const run = (job: string, state: 'failed' | 'succeeded' | 'running', d: number, h: number, late = false): CalendarItem => ({
    kind: 'run', job_id: job, job_name: job.toUpperCase(), run_id: `${job}:${h}`, state, trigger: 'cron',
    scheduled_time: at(d, h), started_at: at(d, h), ended_at: null, late,
});

describe('monthLayout', () => {
    test('monthDays gives 42 days from the Monday on or before the 1st', () => {
        const days = monthDays(new Date(2026, 10, 18));
        expect(days).toHaveLength(42);
        expect(days[0]).toEqual(new Date(2026, 9, 26));
        expect(days[41]).toEqual(new Date(2026, 11, 6));
    });

    test('addMonths clamps to the last day of a shorter month', () => {
        expect(addMonths(new Date(2026, 0, 31), 1)).toEqual(new Date(2026, 1, 28));
        expect(addMonths(new Date(2026, 2, 15), -3)).toEqual(new Date(2025, 11, 15));
    });

    test('summarizeDay counts per job and keeps the most serious state, most serious first', () => {
        const items: CalendarItem[] = [
            run('a', 'succeeded', 18, 1), run('a', 'failed', 18, 2), run('a', 'succeeded', 18, 3),
            run('b', 'succeeded', 18, 4, true),
            { kind: 'scheduled', job_id: 'c', job_name: 'C', time: at(18, 20) },
            run('a', 'failed', 19, 1),
        ];
        expect(summarizeDay(items, new Date(2026, 10, 18))).toEqual([
            { jobId: 'a', jobName: 'A', count: 3, tone: 'failed' },
            { jobId: 'b', jobName: 'B', count: 1, tone: 'late' },
            { jobId: 'c', jobName: 'C', count: 1, tone: 'scheduled' },
        ]);
    });
});
