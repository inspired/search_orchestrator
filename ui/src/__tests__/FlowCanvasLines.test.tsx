import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import type { JobDefinition } from '../api/types';
import FlowCanvas, { FlowCanvasProps } from '../features/builder/FlowCanvas';
import { buildGraph } from '../features/builder/nodeModel';
import type { Positions } from '../features/builder/graphLogic';
import { bezierAt, linkEnds } from '../features/builder/flowCanvasGeometry';
import { nodeSize } from '../features/builder/nodeStyle';
import { usedOutcomes } from '../features/builder/outcomes';
import { renderThemed } from './fixtures';

const job: JobDefinition = {
    name: 'nightly',
    enabled: true,
    triggers: [{ type: 'cron', cron: '0 2 * * *' }],
    steps: [
        { id: 'a', type: 'inline', spl: 'search x', actions: [{ hook: 'on_failure', type: 'email', to: 'x@y' }] },
        { id: 'b', type: 'inline', spl: 'search y' },
        { id: 'n', type: 'inline', spl: 'search n' },
    ],
    edges: [{ from: 'a', to: 'b', condition: 'on_success' }],
};
const graph = buildGraph(job);
const AB = 'step:a-success->step:b';
const AF = 'step:a-failure->action:a:0';

// jsdom has no layout: the svg sits at 0,0 with zoom 1, so client and canvas coordinates match.
const positions: Positions = {
    'trigger:0': { x: 0, y: 100 },
    job: { x: 0, y: 500 },
    'step:a': { x: 250, y: 100 },
    'step:b': { x: 650, y: 100 },
    'step:n': { x: 250, y: 320 },
    'action:a:0': { x: 650, y: 320 },
};

const centreOf = (key: string) => {
    const n = graph.nodes.find((x) => x.key === key)!;
    const { w, h } = nodeSize(n.kind);
    return { clientX: positions[key].x + w / 2, clientY: positions[key].y + h / 2 };
};
const midOf = (key: string) => {
    const l = graph.links.find((x) => x.key === key)!;
    const from = graph.nodes.find((n) => n.key === l.from)!;
    const to = graph.nodes.find((n) => n.key === l.to)!;
    const ends = linkEnds(l, from, to, positions, usedOutcomes(graph, l.from))!;
    return bezierAt(ends.a, ends.b, 0.5);
};

function setup(over: Partial<FlowCanvasProps> = {}) {
    const props: FlowCanvasProps = {
        graph,
        positions,
        selected: null,
        issues: [],
        onSelect: jest.fn(),
        onMove: jest.fn(),
        onLineMenu: jest.fn(),
        onSplice: jest.fn(),
        canSpliceNode: jest.fn(() => true),
        ...over,
    };
    renderThemed(<FlowCanvas {...props} />);
    const canvas = screen.getByRole('group', { name: /^Job flow/ });
    return { props, canvas };
}

/** Drag node `key` so its centre lands on `to`. */
function dragCentreTo(canvas: Element, key: string, to: { x: number; y: number }) {
    const c = centreOf(key);
    fireEvent.pointerDown(screen.getByTestId(`node-${key}`), c);
    fireEvent.pointerMove(canvas, { clientX: c.clientX + 10, clientY: c.clientY });
    fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y });
    return { clientX: to.x, clientY: to.y };
}

