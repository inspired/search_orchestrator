/**
 * @jest-environment ./jest/timezoneEnvironment.js
 * @jest-environment-options {"timezone": "Europe/Oslo"}
 */
import type { CalendarItem } from '../api/calendar';
import { dayBounds, layoutDay, weekStart } from '../features/calendar/calendarLayout';

// Local-time rules are tested in Oslo, which has a spring-forward day. The environment sets
// the worker's process.env.TZ for this file only and restores it afterwards.
const PX = 40;

function run(over: Partial<Extract<CalendarItem, { kind: 'run' }>> = {}): CalendarItem {
    return {
        kind: 'run',
        job_id: 'daily',
        job_name: 'Daily summary',
        run_id: 'daily:1',
        state: 'succeeded',
        trigger: 'cron',
        scheduled_time: 0,
        started_at: null,
        ended_at: null,
        late: false,
        ...over,
    };
}

describe('calendarLayout', () => {
    it('uses the Oslo time zone in this file', () => {
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Oslo');
        expect(new Date(Date.UTC(2026, 0, 15, 12)).getHours()).toBe(13);
    });

    it('places a run at 01:00 one hour down and spans it to its end', () => {
        const day = dayBounds(new Date(2026, 10, 18));
        const at = day.start + 3600;
        const { placed, overflow } = layoutDay([run({ scheduled_time: at, started_at: at + 60, ended_at: at + 5400 })], day, PX);
        expect(overflow).toEqual([]);
        expect(placed).toHaveLength(1);
        expect(placed[0].top).toBe(PX);
        expect(placed[0].height).toBe(1.5 * PX);
        expect(placed[0].lane).toBe(0);
    });

    it('gives a short or unstarted item at least 18 px', () => {
        const day = dayBounds(new Date(2026, 10, 18));
        const at = day.start + 7200;
        const scheduled: CalendarItem = { kind: 'scheduled', job_id: 'a', job_name: 'A', time: at };
        const { placed } = layoutDay([scheduled, run({ scheduled_time: at + 1800, started_at: at + 1800, ended_at: at + 1810 })], day, PX);
        expect(placed.map((p) => p.height)).toEqual([18, 18]);
    });

    it('spans a running run to now', () => {
        const day = dayBounds(new Date(2026, 10, 18));
        const at = day.start + 3600;
        const { placed } = layoutDay([run({ state: 'running', scheduled_time: at, started_at: at })], day, PX, at + 7200);
        expect(placed[0].height).toBe(2 * PX);
    });

    it('puts three items of a half hour in lanes and the rest in one overflow', () => {
        const day = dayBounds(new Date(2026, 10, 18));
        const at = day.start + 10 * 3600;
        const items: CalendarItem[] = [0, 60, 120, 600, 1700].map((d, i) => ({
            kind: 'scheduled',
            job_id: `j${i}`,
            job_name: `Job ${i}`,
            time: at + d,
        }));
        const { placed, overflow } = layoutDay(items, day, PX);
        expect(placed.map((p) => p.lane)).toEqual([0, 1, 2]);
        expect(overflow).toHaveLength(1);
        expect(overflow[0].top).toBe(10 * PX);
        expect(overflow[0].items.map((i) => i.job_id)).toEqual(['j3', 'j4']);
    });

    it('leaves out items outside the day', () => {
        const day = dayBounds(new Date(2026, 10, 18));
        const items: CalendarItem[] = [
            { kind: 'scheduled', job_id: 'a', job_name: 'A', time: day.start - 1 },
            { kind: 'backfill', job_id: 'b', job_name: 'B', backfill_id: 'bf', time: day.end },
        ];
        expect(layoutDay(items, day, PX).placed).toEqual([]);
    });

    it('has a 23-hour spring-forward day and a 25-hour fall-back day', () => {
        const spring = dayBounds(new Date(2026, 2, 29, 15));
        expect(spring.end - spring.start).toBe(23 * 3600);
        expect(new Date(spring.start * 1000).getHours()).toBe(0);
        const fall = dayBounds(new Date(2026, 9, 25));
        expect(fall.end - fall.start).toBe(25 * 3600);
        const plain = dayBounds(new Date(2026, 10, 18, 23, 59));
        expect(plain.end - plain.start).toBe(24 * 3600);
    });

    it('starts the week on the Monday before a Sunday', () => {
        const monday = weekStart(new Date(2026, 10, 22, 18, 30));
        expect(monday.getDay()).toBe(1);
        expect([monday.getFullYear(), monday.getMonth(), monday.getDate()]).toEqual([2026, 10, 16]);
        expect([monday.getHours(), monday.getMinutes()]).toEqual([0, 0]);
        expect(weekStart(new Date(2026, 10, 16, 0, 0)).getDate()).toBe(16);
    });
});
