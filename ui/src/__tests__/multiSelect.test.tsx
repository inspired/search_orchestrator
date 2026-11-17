import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import type { JobDefinition } from '../api/types';
import FlowCanvas, { FlowCanvasProps } from '../features/builder/FlowCanvas';
import { buildGraph } from '../features/builder/nodeModel';
import type { Positions } from '../features/builder/graphLogic';
import { keysInBox, normaliseSelection, selectedKeys, toggleInSelection } from '../features/builder/selection';
import { renderThemed } from './fixtures';

const job: JobDefinition = {
    name: 'nightly',
    enabled: true,
    triggers: [{ type: 'cron', cron: '0 2 * * *' }],
    steps: [
        { id: 'a', type: 'inline', spl: 'search x', actions: [{ hook: 'on_failure', type: 'email', to: 'x@y' }] },
        { id: 'b', type: 'inline', spl: 'search y' },
        { id: 'c', type: 'inline', spl: 'search z' },
    ],
    edges: [{ from: 'a', to: 'b', condition: 'on_success' }],
};
const graph = buildGraph(job);

// jsdom has no layout: the svg sits at 0,0 with zoom 1, so client and canvas coordinates match.
const positions: Positions = {
    'trigger:0': { x: 0, y: 100 },
    job: { x: 0, y: 400 },
    'step:a': { x: 250, y: 100 },
    'step:b': { x: 550, y: 100 },
    'step:c': { x: 400, y: 600 },
    'action:a:0': { x: 550, y: 300 },
};
const centre = (key: string) => ({ clientX: positions[key].x + 100, clientY: positions[key].y + 30 });

function setup(over: Partial<FlowCanvasProps> = {}) {
    const props: FlowCanvasProps = {
        graph,
        positions,
        selected: null,
        issues: [],
        onSelect: jest.fn(),
        onMove: jest.fn(),
        onRequestRemove: jest.fn(),
        onRequestRemoveNodes: jest.fn(),
        ...over,
    };
    renderThemed(<FlowCanvas {...props} />);
    const canvas = screen.getByRole('group', { name: /^Job flow/ });
    return { props, canvas };
}

describe('selection helpers', () => {
    test('one key is a node selection, two or more a nodes selection, none is nothing', () => {
        expect(normaliseSelection(['step:a'])).toEqual({ kind: 'node', key: 'step:a' });
        expect(normaliseSelection(['step:a', 'step:b'])).toEqual({ kind: 'nodes', keys: ['step:a', 'step:b'] });
        expect(normaliseSelection([])).toBeNull();
        expect(selectedKeys({ kind: 'link', key: 'x' })).toEqual([]);
    });

    test('toggling adds to and removes from the selection, and back down to one', () => {
        const two = toggleInSelection({ kind: 'node', key: 'step:a' }, 'step:b');
        expect(two).toEqual({ kind: 'nodes', keys: ['step:a', 'step:b'] });
        expect(toggleInSelection(two, 'step:a')).toEqual({ kind: 'node', key: 'step:b' });
        expect(toggleInSelection({ kind: 'link', key: 'l' }, 'step:a')).toEqual({ kind: 'node', key: 'step:a' });
        expect(toggleInSelection({ kind: 'node', key: 'step:a' }, 'step:a')).toBeNull();
    });

    test('keysInBox finds the nodes whose boxes touch the box, in either drag direction', () => {
        expect(keysInBox(graph, positions, { x: 300, y: 50 }, { x: 600, y: 120 })).toEqual(['step:a', 'step:b']);
        expect(keysInBox(graph, positions, { x: 600, y: 120 }, { x: 300, y: 50 })).toEqual(['step:a', 'step:b']);
        expect(keysInBox(graph, positions, { x: 1000, y: 1000 }, { x: 1100, y: 1100 })).toEqual([]);
    });
});

