import type { JobDefinition } from '../api/types';
import { freeSpotRightOf, graphBounds, layoutFlow } from '../features/builder/flowLayout';
import { buildGraph } from '../features/builder/nodeModel';

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
};
const g = buildGraph(job);

describe('layoutFlow', () => {
    it('places every node left to right', () => {
        const p = layoutFlow(g);
        g.nodes.forEach((n) => expect(p[n.key]).toBeDefined());
        expect(p['trigger:0'].x).toBeLessThan(p['step:a'].x);
        expect(p['step:a'].x).toBeLessThan(p['step:b'].x);
        expect(p['action:a:0'].x).toBeGreaterThan(p['step:a'].x);
    });
    it('keeps a saved position exactly', () => {
        expect(layoutFlow(g, { 'step:a': { x: 500, y: 500 } })['step:a']).toEqual({ x: 500, y: 500 });
    });
    it('places an unsaved node 260 px right of its saved source without overlap', () => {
        const p = layoutFlow(g, { 'step:a': { x: 500, y: 500 } });
        expect(p['step:b'].x).toBe(760);
        expect(p['step:b'].y).toBe(500);
        // the condition node is c's first incoming source; it must clear b
        expect(p['cond:a>c'].x).toBe(760);
        expect(p['cond:a>c'].y).toBeGreaterThanOrEqual(500 + 76 + 20);
        expect((p['cond:a>c'].y - 500) % 80).toBe(0);
        expect(p['step:c'].x).toBe(1020);
    });
    it('ignores unknown keys and garbage values', () => {
        const auto = layoutFlow(g);
        const p = layoutFlow(g, {
            nope: { x: 1, y: 1 },
            'step:a': { x: NaN, y: 1 },
            'step:b': { x: '1', y: 2 },
            'step:c': { x: 1 },
            'trigger:0': null,
        });
        expect(p).toEqual(auto);
        expect(() => layoutFlow(g, { job: 5, 'step:a': [] })).not.toThrow();
    });
    it('computes bounds', () => {
        expect(graphBounds({ nodes: [], links: [] }, {})).toEqual({ x: 0, y: 0, width: 0, height: 0 });
        const p = layoutFlow(g);
        const b = graphBounds(g, p);
        g.nodes.forEach((n) => {
            expect(p[n.key].x).toBeGreaterThanOrEqual(b.x);
            expect(p[n.key].y).toBeGreaterThanOrEqual(b.y);
        });
        expect(b.width).toBeGreaterThan(0);
    });
});

describe('freeSpotRightOf', () => {
    it('steps down past overlapping boxes', () => {
        const pos = { 'step:a': { x: 0, y: 0 }, 'step:b': { x: 260, y: 0 }, 'step:c': { x: 260, y: 80 } };
        const p = freeSpotRightOf(g, pos, 'step:a', 'search');
        expect(p.x).toBe(260);
        expect(p.y).toBeGreaterThanOrEqual(160);
        expect(freeSpotRightOf(g, { 'step:a': { x: 0, y: 0 } }, 'step:a', 'search')).toEqual({ x: 260, y: 0 });
    });
});
