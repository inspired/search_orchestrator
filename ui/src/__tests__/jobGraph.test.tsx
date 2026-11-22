import type { Job } from '../api/types';
import { buildJobGraph, related } from '../features/dependencies/jobGraph';

function job(id: string, extra: Partial<Job> = {}): Job {
    return { id, name: `Job ${id}`, owner: 'admin', enabled: true, steps: [], permissions: {} as Job['permissions'], ...extra };
}

describe('buildJobGraph', () => {
    it('makes an edge for a completion trigger, defaulting to success', () => {
        const g = buildJobGraph([job('a'), job('b', { triggers: [{ type: 'completion', job: 'a' }] })]);
        expect(g.edges).toEqual([{ from: 'a', to: 'b', kinds: ['completion'], label: 'after it succeeds' }]);
        expect(g.unconnected).toEqual([]);
    });

    it('labels on: complete as after it finishes', () => {
        const g = buildJobGraph([job('a'), job('b', { triggers: [{ type: 'completion', job: 'a', on: 'complete' }] })]);
        expect(g.edges[0].label).toBe('after it finishes');
    });

    it('labels a job-level start_job action by its outcome', () => {
        const g = buildJobGraph([
            job('a', { actions: [{ hook: 'on_failure', type: 'start_job', job: 'b' }] }),
            job('b'),
        ]);
        expect(g.edges).toEqual([{ from: 'a', to: 'b', kinds: ['start_job'], label: 'start-job action · Fails' }]);
    });

    it('labels a step start_job action with the step name', () => {
        const g = buildJobGraph([
            job('a', { steps: [{ id: 's1', name: 'Load', type: 'inline', actions: [{ hook: 'on_success', type: 'start_job', job: 'b' }] }] }),
            job('b'),
        ]);
        expect(g.edges[0].label).toBe('start-job action · Load · Succeeds');
    });

    it('merges several reasons for the same pair into one edge', () => {
        const g = buildJobGraph([
            job('a', { actions: [{ hook: 'on_success', type: 'start_job', job: 'b' }] }),
            job('b', { triggers: [{ type: 'completion', job: 'a' }] }),
        ]);
        expect(g.edges).toHaveLength(1);
        expect(g.edges[0].kinds.sort()).toEqual(['completion', 'start_job']);
        expect(g.edges[0].label).toBe('after it succeeds; start-job action · Succeeds');
    });

    it('hides jobs the viewer cannot see and never leaks their id', () => {
        const g = buildJobGraph([
            job('b', { triggers: [{ type: 'completion', job: 'secret1' }], actions: [{ hook: 'on_failure', type: 'start_job', job: 'secret2' }] }),
        ]);
        const hidden = g.nodes.filter((n) => n.hidden);
        expect(hidden.map((n) => n.id)).toEqual(['hidden:1', 'hidden:2']);
        expect(hidden.every((n) => n.name === "Job you can't see")).toBe(true);
        expect(JSON.stringify(g)).not.toContain('secret');
        expect(g.edges.map((e) => [e.from, e.to])).toEqual([['hidden:1', 'b'], ['b', 'hidden:2']]);
    });

    it('lists unconnected visible jobs sorted by name', () => {
        const g = buildJobGraph([job('z', { name: 'Zed' }), job('y', { name: 'Alpha' }), job('a'), job('b', { triggers: [{ type: 'completion', job: 'a' }] })]);
        expect(g.unconnected).toEqual(['y', 'z']);
    });

    it('keeps a disabled job as a node', () => {
        const g = buildJobGraph([job('a', { enabled: false })]);
        expect(g.nodes[0]).toMatchObject({ id: 'a', enabled: false });
    });
});

describe('related', () => {
    it('finds upstream and downstream transitively', () => {
        const g = buildJobGraph([
            job('a'),
            job('b', { triggers: [{ type: 'completion', job: 'a' }] }),
            job('c', { triggers: [{ type: 'completion', job: 'b' }] }),
        ]);
        expect(related(g, 'c').upstream).toEqual(new Set(['a', 'b']));
        expect(related(g, 'a').downstream).toEqual(new Set(['b', 'c']));
        expect(related(g, 'b').downstream).toEqual(new Set(['c']));
    });

    it('terminates on cycles', () => {
        const g = buildJobGraph([
            job('a', { triggers: [{ type: 'completion', job: 'b' }] }),
            job('b', { triggers: [{ type: 'completion', job: 'a' }] }),
        ]);
        expect(related(g, 'a').downstream).toEqual(new Set(['b']));
    });
});
