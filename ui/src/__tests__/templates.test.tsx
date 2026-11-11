import { findIssues } from '../features/builder/graphLogic';
import { JOB_TEMPLATES, templateByKey } from '../features/builder/templates';

describe('job templates', () => {
    it('lists rollup, serial, parallel and blank in order', () => {
        expect(JOB_TEMPLATES.map((t) => t.key)).toEqual(['rollup', 'serial', 'parallel', 'blank']);
    });

    it.each(JOB_TEMPLATES.map((t) => [t.key, t] as const))('%s builds a job with no error-level issue', (_key, t) => {
        expect(findIssues({ ...t.build(), name: 'Named' }).filter((i) => i.level === 'error')).toEqual([]);
    });

    it('rollup has 3 steps, 2 edges and a 01:00 cron', () => {
        const job = templateByKey('rollup')!.build();
        expect(job.steps.map((s) => s.id)).toEqual(['daily', 'weekly', 'monthly']);
        expect(job.edges).toHaveLength(2);
        expect(job.triggers).toEqual([{ type: 'cron', cron: '0 1 * * *' }]);
        expect(job.steps[1].run_when).toEqual({ kind: 'cron', value: '* * * * 1' });
        expect(job.steps[2].run_when).toEqual({ kind: 'cron', value: '* * 1 * *' });
        expect(job.steps[0].spl).toBe('```Replace with your search```\n| makeresults');
    });

    it('parallel combines two steps with a Results of earlier steps step', () => {
        const job = templateByKey('parallel')!.build();
        expect(job.steps.find((s) => s.id === 'combined')).toMatchObject({ type: 'previous', spl: '| stats count' });
        expect((job.edges || []).map((e) => `${e.from}>${e.to}`)).toEqual(['left>combined', 'right>combined']);
    });

    it('builds a new object each call', () => {
        const t = templateByKey('serial')!;
        expect(t.build()).not.toBe(t.build());
        expect(t.build().steps).not.toBe(t.build().steps);
    });

    it('resolves keys, null for unknown', () => {
        expect(templateByKey('blank')!.title).toBe('Blank job');
        expect(templateByKey('nope')).toBeNull();
        expect(templateByKey(null)).toBeNull();
    });
});
