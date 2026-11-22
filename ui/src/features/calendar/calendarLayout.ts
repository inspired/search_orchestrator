/* Where calendar items go: local day and week bounds, and the top, height and lane of each
 * item in a day column. Positions follow elapsed time from local midnight, so a DST day is
 * 23 or 25 hours tall. */
import type { CalendarItem } from '../../api/calendar';

export interface Placed {
    item: CalendarItem;
    top: number;
    height: number;
    lane: 0 | 1 | 2;
}

/** The 4th and later items of a half hour, shown as "+N more". */
export interface Overflow {
    top: number;
    items: CalendarItem[];
}

export const MIN_HEIGHT = 18;
const LANES = 3;
const HALF_HOUR = 1800;

/** When an item sits on the calendar: a run at its scheduled time, others at their time. */
export function itemTime(item: CalendarItem): number {
    return item.kind === 'run' ? item.scheduled_time : item.time;
}

/** A local date `days` days after `d`, at the same wall-clock time. */
export function addDays(d: Date, days: number): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes());
}

/** Local Monday 00:00 of the week `d` is in (weeks start on Monday). */
export function weekStart(d: Date): Date {
    const back = (d.getDay() + 6) % 7;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
}

/** Local midnight to the next midnight, epoch seconds (23 or 25 hours on DST days). */
export function dayBounds(d: Date): { start: number; end: number } {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
}

function heightOf(item: CalendarItem, dayEnd: number, pxPerHour: number, now: number): number {
    if (item.kind !== 'run' || item.started_at === null || item.started_at === undefined) {
        return MIN_HEIGHT;
    }
    const end = Math.min(item.ended_at ?? now, dayEnd);
    return Math.max(MIN_HEIGHT, ((end - item.scheduled_time) / 3600) * pxPerHour);
}

/**
 * The items of one day, in time order. Up to three items per half hour get lanes 0-2; the
 * rest of that half hour go into one Overflow at the half hour's top.
 */
export function layoutDay(
    items: CalendarItem[],
    day: { start: number; end: number },
    pxPerHour: number,
    now: number = Math.floor(Date.now() / 1000)
): { placed: Placed[]; overflow: Overflow[] } {
    const inDay = items.filter((i) => itemTime(i) >= day.start && itemTime(i) < day.end).sort((a, b) => itemTime(a) - itemTime(b));
    const placed: Placed[] = [];
    const overflow: Overflow[] = [];
    const counts = new Map<number, number>();
    const extra = new Map<number, Overflow>();
    const px = (t: number) => ((t - day.start) / 3600) * pxPerHour;
    inDay.forEach((item) => {
        const slot = Math.floor((itemTime(item) - day.start) / HALF_HOUR);
        const n = counts.get(slot) || 0;
        counts.set(slot, n + 1);
        if (n < LANES) {
            placed.push({ item, top: px(itemTime(item)), height: heightOf(item, day.end, pxPerHour, now), lane: n as 0 | 1 | 2 });
            return;
        }
        let group = extra.get(slot);
        if (!group) {
            group = { top: px(day.start + slot * HALF_HOUR), items: [] };
            extra.set(slot, group);
            overflow.push(group);
        }
        group.items.push(item);
    });
    return { placed, overflow };
}
