import type { JobDefinition } from '../api/types';
import { buildGraph } from '../features/builder/nodeModel';
import {
    clampZoom, frameView, linkEnds, linkedPorts, linkPath, nodeAt, snap, visiblePorts,
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

    it('shows Started, Delayed and If… only when expanded or linked', () => {
        expect(visiblePorts('search', false, new Set())).toEqual(['success', 'failure', 'always']);
        expect(visiblePorts('search', true, new Set())).toEqual(['success', 'failure', 'always', 'start', 'delayed', 'if']);
        expect(visiblePorts('search', false, new Set(['delayed']))).toEqual(['success', 'failure', 'always', 'delayed']);
        expect(visiblePorts('job', true, new Set())).not.toContain('if');
        expect(visiblePorts('email', true, new Set())).toEqual([]);
        expect(linkedPorts(graph)['step:a']).toEqual(new Set(['success', 'start']));
    });

    it('draws a horizontal bezier', () => {
        expect(linkPath({ x: 0, y: 0 }, { x: 200, y: 50 })).toBe('M0,0 C100,0 100,50 200,50');
        expect(linkPath({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe('M0,0 C40,0 -30,0 10,0');
    });

    it('starts a trigger line at the right middle of the trigger', () => {
        const l = graph.links.find((x) => x.kind === 'trigger')!;
        const by = new Map(graph.nodes.map((n) => [n.key, n]));
        const ends = linkEnds(l, by.get(l.from)!, by.get(l.to)!, pos, () => []);
        expect(ends).toEqual({ a: { x: 180, y: 22 }, b: { x: 300, y: 38 } });
        expect(linkEnds(l, by.get(l.from)!, by.get(l.to)!, {}, () => [])).toBeNull();
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
