/* Pure layout for the schedule timeline and the builder's busy-times strip, so positions,
 * kinds and ordering can be tested without rendering. Times are epoch seconds. */
import type { LoadSeries, ScheduleBar, ScheduleJob } from '../../api/types';

export const HOUR = 3600;
export const DAY = 86400;
export type Span = 'day' | 'week';
export const SPAN_SECONDS: Record<Span, number> = { day: DAY, week: 7 * DAY };

/** Where `t` falls on [from, to), as a percentage clamped to 0-100. */
export function pct(t: number, from: number, to: number): number {
    return Math.min(100, Math.max(0, ((t - from) / Math.max(to - from, 1)) * 100));
}

/** The default window: now about one third from the left, so more of the future shows. */
export function defaultWindow(now: number, span: Span): { from: number; to: number } {
    const length = SPAN_SECONDS[span];
    const from = Math.floor((now - length / 3) / 60) * 60;
    return { from, to: from + length };
}

export type BarFill = 'scheduled' | 'done' | 'failed' | 'delayed' | 'running' | 'queued';

const ACTIVE = ['running', 'blocked', 'paused'];

/** How a bar is drawn, using the run Timeline's vocabulary plus "scheduled". */
export function barFill(bar: ScheduleBar): BarFill {
    if (bar.state === 'scheduled') {
        return 'scheduled';
    }
    if (bar.state === 'failed' || bar.state === 'cancelled') {
        return 'failed';
    }
    if (bar.delayed) {
        return 'delayed';
    }
    if (bar.state === 'queued') {
        return 'queued';
    }
    if (ACTIVE.includes(bar.state)) {
        return 'running';
    }
    return 'done';
}

export interface Placed {
    leftPct: number;
    widthPct: number;
    /** The hatched queued part at the start of an actual run, as a share of the bar. */
    queuedPct: number;
}

const MIN_WIDTH = 0.3;

export function place(bar: { start: number; end: number; started?: number | null }, from: number, to: number): Placed {
    const left = pct(bar.start, from, to);
    const right = pct(Math.max(bar.end, bar.start), from, to);
    const widthPct = Math.max(right - left, MIN_WIDTH);
    let queuedPct = 0;
    if (bar.started !== undefined && bar.end > bar.start) {
        const until = bar.started === null ? bar.end : Math.min(Math.max(bar.started, bar.start), bar.end);
        queuedPct = ((until - bar.start) / (bar.end - bar.start)) * 100;
    }
    return { leftPct: left, widthPct, queuedPct };
}

export interface LoadSegment {
    leftPct: number;
    widthPct: number;
    count: number;
    over: boolean;
}

/** The load series as drawable steps over [from, to); zero steps are left out. */
export function loadSegments(load: LoadSeries, from: number, to: number, max: number): LoadSegment[] {
    const out: LoadSegment[] = [];
    load.forEach(([t, count], i) => {
        const next = i + 1 < load.length ? load[i + 1][0] : to;
        const s = Math.max(t, from);
        const e = Math.min(next, to);
        if (count <= 0 || e <= s) {
            return;
        }
        const leftPct = pct(s, from, to);
        out.push({ leftPct, widthPct: pct(e, from, to) - leftPct, count, over: max > 0 && count > max });
    });
    return out;
}

/** The highest count in the series, at least `max` so the limit line fits. */
export function loadScale(load: LoadSeries, max: number): number {
    return Math.max(1, max, ...load.map(([, n]) => n));
}

/** The count at time `t`. */
export function loadAt(load: LoadSeries, t: number): number {
    let n = 0;
    load.forEach(([time, count]) => {
        if (time <= t) {
            n = count;
        }
    });
    return n;
}

export interface Tick {
    pct: number;
    label: string;
}

const QUARTER = 900;

/** Axis ticks: every 3 hours for a day, every midnight for a week, in local time. Walks
 * in 15-minute steps, so zones with :30 and :45 offsets land on their real boundaries. */
export function ticks(from: number, to: number, timeZone?: string): Tick[] {
    const week = to - from > 2 * DAY;
    const out: Tick[] = [];
    const label = new Intl.DateTimeFormat(
        undefined,
        week ? { weekday: 'short', day: 'numeric', timeZone } : { hour: '2-digit', minute: '2-digit', timeZone }
    );
    const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone });
    for (let t = Math.ceil(from / QUARTER) * QUARTER; t < to; t += QUARTER) {
        const p = parts.formatToParts(new Date(t * 1000));
        const hour = Number(p.find((x) => x.type === 'hour')?.value);
        const minute = Number(p.find((x) => x.type === 'minute')?.value);
        if (minute === 0 && (week ? hour === 0 : hour % 3 === 0)) {
            out.push({ pct: pct(t, from, to), label: label.format(new Date(t * 1000)) });
        }
    }
    return out;
}

export interface Row {
    job: ScheduleJob;
    /** 1 for a job that follows another row's job, else 0. */
    depth: number;
}

/** Rows as listed by the server, with each dependent job moved under its upstream row. */
export function orderRows(jobs: ScheduleJob[]): Row[] {
    const keys = new Set(jobs.map((j) => j.key));
    const children: Record<string, ScheduleJob[]> = {};
    const roots: ScheduleJob[] = [];
    jobs.forEach((j) => {
        if (j.upstream && keys.has(j.upstream) && j.upstream !== j.key) {
            (children[j.upstream] = children[j.upstream] || []).push(j);
        } else {
            roots.push(j);
        }
    });
    const out: Row[] = [];
    const seen = new Set<string>();
    const visit = (j: ScheduleJob, depth: number) => {
        if (seen.has(j.key)) {
            return;
        }
        seen.add(j.key);
        out.push({ job: j, depth });
        (children[j.key] || []).forEach((c) => visit(c, 1));
    };
    roots.forEach((j) => visit(j, 0));
    jobs.forEach((j) => visit(j, 0)); // a loop of dependents has no root: list it flat
    return out;
}

/** `cron` with only its minute and hour fields replaced. */
export function withTime(cron: string, hour: number, minute: number): string {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) {
        return cron;
    }
    parts[0] = String(minute);
    parts[1] = String(hour);
    return parts.join(' ');
}

/** "02:40" */
export function clock(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
