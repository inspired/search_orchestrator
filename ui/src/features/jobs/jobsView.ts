/* Which jobs the Jobs page shows and in what order: pure, so it can be tested. */
import type { Job, Me } from '../../api/types';

export type Show = 'all' | 'failing' | 'disabled' | 'scheduled' | 'mine';
export type Sort = 'name' | 'next' | 'last' | 'failing';

export const SHOW_LABEL: Record<Show, string> = {
    all: 'All jobs',
    failing: 'Last run failed',
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
