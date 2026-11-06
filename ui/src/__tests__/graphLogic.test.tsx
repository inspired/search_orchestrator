import { autoLayout, findIssues, runWhenPreset, wouldCycle } from '../features/builder/graphLogic';
import type { JobDefinition } from '../api/types';

const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
];

describe('graphLogic', () => {
    test('wouldCycle detects indirect cycle', () => {
        expect(wouldCycle(edges, 'c', 'a')).toBe(true);
        expect(wouldCycle(edges, 'a', 'a')).toBe(true);
        expect(wouldCycle(edges, 'a', 'c')).toBe(false);
    });

    test('autoLayout lays out top to bottom', () => {
        const pos = autoLayout([{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges);
        expect(pos.a.y).toBeLessThan(pos.b.y);
        expect(pos.b.y).toBeLessThan(pos.c.y);
    });

    test('findIssues flags a bad step id and an empty search on the step', () => {
        const job: JobDefinition = {
            name: 'j',
            enabled: true,
            steps: [
                { id: 'Bad-Id', type: 'inline', spl: '| makeresults' },
                { id: 'ok', type: 'inline', spl: '' },
            ],
            edges: [],
        };
        const issues = findIssues(job);
        expect(issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ level: 'error', code: 'bad_step_id', step: 'Bad-Id' }),
                expect.objectContaining({ level: 'error', code: 'bad_step', step: 'ok' }),
            ])
        );
    });

    test('run-when presets are day-level cron', () => {
        expect(runWhenPreset('mondays')).toEqual({ kind: 'cron', value: '* * * * 1' });
        expect(runWhenPreset('first_of_month')).toEqual({ kind: 'cron', value: '* * 1 * *' });
    });
});
