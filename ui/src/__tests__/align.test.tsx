import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { align, arrange, distribute, guidesFor } from '../features/builder/align';
import type { Box } from '../features/builder/align';
import FlowCanvas from '../features/builder/FlowCanvas';
import { buildGraph } from '../features/builder/nodeModel';
import type { Positions } from '../features/builder/graphLogic';
import type { JobDefinition } from '../api/types';
import { renderThemed } from './fixtures';

const box = (x: number, y: number, w = 100, h = 40): Box => ({ x, y, w, h });

describe('guidesFor', () => {
    test('snaps the left edge to another left edge within 6 px', () => {
        const r = guidesFor(box(203, 0), [box(200, 300)]);
        expect(r.dx).toBe(-3);
        expect(r.lines.some((l) => l.axis === 'x' && l.at === 200)).toBe(true);
    });

    test('matches centres and rights, and picks the nearest', () => {
        // left 207 vs 200, centre 257 vs 250 and right 307 vs 300 are each 7 away: out of reach
        expect(guidesFor(box(207, 0, 100), [box(200, 300, 100)]).dx).toBe(0);
        // right edge 398 vs 400
        expect(guidesFor(box(298, 0, 100), [box(310, 300, 90)]).dx).toBe(2);
    });

    test('snaps tops, middles and bottoms on y', () => {
        const r = guidesFor(box(0, 104, 100, 40), [box(500, 100, 100, 40)]);
        expect(r.dy).toBe(-4);
        expect(r.lines.some((l) => l.axis === 'y' && l.at === 100)).toBe(true);
    });

    test('ignores anything further than the tolerance', () => {
        const r = guidesFor(box(0, 0), [box(207, 207)]);
        expect(r).toEqual({ dx: 0, dy: 0, lines: [] });
        expect(guidesFor(box(0, 0), [box(7, 400)], 8).dx).toBe(7);
    });

    test('a guide line spans both boxes', () => {
        const r = guidesFor(box(203, 0, 100, 40), [box(200, 300, 100, 40)]);
        const line = r.lines.find((l) => l.axis === 'x');
        expect(line).toMatchObject({ at: 200, from: 0, to: 340 });
    });
});

describe('align', () => {
    const boxes = { a: box(10, 50, 100, 40), b: box(200, 10, 60, 20), c: box(120, 90, 80, 60) };

    test('left, centre and right on x', () => {
        expect(align(boxes, 'left')).toEqual({ a: { x: 10, y: 50 }, b: { x: 10, y: 10 }, c: { x: 10, y: 90 } });
        expect(align(boxes, 'right')).toEqual({ a: { x: 160, y: 50 }, b: { x: 200, y: 10 }, c: { x: 180, y: 90 } });
        // bounding box 10..260, centre 135
        expect(align(boxes, 'center')).toEqual({ a: { x: 85, y: 50 }, b: { x: 105, y: 10 }, c: { x: 95, y: 90 } });
    });

    test('top, middle and bottom on y', () => {
        expect(align(boxes, 'top')).toEqual({ a: { x: 10, y: 10 }, b: { x: 200, y: 10 }, c: { x: 120, y: 10 } });
        expect(align(boxes, 'bottom')).toEqual({ a: { x: 10, y: 110 }, b: { x: 200, y: 130 }, c: { x: 120, y: 90 } });
        // bounding box 10..150, middle 80
        expect(align(boxes, 'middle')).toEqual({ a: { x: 10, y: 60 }, b: { x: 200, y: 70 }, c: { x: 120, y: 50 } });
    });
});

describe('distribute', () => {
    test('equal gaps between the outer two, horizontally', () => {
        const r = distribute({ a: box(0, 0, 100), b: box(130, 20, 50), c: box(400, 40, 100) }, 'x');
        // span 0..500, widths 250, gaps (500-250)/2 = 125
        expect(r).toEqual({ a: { x: 0, y: 0 }, b: { x: 225, y: 20 }, c: { x: 400, y: 40 } });
    });

    test('vertically', () => {
        const r = distribute({ a: box(0, 0, 10, 20), b: box(5, 10, 10, 40), c: box(9, 200, 10, 20) }, 'y');
        // span 0..220, heights 80, gaps 70
        expect(r.b).toEqual({ x: 5, y: 90 });
    });

    test('needs three or more', () => {
        expect(distribute({ a: box(0, 0), b: box(300, 0) }, 'x')).toEqual({});
    });
});

describe('arrange', () => {
    const job: JobDefinition = { name: 'j', enabled: true, triggers: [], steps: [{ id: 'a', type: 'inline', spl: 'search x' }, { id: 'b', type: 'inline', spl: 'search y' }], edges: [] };
    const graph = buildGraph(job);
    test('returns only the nodes that move', () => {
        const positions: Positions = { 'step:a': { x: 100, y: 10 }, 'step:b': { x: 100, y: 200 } } as Positions;
        expect(arrange(graph, positions, ['step:a', 'step:b'], 'left')).toEqual({});
        expect(arrange(graph, positions, ['step:a', 'step:b'], 'top')).toEqual({ 'step:b': { x: 100, y: 10 } });
    });
});

describe('guides while dragging', () => {
    const job: JobDefinition = { name: 'j', enabled: true, triggers: [], steps: [{ id: 'a', type: 'inline', spl: 'search x' }, { id: 'b', type: 'inline', spl: 'search y' }], edges: [] };
    const graph = buildGraph(job);
    const positions = { 'step:a': { x: 250, y: 100 }, 'step:b': { x: 557, y: 400 } } as Positions;

    test('a drag within 6 px of another left edge snaps to it and shows a guide', () => {
        const onMove = jest.fn();
        renderThemed(<FlowCanvas graph={graph} positions={positions} selected={null} issues={[]} onSelect={jest.fn()} onMove={onMove} />);
        const canvas = screen.getByRole('group', { name: /^Job flow/ });
        fireEvent.pointerDown(screen.getByTestId('node-step:a'), { clientX: 300, clientY: 130 });
        fireEvent.pointerMove(canvas, { clientX: 604, clientY: 150 });
        expect(screen.getAllByTestId('guide-x').length).toBeGreaterThan(0);
        expect(screen.getByTestId('node-step:a')).toHaveAttribute('transform', 'translate(557,120)');
        fireEvent.pointerUp(canvas, { clientX: 604, clientY: 150 });
        expect(onMove).toHaveBeenCalledWith({ 'step:a': { x: 557, y: 120 } });
        expect(screen.queryAllByTestId('guide-x')).toHaveLength(0);
    });

    test('the grid is off until shown, and the choice is remembered', () => {
        window.localStorage.removeItem('so.flow.grid');
        const { unmount } = renderThemed(<FlowCanvas graph={graph} positions={positions} selected={null} issues={[]} onSelect={jest.fn()} />);
        expect(screen.queryByTestId('flow-grid')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Show grid' }));
        expect(screen.getByTestId('flow-grid')).toBeInTheDocument();
        expect(window.localStorage.getItem('so.flow.grid')).toBe('1');
        unmount();
        renderThemed(<FlowCanvas graph={graph} positions={positions} selected={null} issues={[]} onSelect={jest.fn()} />);
        expect(screen.getByTestId('flow-grid')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Hide grid' })).toBeInTheDocument();
        window.localStorage.removeItem('so.flow.grid');
    });
});