describe('FlowCanvas line labels', () => {
    test('each line but trigger lines carries its outcome label at zoom 1', () => {
        setup();
        expect(screen.getByTestId(`line-label-${AB}`)).toHaveTextContent('✓ Succeeds');
        expect(screen.getByTestId(`line-label-${AF}`)).toHaveTextContent('✗ Fails');
        expect(screen.queryByTestId('line-label-trigger:0->step:a')).toBeNull();
    });

    test('the label sits at the line midpoint', () => {
        setup();
        const m = midOf(AB);
        const text = within(screen.getByTestId(`line-label-${AB}`)).getByText('✓ Succeeds');
        expect(Number(text.getAttribute('x'))).toBeCloseTo(m.x, 0);
    });

    test('labels hide below 70 % zoom except on the selected line', () => {
        setup({ selected: { kind: 'link', key: AB } });
        fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
        expect(screen.getByTestId(`line-label-${AF}`)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
        expect(screen.queryByTestId(`line-label-${AF}`)).toBeNull();
        expect(screen.getByTestId(`line-label-${AB}`)).toBeInTheDocument();
    });

    test('a condition shows its expression on the diamond-to-target line', () => {
        const cj: JobDefinition = { ...job, edges: [{ from: 'a', to: 'b', condition: 'expression', expression: '$a.resultCount$ > 0' }] };
        const cg = buildGraph(cj);
        renderThemed(
            <FlowCanvas
                graph={cg}
                positions={{ ...positions, 'cond:a>b': { x: 520, y: 110 } }}
                selected={null}
                issues={[]}
                onSelect={jest.fn()}
            />
        );
        expect(screen.getByTestId('line-label-cond:a>b-then->step:b')).toHaveTextContent('$a.resultCount$ > 0');
    });

    test('clicking a label selects the line and asks for its menu', () => {
        const { props } = setup();
        const label = screen.getByTestId(`line-label-${AB}`);
        fireEvent.pointerDown(label);
        fireEvent.click(label);
        expect(props.onSelect).toHaveBeenCalledWith({ kind: 'link', key: AB });
        expect(props.onLineMenu).toHaveBeenCalledWith(AB, expect.objectContaining({ left: expect.any(Number), top: expect.any(Number) }));
    });

    test('Enter on a focused line selects it and asks for its menu', () => {
        const { props } = setup();
        const line = document.querySelector(`[data-link-key="${AB}"]`) as SVGGElement;
        fireEvent.keyDown(line, { key: 'Enter' });
        expect(props.onSelect).toHaveBeenCalledWith({ kind: 'link', key: AB });
        expect(props.onLineMenu).toHaveBeenCalledWith(AB, expect.objectContaining({ left: expect.any(Number) }));
    });
});

describe('FlowCanvas splice by drag', () => {
    test('a node with no lines dropped on a line is spliced in, not moved', () => {
        const { props, canvas } = setup();
        const m = midOf(AB);
        const end = dragCentreTo(canvas, 'step:n', m);
        expect(props.canSpliceNode).toHaveBeenCalledWith('step:n', AB);
        const path = screen.getByTestId(`link-${AB}`).querySelector('path')!;
        expect(path.getAttribute('stroke-width')).toBe('3');
        fireEvent.pointerUp(canvas, end);
        expect(props.onSplice).toHaveBeenCalledWith('step:n', AB, { x: expect.any(Number), y: expect.any(Number) });
        expect(props.onMove).not.toHaveBeenCalled();
    });

    test('no highlight and a plain move when canSpliceNode says no', () => {
        const { props, canvas } = setup({ canSpliceNode: jest.fn(() => false) });
        const end = dragCentreTo(canvas, 'step:n', midOf(AB));
        expect(screen.getByTestId(`link-${AB}`).querySelector('path')!.getAttribute('stroke-width')).toBe('1.5');
        fireEvent.pointerUp(canvas, end);
        expect(props.onSplice).not.toHaveBeenCalled();
        expect(props.onMove).toHaveBeenCalled();
    });

    test('a node that has lines dropped on a line is only moved', () => {
        const { props, canvas } = setup();
        const end = dragCentreTo(canvas, 'action:a:0', midOf(AB));
        fireEvent.pointerUp(canvas, end);
        expect(props.onSplice).not.toHaveBeenCalled();
        expect(props.onMove).toHaveBeenCalled();
    });

    test('Escape during a splice drag cancels it', () => {
        const { props, canvas } = setup();
        const end = dragCentreTo(canvas, 'step:n', midOf(AB));
        fireEvent.keyDown(window, { key: 'Escape' });
        fireEvent.pointerUp(canvas, end);
        expect(props.onSplice).not.toHaveBeenCalled();
        expect(props.onMove).not.toHaveBeenCalled();
    });
});
