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
    test('findIssues flags From previous steps problems with the server messages', () => {
        const job: JobDefinition = {
            name: 'j',
            enabled: true,
            steps: [
                { id: 'a', type: 'inline', spl: '| makeresults' },
                { id: 'nopipe', type: 'previous', spl: 'stats count' },
                { id: 'empty', type: 'previous', spl: '   ' },
                { id: 'alone', type: 'previous', spl: '| stats count' },
                { id: 'ok', type: 'previous', spl: '  | stats count' },
            ],
            edges: ['nopipe', 'empty', 'ok'].map((to) => ({ from: 'a', to, condition: 'on_success' as const })),
        };
        const found = findIssues(job).map((i) => [i.step, i.code, i.message]);
        expect(found).toEqual([
            ['nopipe', 'previous_needs_pipe', 'A From previous steps search must start with |'],
            ['empty', 'previous_needs_pipe', 'A From previous steps search must start with |'],
            ['alone', 'previous_needs_dependency', 'A From previous steps step must depend on at least one step'],
        ]);
    });
});

test('findIssues needs exactly one step before a report that reads it', () => {
    const msg = 'A report that reads the previous step needs exactly one step before it';
    const r = (id: string) => ({ id, type: 'saved_search' as const, saved_search_ref: 'rep', read_previous: true });
    const job: JobDefinition = { name: 'j', enabled: true,
        steps: [{ id: 'a', type: 'inline', spl: '| x' }, { id: 'c', type: 'inline', spl: '| x' },
                r('none'), r('one'), r('twice'), r('two')],
        edges: [{ from: 'a', to: 'one' }, { from: 'a', to: 'twice' }, { from: 'a', to: 'twice' },
                { from: 'a', to: 'two' }, { from: 'c', to: 'two' }] };
    const found = findIssues(job).filter((i) => i.code === 'report_input_needs_one').map((i) => [i.step, i.message]);
    expect(found).toEqual([['none', msg], ['two', msg]]);
});
