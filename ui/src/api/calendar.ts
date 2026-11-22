/* Calendar: scheduled times, runs and planned backfill slots in a range of at most 8 days
 * (bin/so/calendar_api.py). Times are epoch seconds. */
import { request } from './client';
import type { RunState } from './types';

export type CalendarItem =
    | { kind: 'scheduled'; job_id: string; job_name: string; time: number }
    | {
          kind: 'run';
          job_id: string;
          job_name: string;
          run_id: string;
          state: RunState;
          trigger: string;
          scheduled_time: number;
          started_at: number | null;
          ended_at: number | null;
          late: boolean;
          backfill_id?: string | null;
      }
    | { kind: 'backfill'; job_id: string; job_name: string; backfill_id: string; time: number };

/** The items from `from` (inclusive) to `to` (exclusive), oldest first; at most 2000. */
export function getCalendar(from: number, to: number, jobId?: string): Promise<{ items: CalendarItem[]; truncated: boolean }> {
    return request<{ items: CalendarItem[]; truncated: boolean }>('GET', 'calendar', { query: { from, to, job_id: jobId } });
}

/** Like getCalendar for any range: fetched a week at a time (the route takes at most 8 days)
 * and merged in time order; truncated when any week was. */
export async function getCalendarRange(from: number, to: number, jobId?: string): Promise<{ items: CalendarItem[]; truncated: boolean }> {
    const WEEK = 7 * 86400;
    const parts: Array<Promise<{ items: CalendarItem[]; truncated: boolean }>> = [];
    for (let start = from; start < to; start += WEEK) {
        parts.push(getCalendar(start, Math.min(start + WEEK, to), jobId));
    }
    const done = await Promise.all(parts);
    return { items: done.flatMap((p) => p.items), truncated: done.some((p) => p.truncated) };
}
