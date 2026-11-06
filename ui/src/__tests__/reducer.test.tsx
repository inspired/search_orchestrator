import { initialState, reducer } from '../features/builder/reducer';
import type { JobDefinition } from '../api/types';

const job: JobDefinition = {
    name: 'Rollups',
    enabled: true,
    steps: [
        { id: 'daily', type: 'inline', spl: '| makeresults' },
        { id: 'weekly', type: 'inline', spl: '| loadjob $daily.sid$' },
        { id: 'monthly', type: 'inline', spl: '| loadjob $weekly.sid$' },
    ],
    edges: [
        { from: 'daily', to: 'weekly', condition: 'on_success' },
        { from: 'weekly', to: 'monthly', condition: 'on_success' },
    ],
};

describe('builder reducer', () => {
    test('removeStep removes its edges', () => {
        const s = reducer(initialState(job), { type: 'removeStep', id: 'weekly' });
        expect(s.job.steps.map((x) => x.id)).toEqual(['daily', 'monthly']);
        expect(s.job.edges).toEqual([]);
        expect(s.positions.weekly).toBeUndefined();
    });

    test('undo restores', () => {
        let s = initialState(job);
        s = reducer(s, { type: 'removeStep', id: 'weekly' });
        s = reducer(s, { type: 'undo' });
        expect(s.job).toEqual(job);
        s = reducer(s, { type: 'redo' });
        expect(s.job.steps).toHaveLength(2);
    });

    test('connect refuses an edge that would make a cycle', () => {
        const s0 = initialState(job);
        const s = reducer(s0, { type: 'connect', from: 'monthly', to: 'daily' });
        expect(s).toBe(s0);
    });

    test('renaming a step id renames its edges', () => {
        const s = reducer(initialState(job), { type: 'updateStep', id: 'weekly', changes: { id: 'week' } });
        expect(s.job.edges).toEqual([
            { from: 'daily', to: 'week', condition: 'on_success' },
            { from: 'week', to: 'monthly', condition: 'on_success' },
        ]);
        expect(s.positions.week).toBeDefined();
    });
});
