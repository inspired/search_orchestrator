import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import type { JobDefinition } from '../api/types';
import FlowCanvas, { FlowCanvasProps } from '../features/builder/FlowCanvas';
import { buildGraph } from '../features/builder/nodeModel';
import type { Positions } from '../features/builder/graphLogic';
import { mockReducedMotion, renderThemed, toggleView } from './fixtures';

const job: JobDefinition = {
    name: 'nightly',
    enabled: true,
    triggers: [],
    steps: [
        { id: 'a', type: 'inline', spl: 'search x' },
        { id: 'b', type: 'inline', spl: 'search y' },
        { id: 'c', type: 'inline', spl: 'search z' },
    ],
    edges: [
        { from: 'a', to: 'b', condition: 'on_success' },
        { from: 'a', to: 'c', condition: 'on_failure' },
    ],
};
const graph = buildGraph(job);
const AB = 'step:a-success->step:b';
const AC = 'step:a-failure->step:c';
const positions: Positions = {
    job: { x: 0, y: 400 },
    'step:a': { x: 50, y: 50 },
    'step:b': { x: 900, y: 50 },
    'step:c': { x: 400, y: 250 },
};

function setup(over: Partial<FlowCanvasProps> = {}) {
    const props: FlowCanvasProps = { graph, positions, selected: null, issues: [], onSelect: jest.fn(), readOnly: true, ...over };
    renderThemed(<FlowCanvas {...props} />);
    const canvas = screen.getByRole('group', { name: /^Job flow/ });
    const view = () => canvas.querySelector('g[data-view]') as SVGGElement;
    const line = (key: string) => screen.getByTestId(`link-${key}`).querySelector('path') as SVGPathElement;
    return { props, canvas, view, line };
}

const original = {
    w: Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!,
    h: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!,
};
const size = (w: number, h: number) => {
    Object.defineProperty(Element.prototype, 'clientWidth', { value: w, configurable: true });
    Object.defineProperty(Element.prototype, 'clientHeight', { value: h, configurable: true });
};

