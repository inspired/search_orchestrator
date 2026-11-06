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

    test('renaming a step rewrites its tokens and leaves literal $ alone', () => {
        const withTokens: JobDefinition = {
            name: 'Rollups',
            enabled: true,
            steps: [
                { id: 'daily', type: 'inline', spl: '| makeresults' },
                {
                    id: 'weekly',
                    type: 'inline',
                    spl: '| loadjob $daily.sid$ | where n=$daily.first.n|0$ | rex "foo$" | eval x="$daily$ $dailyx.sid$ $unknown$"',
                    run_when: { kind: 'expression', value: '$daily.resultCount$ > 0' },
                    actions: [{ hook: 'on_failure', type: 'email', to: 'a@b.c', subject: 'rows $daily.resultCount$', params: { p: '$daily.status$' } }],
                },
            ],
            edges: [{ from: 'daily', to: 'weekly', condition: 'expression', expression: '$daily.status$ == "succeeded"' }],
            actions: [{ hook: 'on_success', type: 'event', index: 'main', payload: '$daily.sid$ costs $5' }],
        };
        const s = reducer(initialState(withTokens), { type: 'updateStep', id: 'daily', changes: { id: 'day' } });
        const weekly = s.job.steps[1];
        expect(weekly.spl).toBe('| loadjob $day.sid$ | where n=$day.first.n|0$ | rex "foo$" | eval x="$daily$ $dailyx.sid$ $unknown$"');
        expect(weekly.run_when).toEqual({ kind: 'expression', value: '$day.resultCount$ > 0' });
        expect(weekly.actions?.[0].subject).toBe('rows $day.resultCount$');
        expect(weekly.actions?.[0].params).toEqual({ p: '$day.status$' });
        expect(s.job.edges?.[0].expression).toBe('$day.status$ == "succeeded"');
        expect(s.job.actions?.[0].payload).toBe('$day.sid$ costs $5');
    });

    test('undo history is capped at 100 steps', () => {
        let s = initialState(job);
        for (let i = 0; i < 120; i += 1) {
            s = reducer(s, { type: 'moveStep', id: 'daily', x: i, y: i });
        }
        expect(s.past).toHaveLength(100);
        for (let i = 0; i < 150; i += 1) {
            s = reducer(s, { type: 'undo' });
        }
        expect(s.positions.daily).toEqual({ x: 19, y: 19 });
    });
});
