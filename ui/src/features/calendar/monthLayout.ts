/* The month view: six weeks of days from the Monday on or before the 1st, and per day one
 * summary line per job (how many items, and the most serious state among them). */
import type { CalendarItem } from '../../api/calendar';
import { addDays, dayBounds, itemTime, weekStart } from './calendarLayout';

/** What a job's line on a day shows, most serious first. */
export type DayTone = 'failed' | 'late' | 'waiting' | 'running' | 'queued' | 'succeeded' | 'cancelled' | 'scheduled' | 'backfill';
const RANK: DayTone[] = ['failed', 'late', 'waiting', 'running', 'queued', 'succeeded', 'cancelled', 'scheduled', 'backfill'];

export interface JobDay {
    jobId: string;
    jobName: string;
    count: number;
    tone: DayTone;
}

/** The 42 days shown for the month `d` is in: six weeks starting on a Monday. */
export function monthDays(d: Date): Date[] {
    const first = weekStart(new Date(d.getFullYear(), d.getMonth(), 1));
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** The same day of the month `months` months away, clamped to that month's last day. */
export function addMonths(d: Date, months: number): Date {
    const last = new Date(d.getFullYear(), d.getMonth() + months + 1, 0).getDate();
    return new Date(d.getFullYear(), d.getMonth() + months, Math.min(d.getDate(), last));
}

export function toneOf(item: CalendarItem): DayTone {
    if (item.kind === 'scheduled') {
        return 'scheduled';
    }
    if (item.kind === 'backfill') {
        return 'backfill';
    }
    if (item.state === 'failed') {
        return 'failed';
    }
    if (item.late) {
        return 'late';
    }
    if (item.state === 'blocked' || item.state === 'paused') {
        return 'waiting';
    }
    return item.state;
}

/** One line per job for the day `d`, most serious tone first, then by job name. */
export function summarizeDay(items: CalendarItem[], d: Date): JobDay[] {
    const { start, end } = dayBounds(d);
    const byJob = new Map<string, JobDay>();
    items.forEach((item) => {
        const t = itemTime(item);
        if (t < start || t >= end) {
            return;
        }
        const tone = toneOf(item);
        const row = byJob.get(item.job_id);
        if (!row) {
            byJob.set(item.job_id, { jobId: item.job_id, jobName: item.job_name, count: 1, tone });
            return;
        }
        row.count += 1;
        if (RANK.indexOf(tone) < RANK.indexOf(row.tone)) {
            row.tone = tone;
        }
    });
    return Array.from(byJob.values()).sort((a, b) => RANK.indexOf(a.tone) - RANK.indexOf(b.tone) || a.jobName.localeCompare(b.jobName));
}