afterEach(() => {
    Object.defineProperty(Element.prototype, 'clientWidth', original.w);
    Object.defineProperty(Element.prototype, 'clientHeight', original.h);
    delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('FlowCanvas live run', () => {
    test('lines are drawn by their run state', () => {
        const { line } = setup({ lineStates: { [AB]: 'flowing', [AC]: 'wont' } });
        expect(line(AB)).toHaveAttribute('stroke-width', '3');
        expect(line(AB)).toHaveClass('so-flow');
        expect(line(AB).getAttribute('stroke-dasharray')).toBeTruthy();
        expect(line(AC)).toHaveAttribute('stroke-width', '1.5');
        expect(line(AC)).toHaveAttribute('stroke-dasharray', '4 4');
        // Opacity (not stroke-opacity), so the arrowhead fades with the line.
        expect(line(AC)).toHaveAttribute('opacity', '0.35');
        expect(line(AC)).not.toHaveAttribute('stroke-opacity');
        expect(line(AC)).not.toHaveClass('so-flow');
    });

    test('a fired data line keeps its 3 px', () => {
        const dataJob: JobDefinition = { ...job, steps: [job.steps![0], { id: 'b', type: 'previous', spl: '| stats count' }, job.steps![2]] };
        const { line } = setup({ graph: buildGraph(dataJob), lineStates: { [AB]: 'fired', [AC]: 'fired' } });
        expect(line(AB)).toHaveAttribute('stroke-width', '3');
        expect(line(AC)).toHaveAttribute('stroke-width', '2');
    });

    test('a fired line is solid at 2 px; a pending one is drawn as in the builder', () => {
        const { line } = setup({ lineStates: { [AB]: 'fired', [AC]: 'pending' } });
        expect(line(AB)).toHaveAttribute('stroke-width', '2');
        expect(line(AB)).not.toHaveAttribute('stroke-dasharray');
        expect(line(AC)).toHaveAttribute('stroke-width', '1.5');
        expect(line(AC)).not.toHaveAttribute('opacity');
    });

    test('row labels show only while flowing, or with Show line labels on', () => {
        window.localStorage.removeItem('so.flow.lineLabels');
        setup({ lineLabels: { [AB]: '1,204 rows →' }, lineStates: { [AB]: 'fired', [AC]: 'fired' } });
        expect(screen.queryAllByTestId(/^line-label-/)).toHaveLength(0);
        toggleView('Line labels');
        expect(screen.getByTestId(`line-label-${AB}`)).toHaveTextContent('1,204 rows →');
        expect(screen.getByTestId(`line-label-${AC}`)).toHaveTextContent('Fails');
        window.localStorage.removeItem('so.flow.lineLabels');
    });

    test('a flowing data line keeps its row label with the toggle off', () => {
        window.localStorage.removeItem('so.flow.lineLabels');
        setup({ lineLabels: { [AB]: '1,204 rows →' }, lineStates: { [AB]: 'flowing', [AC]: 'fired' } });
        expect(screen.getByTestId(`line-label-${AB}`)).toHaveTextContent('1,204 rows →');
        expect(screen.queryByTestId(`line-label-${AC}`)).toBeNull();
    });

    test('a running node has a pulsing outline, a spinner and its timer', () => {
        setup({ running: ['step:a'], status: { 'step:a': { text: 'Running', timer: '0:31' } } });
        expect(screen.getByTestId('running-outline-step:a')).toHaveClass('so-pulse');
        expect(screen.getByTestId('spinner-step:a')).toHaveClass('so-spin');
        expect(screen.getByTestId('timer-step:a')).toHaveTextContent('0:31');
        expect(screen.queryByTestId('spinner-step:b')).toBeNull();
    });

    test('a dimmed node is drawn at 0.6 opacity', () => {
        setup({ status: { 'step:b': { text: 'Waiting for a', dim: true } } });
        expect(screen.getByTestId('node-step:b')).toHaveAttribute('opacity', '0.6');
        expect(screen.getByTestId('node-step:b')).toHaveTextContent('Waiting for a');
    });

    test('with reduced motion there is no pulse, spinner or flowing dashes; colours and timers stay', () => {
        mockReducedMotion(true);
        const { line, canvas } = setup({ lineStates: { [AB]: 'flowing' }, running: ['step:a'], status: { 'step:a': { text: 'Running', timer: '0:31' } } });
        expect(line(AB)).not.toHaveClass('so-flow');
        expect(line(AB)).toHaveAttribute('stroke-width', '3');
        expect(screen.queryByTestId('spinner-step:a')).toBeNull();
        expect(screen.getByTestId('running-outline-step:a')).not.toHaveClass('so-pulse');
        expect(screen.getByTestId('timer-step:a')).toHaveTextContent('0:31');
        expect(canvas.querySelectorAll('.so-flow, .so-spin, .so-pulse')).toHaveLength(0);
        // The stylesheet also turns the animations off for the media query.
        expect(canvas.querySelector('style')!.textContent).toMatch(/prefers-reduced-motion: reduce/);
    });

    test('follow pans the running nodes into view; a user pan reports onUserView', () => {
        size(400, 300);
        const onUserView = jest.fn();
        const { view, canvas } = setup({ running: ['step:b'], follow: true, onUserView });
        // b is at x 900..1100: the least pan that brings it 20 px inside the right edge.
        expect(view().getAttribute('transform')).toBe('translate(-720,0) scale(1)');
        fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
        fireEvent.pointerMove(canvas, { clientX: 40, clientY: 10 });
        fireEvent.pointerUp(canvas, { clientX: 40, clientY: 10 });
        expect(onUserView).toHaveBeenCalled();
    });

    test('the wheel and the zoom buttons count as the user choosing the view', () => {
        const onUserView = jest.fn();
        const { canvas } = setup({ running: ['step:a'], follow: true, onUserView });
        fireEvent.wheel(canvas, { deltaY: -100 });
        expect(onUserView).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Frame all' }));
        expect(onUserView).toHaveBeenCalledTimes(2);
    });

    test('"Follow the run" shows only while follow is off and the caller handles it', () => {
        const onFollow = jest.fn();
        setup({ follow: false, onFollow });
        fireEvent.click(screen.getByRole('button', { name: 'Follow the run' }));
        expect(onFollow).toHaveBeenCalled();
    });

    test('no "Follow the run" while following, nor in the builder', () => {
        setup({ follow: true, onFollow: jest.fn() });
        expect(screen.queryByRole('button', { name: 'Follow the run' })).toBeNull();
    });
});
