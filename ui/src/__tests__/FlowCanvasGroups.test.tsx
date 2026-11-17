import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import type { JobDefinition } from '../api/types';
import FlowCanvas, { FlowCanvasProps } from '../features/builder/FlowCanvas';
import { buildGraph } from '../features/builder/nodeModel';
import type { Positions } from '../features/builder/graphLogic';
import type { Group } from '../features/builder/groups';
import { renderThemed } from './fixtures';

const job: JobDefinition = {
    name: 'g',
    enabled: true,
    steps: [
        { id: 'a', type: 'inline', spl: 'search a' },
        { id: 'b', type: 'inline', spl: 'search b' },
        { id: 'c', type: 'inline', spl: 'search c' },
    ],
    edges: [
        { from: 'a', to: 'b', condition: 'on_success' },
        { from: 'b', to: 'c', condition: 'on_success' },
    ],
};
const graph = buildGraph(job);
const positions: Positions = { job: { x: 0, y: 400 }, 'step:a': { x: 100, y: 100 }, 'step:b': { x: 400, y: 100 }, 'step:c': { x: 700, y: 100 } };
const group = (over: Partial<Group> = {}): Group => ({ id: 'g1', title: 'Daily', color: 'categoricalA2', x: 50, y: 50, w: 600, h: 200, ...over });

function setup(over: Partial<FlowCanvasProps> = {}) {
    const props: FlowCanvasProps = {
        graph,
        positions,
        selected: null,
        issues: [],
        groups: [group()],
        onSelect: jest.fn(),
        onMove: jest.fn(),
        onGroupMove: jest.fn(),
        onGroupResize: jest.fn(),
        onGroupTitle: jest.fn(),
        onRequestRemoveGroup: jest.fn(),
        ...over,
    };
    const r = renderThemed(<FlowCanvas {...props} />);
    const canvas = screen.getByRole('group', { name: /^Job flow/ });
    return { props, canvas, ...r };
}

const groupButton = () => document.querySelector('[data-group-id="g1"]') as HTMLElement;