describe('FlowCanvas multi-select', () => {
    test('Shift+click toggles a node in the selection', () => {
        const { props, canvas } = setup({ selected: { kind: 'node', key: 'step:a' } });
        fireEvent.pointerDown(screen.getByTestId('node-step:b'), { ...centre('step:b'), shiftKey: true });
        fireEvent.pointerUp(canvas, { ...centre('step:b'), shiftKey: true });
        expect(props.onSelect).toHaveBeenLastCalledWith({ kind: 'nodes', keys: ['step:a', 'step:b'] });
    });

    test('Shift+click on a selected node takes it out', () => {
        const { props, canvas } = setup({ selected: { kind: 'nodes', keys: ['step:a', 'step:b', 'step:c'] } });
        fireEvent.pointerDown(screen.getByTestId('node-step:b'), { ...centre('step:b'), shiftKey: true });
        fireEvent.pointerUp(canvas, { ...centre('step:b'), shiftKey: true });
        expect(props.onSelect).toHaveBeenLastCalledWith({ kind: 'nodes', keys: ['step:a', 'step:c'] });
    });

    test('every selected node is drawn selected', () => {
        setup({ selected: { kind: 'nodes', keys: ['step:a', 'step:b'] } });
        expect(screen.getByTestId('node-step:a')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('node-step:b')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('node-step:c')).toHaveAttribute('aria-pressed', 'false');
    });

    test('Shift+Space on a focused node toggles it', () => {
        const { props } = setup({ selected: { kind: 'node', key: 'step:a' } });
        fireEvent.keyDown(screen.getByTestId('node-step:c'), { key: ' ', shiftKey: true });
        expect(props.onSelect).toHaveBeenLastCalledWith({ kind: 'nodes', keys: ['step:a', 'step:c'] });
    });

    test('Shift+drag on empty canvas draws a box and selects the nodes it touches', () => {
        const { props, canvas } = setup();
        fireEvent.pointerDown(canvas, { clientX: 300, clientY: 50, shiftKey: true });
        fireEvent.pointerMove(canvas, { clientX: 600, clientY: 120, shiftKey: true });
        const box = screen.getByTestId('selection-box');
        expect(box).toHaveAttribute('x', '300');
        expect(box).toHaveAttribute('width', '300');
        // The view did not pan.
        expect(canvas.querySelector('g[data-view]')).toHaveAttribute('transform', 'translate(0,0) scale(1)');
        fireEvent.pointerUp(canvas, { clientX: 600, clientY: 120, shiftKey: true });
        expect(props.onSelect).toHaveBeenLastCalledWith({ kind: 'nodes', keys: ['step:a', 'step:b'] });
        expect(screen.queryByTestId('selection-box')).toBeNull();
    });

    test('a Shift box adds to the selection already there', () => {
        const { props, canvas } = setup({ selected: { kind: 'node', key: 'step:c' } });
        fireEvent.pointerDown(canvas, { clientX: 300, clientY: 50, shiftKey: true });
        fireEvent.pointerMove(canvas, { clientX: 400, clientY: 120, shiftKey: true });
        fireEvent.pointerUp(canvas, { clientX: 400, clientY: 120, shiftKey: true });
        expect(props.onSelect).toHaveBeenLastCalledWith({ kind: 'nodes', keys: ['step:c', 'step:a'] });
    });

    test('a plain drag on empty canvas still pans', () => {
        const { props, canvas } = setup();
        fireEvent.pointerDown(canvas, { clientX: 300, clientY: 50 });
        fireEvent.pointerMove(canvas, { clientX: 340, clientY: 50 });
        expect(screen.queryByTestId('selection-box')).toBeNull();
        expect(canvas.querySelector('g[data-view]')).toHaveAttribute('transform', 'translate(40,0) scale(1)');
        fireEvent.pointerUp(canvas, { clientX: 340, clientY: 50 });
        expect(props.onSelect).not.toHaveBeenCalled();
    });

    test('dragging one selected node moves them all, with one onMove', () => {
        const onSplice = jest.fn();
        const { props, canvas } = setup({
            selected: { kind: 'nodes', keys: ['step:b', 'step:c'] },
            onSplice,
            canSpliceNode: () => true,
        });
        const c = centre('step:c');
        fireEvent.pointerDown(screen.getByTestId('node-step:c'), c);
        fireEvent.pointerMove(canvas, { clientX: c.clientX + 50, clientY: c.clientY + 20 });
        expect(screen.getByTestId('node-step:b')).toHaveAttribute('transform', 'translate(600,120)');
        expect(screen.getByTestId('node-step:a')).toHaveAttribute('transform', 'translate(250,100)');
        fireEvent.pointerUp(canvas, { clientX: c.clientX + 52, clientY: c.clientY + 21 });
        expect(props.onMove).toHaveBeenCalledTimes(1);
        expect(props.onMove).toHaveBeenCalledWith({ 'step:b': { x: 600, y: 120 }, 'step:c': { x: 450, y: 620 } });
        expect(onSplice).not.toHaveBeenCalled();
    });

    test('a plain click on a node in a multi-selection selects just that node', () => {
        const { props, canvas } = setup({ selected: { kind: 'nodes', keys: ['step:b', 'step:c'] } });
        fireEvent.pointerDown(screen.getByTestId('node-step:c'), centre('step:c'));
        fireEvent.pointerUp(canvas, centre('step:c'));
        expect(props.onSelect).toHaveBeenLastCalledWith({ kind: 'node', key: 'step:c' });
    });

    test('Ctrl+A and Cmd+A select every node but the whole job', () => {
        const { props, canvas } = setup();
        fireEvent.keyDown(canvas, { key: 'a', ctrlKey: true });
        const all = graph.nodes.map((n) => n.key).filter((k) => k !== 'job');
        expect(props.onSelect).toHaveBeenLastCalledWith({ kind: 'nodes', keys: all });
        fireEvent.keyDown(canvas, { key: 'a', metaKey: true });
        expect(props.onSelect).toHaveBeenCalledTimes(2);
    });

    test('Escape clears a multi-selection', () => {
        const { props, canvas } = setup({ selected: { kind: 'nodes', keys: ['step:b', 'step:c'] } });
        fireEvent.keyDown(canvas, { key: 'Escape' });
        expect(props.onSelect).toHaveBeenLastCalledWith(null);
    });

    test('Delete on a multi-selection asks to remove all of them', () => {
        const { props } = setup({ selected: { kind: 'nodes', keys: ['step:b', 'step:c'] } });
        fireEvent.keyDown(screen.getByTestId('node-step:b'), { key: 'Delete' });
        expect(props.onRequestRemoveNodes).toHaveBeenCalledWith(['step:b', 'step:c']);
        expect(props.onRequestRemove).not.toHaveBeenCalled();
    });

    test('arrow keys nudge every selected node as one move', () => {
        const { props, canvas } = setup({ selected: { kind: 'nodes', keys: ['step:b', 'step:c'] } });
        fireEvent.keyDown(canvas, { key: 'ArrowRight' });
        expect(props.onMove).toHaveBeenCalledWith({ 'step:b': { x: 560, y: 100 }, 'step:c': { x: 410, y: 600 } });
    });
});
