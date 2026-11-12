import {
    autoLayout,
    daysCron,
    daysOfCron,
    daysLabel,
    findIssues,
    runWhenChoice,
    runWhenPreset,
    runWhenSummary,
    wouldCycle,
} from '../features/builder/graphLogic';
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
        expect(runWhenPreset('days')).toEqual({ kind: 'cron', value: '* * * * 1' });
        expect(runWhenPreset('first_of_month')).toEqual({ kind: 'cron', value: '* * 1 * *' });
    });

    test('days of week read from a day-of-week-only cron', () => {
        expect(daysOfCron('* * * * 1')).toEqual([1]);
        expect(daysOfCron(' * * * * 1-5 ')).toEqual([1, 2, 3, 4, 5]);
        expect(daysOfCron('* * * * 0,6')).toEqual([0, 6]);
        expect(daysOfCron('* * * * 7,1')).toEqual([0, 1]);
        expect(daysOfCron('* * * * mon,wed-fri')).toEqual([1, 3, 4, 5]);
        expect(daysOfCron('0 1 * * 1')).toBeNull();
        expect(daysOfCron('* * 1 * 1')).toBeNull();
        expect(daysOfCron('* * * * */2')).toBeNull();
        expect(daysOfCron('* * * * *')).toBeNull();
        expect(daysOfCron('* * * * 8')).toBeNull();
    });

    test('days of week write a short cron', () => {
        expect(daysCron([1])).toBe('* * * * 1');
        expect(daysCron([5, 1, 2, 3, 4])).toBe('* * * * 1-5');
        expect(daysCron([0, 6])).toBe('* * * * 0,6');
        expect(daysCron([1, 3, 5])).toBe('* * * * 1,3,5');
        expect(daysCron([0, 1, 2, 4])).toBe('* * * * 0-2,4');
    });

    test('days of week have readable labels, Monday first', () => {
        expect(daysLabel([1])).toBe('Mondays');
        expect(daysLabel([0])).toBe('Sundays');
        expect(daysLabel([1, 2, 3, 4, 5])).toBe('Weekdays');
        expect(daysLabel([0, 6])).toBe('Weekends');
        expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
        expect(daysLabel([1, 3, 5])).toBe('Mon, Wed, Fri');
        expect(daysLabel([0, 2, 3, 4])).toBe('Tue–Thu, Sun');
        expect(daysLabel([0, 1, 6])).toBe('Mon, Sat, Sun');
    });

    test('a day-of-week cron is the days choice and summarised by its days', () => {
        expect(runWhenChoice({ kind: 'cron', value: '* * * * 1' })).toBe('days');
        expect(runWhenChoice({ kind: 'cron', value: '* * * * 1,3,5' })).toBe('days');
        expect(runWhenChoice({ kind: 'cron', value: '* * 1 * *' })).toBe('first_of_month');
        expect(runWhenChoice({ kind: 'cron', value: '0 1 * * 1' })).toBe('cron');
        expect(runWhenSummary({ kind: 'cron', value: '* * * * 1' })).toBe('Mondays only');
        expect(runWhenSummary({ kind: 'cron', value: '* * * * 1,3,5' })).toBe('Mon, Wed, Fri only');
        expect(runWhenSummary({ kind: 'cron', value: '* * * * 0-6' })).toBe('every day');
        expect(runWhenSummary({ kind: 'cron', value: '* * 1 * *' })).toBe('1st of month only');
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

test('findIssues refuses a step saved with the removed read_previous', () => {
    const job: JobDefinition = { name: 'j', enabled: true, edges: [{ from: 'a', to: 'b' }],
        steps: [{ id: 'a', type: 'inline', spl: '| x' },
                { id: 'b', type: 'saved_search', saved_search_ref: 'rep', read_previous: true }] };
    const found = findIssues(job).filter((i) => i.code === 'read_previous_removed').map((i) => i.step);
    expect(found).toEqual(['b']);
});