describe('FlowCanvas groups', () => {
    test('a frame is drawn behind lines and nodes, tinted with its colour token', () => {
        setup();
        const frame = screen.getByTestId('group-g1');
        expect(frame).toHaveTextContent('Daily');
        const firstLink = screen.getByTestId('link-step:a-success->step:b');
        expect(frame.compareDocumentPosition(firstLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const body = screen.getByTestId('group-body-g1');
        expect(body).toHaveAttribute('fill-opacity', '0.12');
        expect(body).toHaveAttribute('stroke', body.getAttribute('fill'));
        expect(body).toHaveAttribute('width', '600');
    });

    test('groups are focusable after the nodes and before the lines; Enter selects, Delete asks to remove', () => {
        const { props } = setup();
        const g = groupButton();
        expect(g).toHaveAttribute('tabindex', '0');
        expect(g).toHaveAttribute('aria-label', 'Group Daily, 2 nodes');
        const lastNode = Array.from(document.querySelectorAll('[data-node-key]')).pop()!;
        const firstLine = document.querySelector('[data-link-key]')!;
        expect(lastNode.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(g.compareDocumentPosition(firstLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        fireEvent.keyDown(g, { key: 'Enter' });
        expect(props.onSelect).toHaveBeenCalledWith({ kind: 'group', id: 'g1' });
        fireEvent.keyDown(g, { key: 'Delete' });
        expect(props.onRequestRemoveGroup).toHaveBeenCalledWith('g1');
        fireEvent.keyDown(g, { key: 'ArrowRight' });
        expect(props.onGroupMove).toHaveBeenCalledWith('g1', 10, 0, ['step:a', 'step:b']);
        expect(props.onMove).not.toHaveBeenCalled();
    });

    test('Shift+arrows resize a group by 10 px, never below the minimum', () => {
        const { props } = setup({ groups: [group(), group({ id: 'g2', x: 2000, w: 125, h: 60 })] });
        fireEvent.keyDown(groupButton(), { key: 'ArrowRight', shiftKey: true });
        expect(props.onGroupResize).toHaveBeenCalledWith('g1', { w: 610, h: 200 });
        fireEvent.keyDown(groupButton(), { key: 'ArrowUp', shiftKey: true });
        expect(props.onGroupResize).toHaveBeenLastCalledWith('g1', { w: 600, h: 190 });
        const small = document.querySelector('[data-group-id="g2"]') as HTMLElement;
        fireEvent.keyDown(small, { key: 'ArrowLeft', shiftKey: true });
        expect(props.onGroupResize).toHaveBeenLastCalledWith('g2', { w: 120, h: 60 });
        expect(props.onGroupMove).not.toHaveBeenCalled();
    });

    test('Delete and arrows on a selected group, with focus on the canvas', () => {
        const { props, canvas } = setup({ selected: { kind: 'group', id: 'g1' } });
        fireEvent.keyDown(canvas, { key: 'ArrowUp' });
        expect(props.onGroupMove).toHaveBeenCalledWith('g1', 0, -10, ['step:a', 'step:b']);
        fireEvent.keyDown(canvas, { key: 'Backspace' });
        expect(props.onRequestRemoveGroup).toHaveBeenCalledWith('g1');
    });

    test('dragging the title bar moves the frame and its members once, on drop', () => {
        const { props, canvas } = setup();
        fireEvent.pointerDown(screen.getByTestId('group-title-g1'), { clientX: 100, clientY: 60, button: 0 });
        fireEvent.pointerMove(canvas, { clientX: 130, clientY: 40 });
        // While dragging, the members follow the frame.
        expect(screen.getByTestId('node-step:a')).toHaveAttribute('transform', 'translate(130,80)');
        expect(screen.getByTestId('node-step:c')).toHaveAttribute('transform', 'translate(700,100)');
        expect(screen.getByTestId('group-body-g1')).toHaveAttribute('x', '80');
        fireEvent.pointerUp(canvas, { clientX: 130, clientY: 40 });
        expect(props.onGroupMove).toHaveBeenCalledTimes(1);
        expect(props.onGroupMove).toHaveBeenCalledWith('g1', 30, -20, ['step:a', 'step:b']);
        expect(props.onMove).not.toHaveBeenCalled();
    });

    test('a click on the title bar selects the group; a double-click asks to edit the title', () => {
        const { props, canvas } = setup();
        fireEvent.pointerDown(screen.getByTestId('group-title-g1'), { clientX: 100, clientY: 60, button: 0 });
        fireEvent.pointerUp(canvas, { clientX: 101, clientY: 60 });
        expect(props.onSelect).toHaveBeenCalledWith({ kind: 'group', id: 'g1' });
        expect(props.onGroupMove).not.toHaveBeenCalled();
        fireEvent.doubleClick(screen.getByTestId('group-title-g1'));
        expect(props.onGroupTitle).toHaveBeenCalledWith('g1');
    });

    test('the corner handle resizes the frame, reported once', () => {
        const { props, canvas } = setup();
        fireEvent.pointerDown(screen.getByTestId('group-resize-g1'), { clientX: 645, clientY: 245, button: 0 });
        fireEvent.pointerMove(canvas, { clientX: 545, clientY: 195 });
        expect(screen.getByTestId('group-body-g1')).toHaveAttribute('width', '500');
        fireEvent.pointerUp(canvas, { clientX: 545, clientY: 195 });
        expect(props.onGroupResize).toHaveBeenCalledTimes(1);
        expect(props.onGroupResize).toHaveBeenCalledWith('g1', { w: 500, h: 150 });
        expect(props.onGroupMove).not.toHaveBeenCalled();
    });

    test('a selected group has a focus-colour outline', () => {
        setup({ selected: { kind: 'group', id: 'g1' } });
        expect(screen.getByTestId('group-outline-g1')).toBeInTheDocument();
        expect(groupButton()).toHaveAttribute('aria-pressed', 'true');
    });

    test('Ctrl+A selects the nodes, never a group', () => {
        const { props, canvas } = setup();
        fireEvent.keyDown(canvas, { key: 'a', ctrlKey: true });
        expect(props.onSelect).toHaveBeenCalledWith({ kind: 'nodes', keys: ['step:a', 'step:b', 'step:c'] });
    });

    test('collapsed: members hidden, a block with the title and count, lines drawn to the block', () => {
        setup({ groups: [group({ collapsed: true })] });
        expect(screen.queryByTestId('node-step:a')).toBeNull();
        expect(screen.queryByTestId('node-step:b')).toBeNull();
        expect(screen.getByTestId('node-step:c')).toBeInTheDocument();
        const block = screen.getByTestId('group-block-g1');
        expect(block).toHaveTextContent('Daily');
        expect(block).toHaveTextContent('2 nodes');
        expect(screen.getByTestId('group-body-g1')).toHaveAttribute('width', '200');
        expect(screen.getByTestId('group-body-g1')).toHaveAttribute('height', '56');
        expect(screen.queryByTestId('group-resize-g1')).toBeNull();
        // The line between two members is not drawn; the one out of the group leaves the block.
        expect(screen.queryByTestId('link-step:a-success->step:b')).toBeNull();
        const out = screen.getByTestId('link-step:b-success->step:c').querySelector('path')!;
        expect(out.getAttribute('d')).toMatch(/^M250,78 /);
        expect(document.querySelector('[data-node-key="step:a"]')).toBeNull();
        expect(groupButton()).toHaveAttribute('aria-label', 'Group Daily, collapsed, 2 nodes');
    });

    test('collapsed: the whole frame area is drawn as a faint dashed outline that takes no pointer', () => {
        const { unmount } = setup({ groups: [group({ collapsed: true })] });
        const area = screen.getByTestId('group-area-g1');
        expect(area).toHaveAttribute('width', '600');
        expect(area).toHaveAttribute('height', '200');
        expect(area).toHaveAttribute('stroke-dasharray');
        expect(area).toHaveAttribute('fill', 'none');
        expect(area).toHaveAttribute('pointer-events', 'none');
        unmount();
        setup({ groups: [group({ id: 'open' })] });
        expect(screen.queryByTestId('group-area-open')).toBeNull();
    });

    test('the run page draws groups expanded whatever was saved, and cannot move them', () => {
        const { props, canvas } = setup({ groups: [group({ collapsed: true })], readOnly: true, onMove: undefined });
        expect(screen.getByTestId('node-step:a')).toBeInTheDocument();
        expect(screen.queryByTestId('group-block-g1')).toBeNull();
        expect(screen.getByTestId('group-body-g1')).toHaveAttribute('width', '600');
        expect(screen.queryByTestId('group-resize-g1')).toBeNull();
        fireEvent.pointerDown(screen.getByTestId('group-title-g1'), { clientX: 100, clientY: 60, button: 0 });
        fireEvent.pointerMove(canvas, { clientX: 200, clientY: 60 });
        fireEvent.pointerUp(canvas, { clientX: 200, clientY: 60 });
        expect(props.onGroupMove).not.toHaveBeenCalled();
    });

    test('bad group data from a hand-edited job never crashes the canvas', () => {
        const bad = [null, 7, { id: 'x' }, group({ id: 'nan', x: Number.NaN }), group({ id: 'neg', w: -10 }), { ...group({ id: 't' }), title: 5 }];
        setup({ groups: bad as unknown as Group[] });
        graph.nodes.forEach((n) => expect(screen.getByTestId(`node-${n.key}`)).toBeInTheDocument());
        expect(document.querySelector('[data-group-id]')).toBeNull();
    });

    test('compact: membership uses full node sizes, so a collapsed group keeps the same members either way', () => {
        // Fits a compact 140 × 32 step at 100,100 but not the full 200 × 76 one.
        setup({ compact: true, groups: [group({ x: 90, y: 90, w: 160, h: 50, collapsed: true })] });
        expect(screen.getByTestId('node-step:a')).toBeInTheDocument();
        expect(groupButton()).toHaveAttribute('aria-label', 'Group Daily, collapsed, 0 nodes');
    });

    test('a group with no members left draws an empty frame', () => {
        setup({ groups: [group({ x: 2000 })] });
        expect(groupButton()).toHaveAttribute('aria-label', 'Group Daily, 0 nodes');
    });
});

describe('FlowCanvas node rendering (from Task 11 review)', () => {
    afterEach(() => window.localStorage.removeItem('so.flow.compact'));

    test('a stale preview shows a muted "Out of date" line, with no numbers and no bar', () => {
        setup({ groups: [], previews: { a: { stale: true }, b: { rows: 5, seconds: 1 } } });
        const text = screen.getByTestId('preview-text-a');
        expect(text).toHaveTextContent(/^Out of date$/);
        expect(screen.queryByTestId('preview-bar-a')).toBeNull();
        expect(text.getAttribute('fill')).not.toBe(screen.getByTestId('preview-text-b').getAttribute('fill'));
    });

    test('compact: a multi-selection draws no overlays; only the hovered node gets one', () => {
        window.localStorage.setItem('so.flow.compact', '1');
        setup({ groups: [], selected: { kind: 'nodes', keys: ['step:a', 'step:b'] } });
        expect(screen.queryByTestId('node-full-step:a')).toBeNull();
        expect(screen.queryByTestId('node-full-step:b')).toBeNull();
        fireEvent.pointerEnter(screen.getByTestId('node-step:a'));
        expect(screen.getByTestId('node-full-step:a')).toBeInTheDocument();
        expect(screen.queryByTestId('node-full-step:b')).toBeNull();
    });

    test('compact: the hover overlay is drawn after every node and takes no pointer events', () => {
        window.localStorage.setItem('so.flow.compact', '1');
        setup({ groups: [] });
        fireEvent.pointerEnter(screen.getByTestId('node-step:a'));
        const full = screen.getByTestId('node-full-step:a');
        expect(screen.getByTestId('node-step:a').contains(full)).toBe(false);
        const lastNode = Array.from(document.querySelectorAll('[data-node-key]')).pop()!;
        expect(lastNode.compareDocumentPosition(full) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(full).toHaveAttribute('pointer-events', 'none');
        expect(full).toHaveAttribute('transform', 'translate(100,100)');
        // The + and tabs are drawn again above the overlay; the real ones keep the pointer.
        const plusCopy = screen.getByTestId('overlay-plus-step:a');
        expect(full.contains(plusCopy)).toBe(true);
        expect(screen.getByTestId('node-full-step:a').querySelector('path')!.compareDocumentPosition(plusCopy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByTestId('overlay-tab-step:a-success')).toBeInTheDocument();
        expect(screen.getAllByTestId('plus-step:a')).toHaveLength(1);
    });
});
