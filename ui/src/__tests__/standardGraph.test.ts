import type { JobDefinition } from '../api/types';
import { standardGraph, standardLineLabels } from '../features/builder/standardGraph';
import { STEP_KINDS } from '../features/builder/nodeModel';

const job = (over: Partial<JobDefinition> = {}): JobDefinition =>
    ({
        name: 'J',
        enabled: true,
        triggers: [
            { type: 'cron', cron: '0 6 * * *', enabled: true },
            { type: 'completion', job: 'other', on: 'success', enabled: true },
        ],
        steps: [
            { id: 'a', name: 'A', type: 'inline', spl: 'index=x', actions: [{ hook: 'on_failure', type: 'email', to: 'x@example.com' }] },
            { id: 'b', name: 'B', type: 'inline', spl: 'index=y' },
            { id: 'c', name: 'C', type: 'approval', approval: {} },
        ],
        edges: [
            { from: 'a', to: 'b' },
            { from: 'b', to: 'c', condition: 'on_failure' },
        ],
        actions: [{ hook: 'on_failure', type: 'email', to: 'y@example.com' }],
        ...over,
    }) as JobDefinition;

describe('standardGraph', () => {
    test('standardGraph keeps only steps', () => {
        const g = standardGraph(job());
        expect(g.nodes).toHaveLength(3);
        g.nodes.forEach((n) => expect(STEP_KINDS).toContain(n.kind));
        g.links.forEach((l) => expect(l.kind).toBe('edge'));
        expect(g.links).toHaveLength(2);
    });

    test('standardGraph draws an expression edge as one if-line', () => {
        const j = job({
            steps: [
                { id: 'a', name: 'A', type: 'inline', spl: 'index=x' },
                { id: 'b', name: 'B', type: 'inline', spl: 'index=y' },
            ],
            edges: [{ from: 'a', to: 'b', condition: 'expression', expression: '$a.resultCount$ > 0' }],
        } as Partial<JobDefinition>);
        expect(standardGraph(j).links).toEqual([{ key: 'step:a-if->step:b', from: 'step:a', to: 'step:b', port: 'if', kind: 'edge', data: false }]);
        expect(standardLineLabels(j)['step:a-if->step:b']).toMatch(/^◇ /);
        expect(standardLineLabels(j)['step:a-if->step:b']).toContain('resultCount');
    });

    test('failure and always lines keep their ports', () => {
        const j = job({ edges: [{ from: 'a', to: 'b', condition: 'on_failure' }, { from: 'b', to: 'c', condition: 'always' }] } as Partial<JobDefinition>);
        expect(standardGraph(j).links.map((l) => l.port)).toEqual(['failure', 'always']);
    });

    test('markers show trigger, actions and delay alert', () => {
        const j = job({
            steps: [
                { id: 'a', name: 'A', type: 'inline', spl: 'index=x', delayed_after: 600, actions: [
                    { hook: 'on_failure', type: 'email', to: 'x@example.com' },
                    { hook: 'on_success', type: 'email', to: 'y@example.com' },
                ] },
                { id: 'b', name: 'B', type: 'inline', spl: 'index=y' },
            ],
            edges: [{ from: 'a', to: 'b' }],
        } as Partial<JobDefinition>);
        const nodes = standardGraph(j).nodes;
        const a = nodes.find((n) => n.key === 'step:a')!;
        const b = nodes.find((n) => n.key === 'step:b')!;
        expect(a.detail).toContain('⚡');
        expect(a.detail).toContain('✉ 2');
        expect(a.detail).toContain('⌛');
        expect(b.detail).not.toContain('⚡');
        expect(b.detail).not.toContain('✉');
    });
});
