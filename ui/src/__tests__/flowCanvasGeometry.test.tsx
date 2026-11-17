import type { JobDefinition } from '../api/types';
import { handleOffset, tabExit } from '../features/builder/nodeStyle';
import { buildGraph } from '../features/builder/nodeModel';
import { usedOutcomes } from '../features/builder/outcomes';
import {
    bezierAt, clampZoom, frameView, linkAt, linkEnds, linkPath, nodeAt, snap,
} from '../features/builder/flowCanvasGeometry';

const job: JobDefinition = {
    name: 'n',
    enabled: true,
    triggers: [{ type: 'cron', cron: '0 2 * * *' }],
    steps: [
        { id: 'a', type: 'inline', spl: 'x', actions: [{ hook: 'on_start', type: 'email', to: 'z' }] },
        { id: 'b', type: 'inline', spl: 'y' },
    ],
    edges: [{ from: 'a', to: 'b' }],
};
const graph = buildGraph(job);
const pos = { 'trigger:0': { x: 0, y: 0 }, job: { x: 0, y: 200 }, 'step:a': { x: 300, y: 0 }, 'step:b': { x: 600, y: 0 }, 'action:a:0': { x: 600, y: 200 } };

describe('flowCanvasGeometry', () => {
    it('snaps and clamps', () => {
        expect(snap(104)).toBe(100);
        expect(snap(105)).toBe(110);
        expect(clampZoom(5)).toBe(2);
        expect(clampZoom(0.1)).toBe(0.4);
    });

    it('draws a horizontal bezier', () => {
        expect(linkPath({ x: 0, y: 0 }, { x: 200, y: 50 })).toBe('M0,0 C100,0 100,50 200,50');
        expect(linkPath({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe('M0,0 C40,0 -30,0 10,0');
    });

    it('starts a trigger line at the right middle of the trigger', () => {
        const l = graph.links.find((x) => x.kind === 'trigger')!;
        const by = new Map(graph.nodes.map((n) => [n.key, n]));
        const ends = linkEnds(l, by.get(l.from)!, by.get(l.to)!, pos);
        expect(ends).toEqual({ a: { x: 180, y: 22 }, b: { x: 300, y: 38 } });
        expect(linkEnds(l, by.get(l.from)!, by.get(l.to)!, {})).toBeNull();
    });

    it('finds the node under a point', () => {
        expect(nodeAt(graph, pos, { x: 310, y: 10 })).toBe('step:a');
        expect(nodeAt(graph, pos, { x: 550, y: 10 })).toBeNull();
    });

    it('frames the whole graph', () => {
        expect(frameView(graph, pos, 0, 0)).toBeNull();
        expect(frameView(graph, {}, 800, 600)).toBeNull();
        const v = frameView(graph, pos, 480, 300)!;
        // bounds 800 × 268 at (0, 0): fits at min(400/800, 220/268) = 0.5.
        expect(v.zoom).toBeCloseTo(0.5);
        expect(v.pan.x).toBeCloseTo(240 - 400 * 0.5);
        expect(v.pan.y).toBeCloseTo(150 - 134 * 0.5);
    });
});

describe('linkEnds from tabs', () => {
    it('starts at the tab of its outcome and ends at the input', () => {
        const g = buildGraph(job);
        const l = g.links.find((k) => k.port === 'success')!;
        const from = g.nodes.find((n) => n.key === l.from)!;
        const to = g.nodes.find((n) => n.key === l.to)!;
        const pos = { [from.key]: { x: 10, y: 20 }, [to.key]: { x: 300, y: 40 } };
        const e = linkEnds(l, from, to, pos, ['start', 'success'])!;
        const t = tabExit(from.kind, 1, 2);
        expect(e.a).toEqual({ x: 10 + t.x, y: 20 + t.y });
        expect(e.b).toEqual({ x: 300, y: 40 + 38 });
        expect(t.x).toBe(handleOffset(from.kind).x + 2 + 18);
        expect(linkEnds(l, from, to, {}, ['success'])).toBeNull();
    });
    it('falls back to the + when the outcome has no tab', () => {
        const g = buildGraph(job);
        const l = g.links.find((k) => k.port === 'success')!;
        const from = g.nodes.find((n) => n.key === l.from)!;
        const to = g.nodes.find((n) => n.key === l.to)!;
        const pos = { [from.key]: { x: 10, y: 20 }, [to.key]: { x: 300, y: 40 } };
        const h = handleOffset(from.kind);
        expect(linkEnds(l, from, to, pos)!.a).toEqual({ x: 10 + h.x, y: 20 + h.y });
    });
    it('starts a condition line at the right tip of the diamond', () => {
        const g = buildGraph({ ...job, edges: [{ from: 'a', to: 'b', condition: 'expression', expression: 'x' }] });
        const l = g.links.find((k) => k.port === 'then')!;
        const from = g.nodes.find((n) => n.key === l.from)!;
        const to = g.nodes.find((n) => n.key === l.to)!;
        const pos = { [from.key]: { x: 100, y: 100 }, [to.key]: { x: 300, y: 40 } };
        expect(linkEnds(l, from, to, pos, ['then'])!.a).toEqual({ x: 164, y: 132 });
    });
});

describe('linkAt and bezierAt', () => {
    const ab = graph.links.find((l) => l.from === 'step:a' && l.to === 'step:b')!;
    const mid = () => {
        const from = graph.nodes.find((n) => n.key === 'step:a')!;
        const to = graph.nodes.find((n) => n.key === 'step:b')!;
        const ends = linkEnds(ab, from, to, pos, usedOutcomes(graph, 'step:a'))!;
        return bezierAt(ends.a, ends.b, 0.5);
    };

    test('bezierAt runs from one end to the other along the drawn curve', () => {
        const a = { x: 0, y: 0 };
        const b = { x: 200, y: 100 };
        expect(bezierAt(a, b, 0)).toEqual(a);
        expect(bezierAt(a, b, 1)).toEqual(b);
        expect(bezierAt(a, b, 0.5)).toEqual({ x: 100, y: 50 });
    });

    test('finds the line under a point, within the tolerance', () => {
        const m = mid();
        expect(linkAt(graph, pos, m)).toBe(ab.key);
        expect(linkAt(graph, pos, { x: m.x, y: m.y - 6 })).toBe(ab.key);
        expect(linkAt(graph, pos, { x: m.x, y: m.y - 20 })).toBeNull();
        expect(linkAt(graph, pos, { x: m.x, y: m.y - 20 }, 25)).toBe(ab.key);
    });

    test('ignores trigger lines', () => {
        const t = graph.links.find((l) => l.kind === 'trigger')!;
        const from = graph.nodes.find((n) => n.key === t.from)!;
        const to = graph.nodes.find((n) => n.key === t.to)!;
        const ends = linkEnds(t, from, to, pos)!;
        expect(linkAt(graph, pos, bezierAt(ends.a, ends.b, 0.5))).toBeNull();
    });
});

describe('compact geometry', () => {
    const job2: JobDefinition = {
        name: 'j', enabled: true, triggers: [],
        steps: [{ id: 'a', type: 'inline', spl: 'x' }, { id: 'b', type: 'inline', spl: 'y' }],
        edges: [{ from: 'a', to: 'b', condition: 'on_success' }],
    };
    const g2 = buildGraph(job2);
    const pos2 = { 'step:a': { x: 0, y: 0 }, 'step:b': { x: 300, y: 0 } };
    it('hit-tests the compact box', () => {
        expect(nodeAt(g2, pos2, { x: 170, y: 10 })).toBe('step:a');
        expect(nodeAt(g2, pos2, { x: 170, y: 10 }, true)).toBeNull();
        expect(nodeAt(g2, pos2, { x: 100, y: 20 }, true)).toBe('step:a');
        expect(nodeAt(g2, pos2, { x: 100, y: 40 }, true)).toBeNull();
    });
    it('draws lines from the compact edge', () => {
        const l = g2.links.find((x) => x.from === 'step:a')!;
        const by = new Map(g2.nodes.map((n) => [n.key, n] as const));
        const full = linkEnds(l, by.get(l.from)!, by.get(l.to)!, pos2, ['success'])!;
        const compact = linkEnds(l, by.get(l.from)!, by.get(l.to)!, pos2, ['success'], true)!;
        expect(compact.a.x).toBe(140 + 20);
        expect(full.a.x).toBe(200 + 20);
        expect(compact.b).toEqual({ x: 300, y: 16 });
    });
});
