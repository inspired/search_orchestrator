import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import type { JobDefinition } from '../api/types';
import FlowCanvas from '../features/builder/FlowCanvas';
import { buildGraph } from '../features/builder/nodeModel';
import { autoPanStep, EDGE, MAX_STEP } from '../features/builder/autoPan';
import { renderThemed } from './fixtures';

const view = { w: 800, h: 480 };

describe('autoPanStep', () => {
    test('the centre does not pan', () => {
        expect(autoPanStep({ x: 400, y: 240 }, view)).toEqual({ x: 0, y: 0 });
        expect(autoPanStep({ x: EDGE + 1, y: view.h - EDGE - 1 }, view)).toEqual({ x: 0, y: 0 });
    });

    test('near the left edge pans left, faster the closer', () => {
        const far = autoPanStep({ x: 30, y: 240 }, view);
        const near = autoPanStep({ x: 5, y: 240 }, view);
        expect(far.x).toBeLessThan(0);
        expect(far.y).toBe(0);
        expect(near.x).toBeLessThan(far.x);
        expect(autoPanStep({ x: 0, y: 240 }, view).x).toBe(-MAX_STEP);
    });

    test('pans toward each edge and corners on both axes, never past the cap', () => {
        expect(autoPanStep({ x: 795, y: 240 }, view).x).toBeGreaterThan(0);
        expect(autoPanStep({ x: 400, y: 2 }, view).y).toBeLessThan(0);
        expect(autoPanStep({ x: 400, y: 478 }, view).y).toBeGreaterThan(0);
        const corner = autoPanStep({ x: -50, y: 600 }, view);
        expect(corner).toEqual({ x: -MAX_STEP, y: MAX_STEP });
    });

    test('an empty view does not pan', () => {
        expect(autoPanStep({ x: 0, y: 0 }, { w: 0, h: 0 })).toEqual({ x: 0, y: 0 });
    });
});

describe('auto-pan while dragging', () => {
    const job: JobDefinition = { name: 'n', enabled: true, steps: [{ id: 'a', type: 'inline', spl: 'x' }], edges: [] };
    const graph = buildGraph(job);
    const positions = { job: { x: 0, y: 300 }, 'step:a': { x: 300, y: 100 } };
    let frames: FrameRequestCallback[] = [];

    beforeEach(() => {
        frames = [];
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            frames.push(cb);
            return frames.length;
        });
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    const runFrames = (n: number) => {
        for (let i = 0; i < n; i += 1) {
            const next = frames;
            frames = [];
            act(() => next.forEach((cb) => cb(i * 16)));
        }
    };

    test('a node dragged to the left edge pans the view and stays under the pointer', () => {
        const onMove = jest.fn();
        renderThemed(<FlowCanvas graph={graph} positions={positions} selected={null} issues={[]} onSelect={jest.fn()} onMove={onMove} />);
        const canvas = screen.getByRole('group', { name: /^Job flow/ });
        jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            left: 0, top: 0, right: 800, bottom: 480, width: 800, height: 480, x: 0, y: 0, toJSON: () => ({}),
        } as DOMRect);
        const viewG = () => canvas.querySelector('g[data-view]') as SVGGElement;
        fireEvent.pointerDown(screen.getByTestId('node-step:a'), { clientX: 400, clientY: 130 });
        fireEvent.pointerMove(canvas, { clientX: 300, clientY: 130 });
        fireEvent.pointerMove(canvas, { clientX: 0, clientY: 130 });
        expect(viewG().getAttribute('transform')).toBe('translate(0,0) scale(1)');
        runFrames(3);
        // Three frames at the edge: the view moved right by 3 × 16 px to show more on the left.
        expect(viewG().getAttribute('transform')).toBe(`translate(${3 * MAX_STEP},0) scale(1)`);
        // The node stays under the pointer: on screen it is still 400 px left of where it started.
        const shownX = Number(/translate\(([-\d.]+),/.exec(screen.getByTestId('node-step:a').getAttribute('transform')!)![1]);
        expect(shownX + 3 * MAX_STEP).toBe(300 - 400);
        fireEvent.pointerUp(canvas, { clientX: 0, clientY: 130 });
        // -148 snapped to the 10 px grid.
        expect(onMove).toHaveBeenCalledWith({ 'step:a': { x: -150, y: 100 } });
        // No more panning after the drop.
        runFrames(2);
        expect(viewG().getAttribute('transform')).toBe(`translate(${3 * MAX_STEP},0) scale(1)`);
    });
});
