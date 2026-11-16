import type { JobDefinition } from '../api/types';
import {
    EDGE_CONDITION_FOR_PORT, HOOK_FOR_PORT, buildGraph, canConnect, nodeKindOfAction, outputPorts,
} from '../features/builder/nodeModel';

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

describe('buildGraph', () => {
    const g = buildGraph(job);
    it('orders node keys', () => {
        expect(g.nodes.map((n) => n.key)).toEqual(['trigger:0', 'job', 'step:a', 'step:b', 'step:c', 'cond:a>c', 'action:job:0', 'action:a:0']);
    });
    it('derives links', () => {
        const has = (from: string, port: string | null, to: string, kind: string, data: boolean) =>
            g.links.some((l) => l.from === from && l.port === port && l.to === to && l.kind === kind && l.data === data);
        expect(has('trigger:0', null, 'step:a', 'trigger', false)).toBe(true);
        expect(g.links.filter((l) => l.kind === 'trigger')).toHaveLength(1);
        expect(has('step:a', 'success', 'step:b', 'edge', true)).toBe(true);
        expect(has('step:a', 'if', 'cond:a>c', 'condition', false)).toBe(true);
        expect(has('cond:a>c', 'then', 'step:c', 'condition', false)).toBe(true);
        expect(has('job', 'failure', 'action:job:0', 'action', false)).toBe(true);
        expect(has('step:a', 'failure', 'action:a:0', 'action', false)).toBe(true);
    });
    it('labels nodes', () => {
        expect(nodeKindOfAction(job.actions![0])).toBe('slack');
        expect(nodeKindOfAction(job.steps[0].actions![0])).toBe('email');
        expect(g.nodes[0].label).toBe('Schedule');
        expect(g.nodes[1].label).toBe('Whole job');
    });
    it('copes with a bare job and dangling links', () => {
        const bare = buildGraph({ name: 'x', enabled: true, steps: [{ id: 'a', type: 'inline' }], edges: [{ from: 'a', to: 'zz' }] });
        expect(bare.nodes.map((n) => n.key)).toEqual(['job', 'step:a']);
        expect(bare.links).toEqual([]);
    });
});

describe('ports', () => {
    it('lists output ports', () => {
        expect(outputPorts('search')).toEqual(['success', 'failure', 'always', 'start', 'delayed', 'if']);
        expect(outputPorts('job')).toEqual(['success', 'failure', 'always', 'start', 'delayed']);
        expect(outputPorts('condition')).toEqual(['then']);
        expect(outputPorts('trigger_cron')).toEqual([]);
        expect(outputPorts('email')).toEqual([]);
    });
    it('maps ports', () => {
        expect(HOOK_FOR_PORT).toEqual({ success: 'on_success', failure: 'on_failure', always: 'on_complete', start: 'on_start', delayed: 'on_delayed', if: null, then: null });
        expect(EDGE_CONDITION_FOR_PORT).toEqual({ success: 'on_success', failure: 'on_failure', always: 'always', start: null, delayed: null, if: 'expression', then: null });
    });
});

describe('canConnect', () => {
    it('allows and rejects', () => {
        expect(canConnect(job, 'step:b', 'success', 'step:c')).toEqual({ ok: true });
        const start = canConnect(job, 'step:a', 'start', 'step:b');
        expect(start).toEqual({ ok: false, reason: 'Started and Delayed lines can only go to an action' });
        expect(JSON.stringify(canConnect(job, 'step:a', 'success', 'step:a'))).toContain('loop');
        expect(JSON.stringify(canConnect(job, 'step:b', 'success', 'step:a'))).toContain('loop');
        expect(canConnect(job, 'step:a', 'success', 'action:job:0')).toEqual({ ok: true });
        expect(canConnect(job, 'trigger:0', 'success', 'step:a').ok).toBe(false);
        expect(canConnect(job, 'job', 'if', 'step:a').ok).toBe(false);
        expect(canConnect(job, 'step:a', 'success', 'job').ok).toBe(false);
        expect(canConnect(job, 'step:a', 'success', 'trigger:0').ok).toBe(false);
        expect(canConnect(job, 'cond:a>c', 'then', 'step:b')).toEqual({ ok: true });
    });
});

describe('readable details', () => {
    const detailOf = (j: Partial<JobDefinition>, key: string) =>
        buildGraph({ name: 'x', enabled: true, steps: [], ...j }).nodes.find((n) => n.key === key)!.detail;
    it('labels step types', () => {
        const steps: JobDefinition['steps'] = [
            { id: 'a', type: 'inline' },
            { id: 'b', type: 'saved_search', saved_search_ref: 'ref1' },
            { id: 'c', type: 'saved_search' },
            { id: 'd', type: 'previous' },
            { id: 'e', type: 'previous', output: { kind: 'summary_index', index: 'si' } },
            { id: 'f', type: 'inline', output: { kind: 'lookup', name: 'lk' } },
        ];
        const d = (id: string) => detailOf({ steps }, `step:${id}`);
        expect(d('a')).toBe('Search');
        expect(d('b')).toBe('Saved search: ref1');
        expect(d('c')).toBe('Saved search');
        expect(d('d')).toBe('Results of earlier steps');
        expect(d('e')).toBe('Summary index: si');
        expect(d('f')).toBe('Lookup: lk');
    });
    it('words completion triggers', () => {
        const t = (tr: object) => detailOf({ triggers: [tr as never] }, 'trigger:0');
        expect(t({ type: 'completion', job: 'up', on: 'success' })).toBe('When up succeeds');
        expect(t({ type: 'completion', job: 'up', on: 'complete' })).toBe('When up finishes');
        expect(t({ type: 'completion', job: '', on: 'success' })).toBe('Pick a job');
    });
});
