import type { JobDefinition } from '../api/types';
import { buildGraph } from '../features/builder/nodeModel';
import { linkLabel, lineMenuOutcomes, usedOutcomes, whenOptions } from '../features/builder/outcomes';

const job: JobDefinition = {
    name: 'nightly',
    enabled: true,
    triggers: [{ type: 'cron', cron: '0 2 * * *' }],
    steps: [
        { id: 'a', type: 'inline', spl: 'search x', actions: [{ hook: 'on_failure', type: 'email', to: 'x@y' }] },
        { id: 'b', type: 'previous', spl: '| head 1' },
        { id: 'c', type: 'saved_search', saved_search_ref: 's' },
    ],
    edges: [
        { from: 'a', to: 'b', condition: 'on_success' },
        { from: 'a', to: 'c', condition: 'expression', expression: '$a.resultCount$ > 0' },
    ],
    actions: [{ hook: 'on_failure', type: 'webhook', destination: 'ops', preset: 'slack' }],
};
const g = buildGraph(job);
const link = (from: string, to: string) => g.links.find((l) => l.from === from && l.to === to)!;

describe('whenOptions', () => {
    it('lists every outcome of a step with counts', () => {
        const o = whenOptions(job, 'step:a');
        expect(o.map((x) => x.outcome)).toEqual(['success', 'failure', 'always', 'start', 'delayed', 'if']);
        expect(o.map((x) => x.label)).toEqual(['Succeeds', 'Fails', 'Finishes either way', 'Starts', 'Is delayed', 'If a condition is true']);
        expect(o.map((x) => x.count)).toEqual([1, 1, 0, 0, 0, 1]);
        expect(o.find((x) => x.outcome === 'start')!.note).toBe('actions only');
        expect(o.find((x) => x.outcome === 'success')!.note).toBeUndefined();
    });
    it('filters by target', () => {
        const toStep = whenOptions(job, 'step:a', 'step:b').map((x) => x.outcome);
        expect(toStep).not.toContain('start');
        expect(toStep).not.toContain('delayed');
        expect(toStep).toContain('if');
        const toAction = whenOptions(job, 'step:a', 'action:job:0');
        expect(toAction.map((x) => x.outcome)).not.toContain('if');
        expect(toAction.map((x) => x.outcome)).toContain('start');
        expect(toAction.find((x) => x.outcome === 'start')!.note).toBeUndefined();
    });
    it('has no if for the whole job', () => {
        expect(whenOptions(job, 'job').map((x) => x.outcome)).toEqual(['success', 'failure', 'always', 'start', 'delayed']);
    });
    it('is empty for nodes without outcomes', () => {
        expect(whenOptions(job, 'action:job:0')).toEqual([]);
        expect(whenOptions(job, 'cond:a>c')).toEqual([]);
    });
});

describe('usedOutcomes', () => {
    it('returns used ports in port order', () => {
        expect(usedOutcomes(g, 'step:a')).toEqual(['success', 'failure', 'if']);
        expect(usedOutcomes(g, 'cond:a>c')).toEqual(['then']);
        expect(usedOutcomes(g, 'step:b')).toEqual([]);
    });
});

describe('linkLabel', () => {
    it('labels lines', () => {
        expect(linkLabel(job, link('step:a', 'step:b'))).toBe('✓ Succeeds');
        expect(linkLabel(job, link('step:a', 'action:a:0'))).toBe('✗ Fails');
        expect(linkLabel(job, link('cond:a>c', 'step:c'))).toBe('$a.resultCount$ > 0');
        expect(linkLabel(job, link('trigger:0', 'step:a'))).toBe('');
    });
    it('cuts long conditions', () => {
        const long: JobDefinition = { ...job, edges: [{ from: 'a', to: 'c', condition: 'expression', expression: 'x'.repeat(40) }] };
        const lg = buildGraph(long);
        const l = lg.links.find((k) => k.from === 'cond:a>c')!;
        expect(linkLabel(long, l)).toBe(`${'x'.repeat(24)}…`);
    });
});

describe('lineMenuOutcomes', () => {
    it('step to action excludes if', () => {
        const o = lineMenuOutcomes(job, link('step:a', 'action:a:0'));
        expect(o).not.toContain('if');
        expect(o).toContain('start');
    });
    it('step to step excludes start and delayed', () => {
        const o = lineMenuOutcomes(job, link('step:a', 'step:b'));
        expect(o).toEqual(['success', 'failure', 'always', 'if']);
    });
    it('condition lines list every step outcome', () => {
        const all = ['success', 'failure', 'always', 'start', 'delayed', 'if'];
        expect(lineMenuOutcomes(job, link('step:a', 'cond:a>c'))).toEqual(all);
        expect(lineMenuOutcomes(job, link('cond:a>c', 'step:c'))).toEqual(all);
    });
    it('is empty for trigger lines', () => {
        expect(lineMenuOutcomes(job, link('trigger:0', 'step:a'))).toEqual([]);
    });
});
