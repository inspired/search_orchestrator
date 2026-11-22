import { insertAt, availableTokens } from '../features/builder/tokens';
import { rollupJob } from './builderFixtures';

const titles = (g: { title: string }[]) => g.map((x) => x.title);

describe('availableTokens', () => {
    test('lists this run and every upstream step, not the step itself', () => {
        const groups = availableTokens(rollupJob(), 'monthly', {});
        expect(titles(groups)).toEqual(['This run', 'Daily summary', 'Weekly rollup']);
    });

    test('this run lists id, scheduled time, now and each parameter', () => {
        const job = rollupJob({ params: [{ name: 'region' }] });
        const run = availableTokens(job, 'monthly', {})[0];
        expect(run.options.map((o) => o.token)).toEqual(['$run.id$', '$run.scheduled_time$', '$run.now$', '$run.param.region$']);
        expect(run.options.map((o) => o.label)).toEqual(['Run id', 'Scheduled time', 'Now', 'Parameter region']);
    });

    test('a step offers sid, result count and status, then first-row fields from its preview', () => {
        const daily = availableTokens(rollupJob(), 'monthly', { daily: ['host'] })[1];
        expect(daily.options.map((o) => o.token)).toEqual(['$daily.sid$', '$daily.resultCount$', '$daily.status$', '$daily.first.host$']);
        expect(daily.options.map((o) => o.label)).toEqual(['Search id', 'Result count', 'Status', 'First row: host']);
    });

    test('first-row tokens skip fields the server cannot resolve', () => {
        const daily = availableTokens(rollupJob(), 'monthly', { daily: ['host', 'avg(bytes)', 'count'] })[1];
        expect(daily.options.map((o) => o.token).filter((t) => t.includes('.first.'))).toEqual(['$daily.first.host$', '$daily.first.count$']);
    });

    test('job-level actions list every step', () => {
        expect(titles(availableTokens(rollupJob(), null, {}))).toEqual(['This run', 'Daily summary', 'Weekly rollup', 'Monthly rollup']);
    });

    test('a root step has only this run', () => {
        expect(titles(availableTokens(rollupJob(), 'daily', {}))).toEqual(['This run']);
    });
});

describe('insertAt', () => {
    test('inserts at the caret', () => {
        expect(insertAt('ab', { start: 1, end: 1 }, '$x$')).toEqual({ text: 'a$x$b', caret: 4 });
    });
    test('replaces a selection', () => {
        expect(insertAt('abc', { start: 0, end: 3 }, '$x$')).toEqual({ text: '$x$', caret: 3 });
    });
    test('appends with no selection', () => {
        expect(insertAt('ab', null, '$x$')).toEqual({ text: 'ab$x$', caret: 5 });
        expect(insertAt('', null, '$x$')).toEqual({ text: '$x$', caret: 3 });
    });
    test('clamps a stale selection', () => {
        expect(insertAt('ab', { start: 9, end: 12 }, '$x$')).toEqual({ text: 'ab$x$', caret: 5 });
    });
});
