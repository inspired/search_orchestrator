/* One-line description of a job for the Jobs table, and the Jobs search filter. */
import type { Job } from '../../api/types';
import { describeSchedule } from '../builder/schedule';

export function jobSummary(job: Job, jobNames: Record<string, string> = {}): string {
    const triggers = job.triggers || [];
    const cron = triggers.find((t) => t.type === 'cron' && t.cron);
    const completion = triggers.find((t) => t.type === 'completion');
    let when = 'Started by hand';
    if (cron && cron.cron) {
        when = describeSchedule(cron.cron);
    } else if (completion) {
        const id = completion.job || '';
        when = `After ${jobNames[id] || id} ${completion.on === 'complete' ? 'completes' : 'succeeds'}`;
    }
    const n = job.steps.length;
    return `${when} · ${n} ${n === 1 ? 'step' : 'steps'}`;
}

export function filterJobs(jobs: Job[], query: string): Job[] {
    const q = query.trim().toLowerCase();
    if (!q) {
        return jobs;
    }
    return jobs.filter((j) => [j.name, j.id, j.owner, j.description].some((v) => (v || '').toLowerCase().includes(q)));
}
