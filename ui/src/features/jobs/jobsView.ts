/* Which jobs the Jobs page shows and in what order: pure, so it can be tested. */
import type { Job, Me } from '../../api/types';

export type Show = 'all' | 'failing' | 'warnings' | 'disabled' | 'scheduled' | 'mine';
export type Sort = 'name' | 'next' | 'last' | 'failing';

export const SHOW_LABEL: Record<Show, string> = {
    all: 'All jobs',
    failing: 'Last run failed',
    warnings: 'Has warnings',
    disabled: 'Disabled',
    scheduled: 'Scheduled',
    mine: 'My jobs',
};

export const SORT_LABEL: Record<Sort, string> = {
    name: 'Name',
    next: 'Next run',
    last: 'Last run, newest first',
    failing: 'Failed first',
};

const failed = (j: Job) => Boolean(j.last_run && j.last_run.state === 'failed');

export function showJobs(jobs: Job[], show: Show, me: Me | null | undefined): Job[] {
    switch (show) {
        case 'failing':
            return jobs.filter(failed);
        case 'warnings':
            return jobs.filter((j) => (j.warnings || []).length > 0);
        case 'disabled':
            return jobs.filter((j) => !j.enabled);
        case 'scheduled':
            return jobs.filter((j) => j.enabled && Boolean(j.next_run));
        case 'mine':
            return me ? jobs.filter((j) => j.owner === me.user) : jobs;
        default:
            return jobs;
    }
}

export function sortJobs(jobs: Job[], sort: Sort): Job[] {
    const byName = (a: Job, b: Job) => a.name.localeCompare(b.name);
    const out = [...jobs];
    if (sort === 'next') {
        out.sort((a, b) => (a.next_run || Infinity) - (b.next_run || Infinity) || byName(a, b));
    } else if (sort === 'last') {
        const t = (j: Job) => (j.last_run ? j.last_run.scheduled_time : -Infinity);
        out.sort((a, b) => t(b) - t(a) || byName(a, b));
    } else if (sort === 'failing') {
        out.sort((a, b) => Number(failed(b)) - Number(failed(a)) || byName(a, b));
    } else {
        out.sort(byName);
    }
    return out;
}

/** How many of the recent runs failed, for the row's summary ("3 of the last 10 failed"). */
export function failedCount(job: Job): number {
    return (job.recent_runs || []).filter((r) => r.state === 'failed').length;
}

/** How far ahead a time is, short: "in 40 s", "in 6 min", "in 2 h 5 min", "in 3 days". */
export function inText(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) {
        return s <= 5 ? 'now' : `in ${s} s`;
    }
    const m = Math.round(s / 60);
    if (m < 60) {
        return `in ${m} min`;
    }
    if (m < 24 * 60) {
        const h = Math.floor(m / 60);
        return m % 60 ? `in ${h} h ${m % 60} min` : `in ${h} h`;
    }
    const d = Math.round(m / (24 * 60));
    return `in ${d} day${d === 1 ? '' : 's'}`;
}

const TYPICAL_MIN_RUNS = 3;

/** The median run time of the recent runs that succeeded (seconds), or null with fewer than 3. */
export function typicalDuration(job: Job): number | null {
    const times = (job.recent_runs || [])
        .filter((r) => r.state === 'succeeded' && r.started_at && r.ended_at && r.ended_at >= r.started_at)
        .map((r) => (r.ended_at as number) - (r.started_at as number))
        .sort((a, b) => a - b);
    if (times.length < TYPICAL_MIN_RUNS) {
        return null;
    }
    const mid = Math.floor(times.length / 2);
    return times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2;
}

/** How long the last run took, or has been running (seconds), or null if it has not started. */
export function lastDuration(job: Job, now: number): number | null {
    const r = job.last_run;
    if (!r || !r.started_at) {
        return null;
    }
    return (r.ended_at || now) - r.started_at;
}

const SLOW_RATIO = 2;
const SLOW_MARGIN = 30;

/** How many times longer than usual the last run took (or is taking), when that is at least
 * twice as long and 30 seconds more; else null. */
export function slowRatio(job: Job, now: number): number | null {
    const usual = typicalDuration(job);
    const last = lastDuration(job, now);
    if (usual === null || last === null) {
        return null;
    }
    return last >= usual * SLOW_RATIO && last - usual >= SLOW_MARGIN ? last / Math.max(usual, 1) : null;
}
