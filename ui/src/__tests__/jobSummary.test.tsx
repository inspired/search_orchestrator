import { jobSummary, filterJobs } from '../features/jobs/jobSummary';
import { job } from './fixtures';
import { rollupJob } from './builderFixtures';

describe('jobSummary', () => {
    test('a cron job reads its schedule and step count', () => {
        expect(jobSummary(rollupJob())).toBe('Every day at 01:00 · 3 steps');
    });
    test('no triggers and one step', () => {
        expect(jobSummary(job({ triggers: [] }))).toBe('Started by hand · 1 step');
    });
    test('a completion trigger names the job it follows', () => {
        const j = job({ triggers: [{ type: 'completion', job: 'nightly', on: 'success' }] });
        expect(jobSummary(j, { nightly: 'Nightly load' })).toBe('After Nightly load succeeds · 1 step');
        expect(jobSummary(j)).toBe('After nightly succeeds · 1 step');
        const c = job({ triggers: [{ type: 'completion', job: 'nightly', on: 'complete' }] });
        expect(jobSummary(c)).toBe('After nightly completes · 1 step');
    });
    test('the cron describes the job when there are both triggers', () => {
        const j = job({ triggers: [{ type: 'completion', job: 'n', on: 'success' }, { type: 'cron', cron: '*/15 * * * *' }] });
        expect(jobSummary(j)).toBe('Custom schedule: */15 * * * * · 1 step');
    });
});

describe('filterJobs', () => {
    const jobs = [rollupJob(), job({ id: 'x', name: 'Other', owner: 'bob', description: 'Cleans up' })];
    test('matches name case-insensitively', () => {
        expect(filterJobs(jobs, 'ROLL').map((j) => j.id)).toEqual(['rollups']);
    });
    test('matches id, owner and description', () => {
        expect(filterJobs(jobs, 'rollups')).toHaveLength(1);
        expect(filterJobs(jobs, 'BOB')[0].id).toBe('x');
        expect(filterJobs(jobs, 'cleans')[0].id).toBe('x');
    });
    test('a blank query keeps everything', () => {
        expect(filterJobs(jobs, '  ')).toHaveLength(2);
    });
});
