import type { Job } from '../api/types';
import type { BuilderApi } from '../features/builder/BuilderPage';
import { job as baseJob, me } from './fixtures';

/** daily -> weekly -> monthly, weekly a saved search. */
export function rollupJob(over: Partial<Job> = {}): Job {
    return baseJob({
        id: 'rollups',
        name: 'Summary rollups',
        steps: [
            { id: 'daily', name: 'Daily summary', type: 'inline', spl: '| makeresults' },
            { id: 'weekly', name: 'Weekly rollup', type: 'saved_search', saved_search_ref: 'Weekly rollup' },
            { id: 'monthly', name: 'Monthly rollup', type: 'inline', spl: '| loadjob $weekly.sid$' },
        ],
        edges: [
            { from: 'daily', to: 'weekly', condition: 'on_success' },
            { from: 'weekly', to: 'monthly', condition: 'on_success' },
        ],
        triggers: [{ type: 'cron', cron: '0 1 * * *' }],
        run_roles: [],
        ...over,
    });
}

export function fakeApi(over: Partial<BuilderApi> = {}): BuilderApi {
    return {
        getJob: jest.fn().mockResolvedValue(rollupJob()),
        validateJob: jest.fn().mockResolvedValue({ valid: true, issues: [], owner_will_change: false, owner: 'alice' }),
        createJob: jest.fn(),
        updateJob: jest.fn().mockResolvedValue({ job: rollupJob(), issues: [], owner_will_change: false, owner: 'alice' }),
        listDestinations: jest.fn().mockResolvedValue([]),
        listJobs: jest.fn().mockResolvedValue([]),
        me: jest.fn().mockResolvedValue(me),
        previewDefaults: jest.fn().mockResolvedValue({ scheduled_time: 1762390800 }),
        listRuns: jest.fn().mockResolvedValue([]),
        startPreview: jest.fn().mockResolvedValue({ status: 'started', sid: 'sid-1', spl: '| makeresults' }),
        previewStatus: jest.fn().mockResolvedValue({ state: 'done', result_count: 7, run_duration: 0.2, messages: [] }),
        previewResults: jest.fn().mockResolvedValue({ fields: ['x'], rows: [{ x: '1' }], total: 1 }),
        cancelPreview: jest.fn().mockResolvedValue({ cancelled: true }),
        ...over,
    };
}
