import type { JobDefinition } from '../api/types';
import { buildGraph } from '../features/builder/nodeModel';
import { layoutFlow } from '../features/builder/flowLayout';
import { initialState, reducer } from '../features/builder/reducer';
import { removals } from '../features/builder/RemoveNodeModal';

const job = (): JobDefinition => ({
    name: 'L',
    enabled: true,
    steps: [
        { id: 'a', name: 'Load', type: 'inline', spl: 'x', actions: [{ hook: 'on_failure', type: 'email', to: 'x' }] },
        {
            id: 'b',
            name: 'Filter',
            type: 'inline',
            spl: 'y',
            actions: [
                { hook: 'on_failure', type: 'email', to: 'p' },
                { hook: 'on_success', type: 'email', to: 'q' },
                { hook: 'on_success', type: 'email', to: 'r' },
            ],
        },
        { id: 'c', name: 'Report', type: 'inline', spl: 'z' },
    ],
    edges: [
        { from: 'a', to: 'b', condition: 'expression', expression: '1=1' },
        { from: 'b', to: 'c', condition: 'on_success' },
    ],
    actions: [{ hook: 'on_success', type: 'email', to: 'j' }],
    triggers: [{ type: 'cron', cron: '* * * * *' }, { type: 'cron', cron: '0 * * * *' }, { type: 'cron', cron: '0 0 * * *' }],
    layout: {
        nodes: {
            'step:a': { x: 1, y: 1 },
            'step:b': { x: 2, y: 2 },
            'action:b:0': { x: 3, y: 3 },
            'action:b:1': { x: 4, y: 4 },
            'action:b:2': { x: 5, y: 5 },
            'trigger:0': { x: 6, y: 6 },
            'trigger:2': { x: 7, y: 7 },
            'cond:a>b': { x: 8, y: 8 },
        },
    },
});

describe('removeNodes', () => {
    test('removes a step and an action of another step in one undo step', () => {
        const s0 = initialState(job());
        const s1 = reducer(s0, { type: 'removeNodes', keys: ['step:a', 'action:b:1'] });
        expect(s1.job.steps.map((s) => s.id)).toEqual(['b', 'c']);
        expect(s1.job.steps[0].actions?.map((a) => (a as unknown as { to: string }).to)).toEqual(['p', 'r']);
        expect(s1.job.edges).toEqual([{ from: 'b', to: 'c', condition: 'on_success' }]);
        const nodes = s1.job.layout?.nodes || {};
        expect(nodes['step:a']).toBeUndefined();
        expect(nodes['cond:a>b']).toBeUndefined();
        expect(nodes['action:b:1']).toEqual({ x: 5, y: 5 });
        expect(nodes['action:b:2']).toBeUndefined();
        expect(s1.past).toHaveLength(1);
        expect(reducer(s1, { type: 'undo' }).job).toEqual(s0.job);
    });

    test('several actions of one list, triggers, a condition and the job key keep indexes right', () => {
        const s0 = initialState(job());
        const s1 = reducer(s0, {
            type: 'removeNodes',
            keys: ['job', 'action:b:0', 'action:b:2', 'trigger:0', 'trigger:2', 'cond:a>b', 'action:job:0'],
        });
        expect(s1.job.steps[1].actions?.map((a) => (a as unknown as { to: string }).to)).toEqual(['q']);
        expect(s1.job.triggers).toEqual([{ type: 'cron', cron: '0 * * * *' }]);
        expect(s1.job.actions).toEqual([]);
        expect(s1.job.edges).toEqual([{ from: 'b', to: 'c', condition: 'on_success' }]);
        const nodes = s1.job.layout?.nodes || {};
        expect(nodes['action:b:0']).toEqual({ x: 4, y: 4 });
        expect(nodes['trigger:0']).toBeUndefined();
        expect(nodes['cond:a>b']).toBeUndefined();
        expect(s1.past).toHaveLength(1);
    });

    test('a step and its own actions together, and nothing to remove changes nothing', () => {
        const s0 = initialState(job());
        const s1 = reducer(s0, { type: 'removeNodes', keys: ['step:b', 'action:b:0', 'action:b:1'] });
        expect(s1.job.steps.map((s) => s.id)).toEqual(['a', 'c']);
        expect(s1.job.edges).toEqual([]);
        expect(reducer(s0, { type: 'removeNodes', keys: ['job'] })).toBe(s0);
        expect(reducer(s0, { type: 'removeNodes', keys: [] })).toBe(s0);
    });
});

describe('tidyLayout with keys', () => {
    const plain = (): JobDefinition => {
        const j = job();
        delete j.layout;
        return j;
    };

    test('re-places only those nodes, keeping the top-left of the selection', () => {
        const before = plain();
        const shown = layoutFlow(buildGraph(before));
        const keys = ['step:a', 'step:b', 'step:c'];
        // Scatter the three steps, so tidying them has something to do.
        const s0 = reducer(initialState(before), {
            type: 'moveNodes',
            positions: { ...shown, 'step:a': { x: 500, y: 900 }, 'step:b': { x: 100, y: 300 }, 'step:c': { x: 900, y: 100 } },
        });
        const s1 = reducer(s0, { type: 'tidyLayout', keys });
        const after = s1.job.layout?.nodes || {};
        // Others keep their positions.
        Object.keys(shown)
            .filter((k) => !keys.includes(k))
            .forEach((k) => expect(after[k]).toEqual(s0.job.layout?.nodes?.[k]));
        // Left to right in flow order, starting at the old top-left (100, 100).
        expect(Math.min(...keys.map((k) => after[k].x))).toBe(100);
        expect(Math.min(...keys.map((k) => after[k].y))).toBe(100);
        expect(after['step:a'].x).toBeLessThan(after['step:b'].x);
        expect(after['step:b'].x).toBeLessThan(after['step:c'].x);
        expect(reducer(s1, { type: 'undo' }).job).toEqual(s0.job);
    });

    test('without saved positions the others are saved where they are shown', () => {
        const before = plain();
        const shown = layoutFlow(buildGraph(before));
        const s1 = reducer(initialState(before), { type: 'tidyLayout', keys: ['step:a', 'step:b'] });
        expect(s1.job.layout?.nodes?.['step:c']).toEqual(shown['step:c']);
        expect(s1.job.layout?.nodes?.['trigger:0']).toEqual(shown['trigger:0']);
    });
});

describe('removals', () => {
    test('names every node, at most eight, and says undo brings them back', () => {
        const r = removals(job(), ['step:a', 'action:b:1', 'trigger:0', 'cond:a>b', 'job']);
        expect(r?.title).toBe('Remove 4 nodes?');
        expect(r?.button).toBe('Remove nodes');
        expect(r?.names).toEqual(['Load', 'Email (q)', 'Schedule (Custom schedule: * * * * *)', 'The condition from Load to Filter']);
        expect(r?.more).toBe(0);
        expect(r?.note).toBe('Undo brings them back.');
        expect(r?.action).toEqual({ type: 'removeNodes', keys: ['step:a', 'action:b:1', 'trigger:0', 'cond:a>b'] });
    });

    test('past eight names it says how many more', () => {
        const keys = ['step:a', 'step:b', 'step:c', 'action:a:0', 'action:b:0', 'action:b:1', 'action:b:2', 'action:job:0', 'trigger:0', 'trigger:1', 'trigger:2'];
        const r = removals(job(), keys);
        expect(r?.title).toBe('Remove 11 nodes?');
        expect(r?.names).toHaveLength(8);
        expect(r?.more).toBe(3);
    });
});
