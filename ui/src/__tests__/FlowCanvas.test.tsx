import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import type { Issue, JobDefinition } from '../api/types';
import FlowCanvas, { FlowCanvasProps, FlowSelection } from '../features/builder/FlowCanvas';
import { buildGraph } from '../features/builder/nodeModel';
import type { Positions } from '../features/builder/graphLogic';
import { renderThemed } from './fixtures';

const job: JobDefinition = {
    name: 'nightly',
    enabled: true,
    triggers: [{ type: 'cron', cron: '0 2 * * *' }],
    steps: [
        { id: 'a', type: 'inline', spl: 'search x', actions: [{ hook: 'on_failure', type: 'email', to: 'x@y' }] },
        { id: 'b', type: 'inline', spl: 'search y' },
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
        onConnect: jest.fn(),
        onDropOnCanvas: jest.fn(),
        onRequestRemove: jest.fn(),
        onQuickAdd: jest.fn(),
        ...over,
    };
    renderThemed(<FlowCanvas {...props} />);
    const canvas = screen.getByRole('group', { name: /^Job flow/ });
    const view = () => canvas.querySelector('g[data-view]') as SVGGElement;
    return { props, canvas, view };
}

describe('FlowCanvas', () => {
    test('renders one element per node', () => {
        setup();
        graph.nodes.forEach((n) => expect(screen.getByTestId(`node-${n.key}`)).toBeInTheDocument());
        expect(screen.getByTestId('node-step:a')).toHaveAttribute('transform', 'translate(250,100)');
    });

    test('nodes are focusable in graph order with a family label', () => {
        const { props } = setup();
        const nodes = Array.from(document.querySelectorAll('[data-node-key]'));
        expect(nodes.map((n) => n.getAttribute('data-node-key'))).toEqual(graph.nodes.map((n) => n.key));
        const a = screen.getByRole('button', { name: 'Search a, Search' });
        expect(a).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('button', { name: 'Notify Email, x@y' })).toBeInTheDocument();
        a.focus();
        expect(document.activeElement).toBe(a);
        fireEvent.keyDown(a, { key: 'Enter' });
        expect(props.onSelect).toHaveBeenCalledWith({ kind: 'node', key: 'step:a' });
    });

    test('clicking a node selects it', () => {
        const { props, canvas } = setup();
        fireEvent.pointerDown(screen.getByTestId('node-step:a'), centre('step:a'));
        fireEvent.pointerUp(canvas, centre('step:a'));
        expect(props.onSelect).toHaveBeenCalledWith({ kind: 'node', key: 'step:a' });
        expect(props.onMove).not.toHaveBeenCalled();
    });

    test('a press that moves under 3 px is a click, not a move', () => {
        const { props, canvas } = setup();
        const c = centre('step:a');
        fireEvent.pointerDown(screen.getByTestId('node-step:a'), c);
        fireEvent.pointerMove(canvas, { clientX: c.clientX + 2, clientY: c.clientY });
        fireEvent.pointerUp(canvas, { clientX: c.clientX + 2, clientY: c.clientY });
        expect(props.onSelect).toHaveBeenCalledWith({ kind: 'node', key: 'step:a' });
        expect(props.onMove).not.toHaveBeenCalled();
    });

    test('dragging a node moves it once on drop, snapped to 10 px', () => {
        const { props, canvas } = setup();
        const node = screen.getByTestId('node-step:a');
        const c = centre('step:a');
        fireEvent.pointerDown(node, c);
        fireEvent.pointerMove(canvas, { clientX: c.clientX + 50, clientY: c.clientY });
        expect(node).toHaveAttribute('transform', 'translate(300,100)');
        fireEvent.pointerMove(canvas, { clientX: c.clientX + 100, clientY: c.clientY + 3 });
        expect(props.onMove).not.toHaveBeenCalled();
        fireEvent.pointerUp(canvas, { clientX: c.clientX + 100, clientY: c.clientY + 3 });
        expect(props.onMove).toHaveBeenCalledTimes(1);
        expect(props.onMove).toHaveBeenCalledWith({ 'step:a': { x: 350, y: 100 } });
        expect(props.onSelect).not.toHaveBeenCalled();
    });

    test('a line from a port dropped on another node connects them', () => {
        const { props, canvas } = setup();
        fireEvent.pointerDown(screen.getByTestId('port-step:a-failure'), { clientX: 450, clientY: 138 });
        fireEvent.pointerMove(canvas, centre('step:b'));
        expect(screen.getByTestId('link-draft')).toBeInTheDocument();
        fireEvent.pointerUp(canvas, centre('step:b'));
        expect(props.onConnect).toHaveBeenCalledWith('step:a', 'failure', 'step:b');
        expect(props.onDropOnCanvas).not.toHaveBeenCalled();
        expect(props.onSelect).not.toHaveBeenCalled();
        expect(screen.queryByTestId('link-draft')).toBeNull();
    });

    test('a line dropped on empty canvas reports the canvas point', () => {
        const { props, canvas } = setup();
        fireEvent.pointerDown(screen.getByTestId('port-step:a-failure'), { clientX: 450, clientY: 138 });
        fireEvent.pointerMove(canvas, { clientX: 900, clientY: 700 });
        fireEvent.pointerUp(canvas, { clientX: 900, clientY: 700 });
        expect(props.onDropOnCanvas).toHaveBeenCalledWith('step:a', 'failure', { x: 900, y: 700 }, { left: 900, top: 700 });
        expect(props.onConnect).not.toHaveBeenCalled();
    });

    test('a line dropped on its own node, or a click on a port, does nothing', () => {
        const { props, canvas } = setup();
        fireEvent.pointerDown(screen.getByTestId('port-step:a-failure'), { clientX: 450, clientY: 138 });
        fireEvent.pointerUp(canvas, centre('step:a'));
        fireEvent.pointerDown(screen.getByTestId('port-step:a-failure'), { clientX: 450, clientY: 138 });
        fireEvent.pointerUp(canvas, { clientX: 452, clientY: 138 });
        expect(props.onConnect).not.toHaveBeenCalled();
        expect(props.onDropOnCanvas).not.toHaveBeenCalled();
    });

    test('Started, Delayed and If… show only on hover or selection', () => {
        setup();
        const a = screen.getByTestId('node-step:a');
        expect(screen.getByTestId('port-step:a-success')).toBeInTheDocument();
        expect(screen.getByTestId('port-step:a-always')).toBeInTheDocument();
        expect(screen.queryByTestId('port-step:a-start')).toBeNull();
        expect(screen.queryByTestId('port-step:a-if')).toBeNull();
        fireEvent.pointerEnter(a);
        expect(screen.getByTestId('port-step:a-start')).toBeInTheDocument();
        expect(screen.getByTestId('port-step:a-delayed')).toBeInTheDocument();
        expect(screen.getByTestId('port-step:a-if')).toBeInTheDocument();
        fireEvent.pointerLeave(a);
        expect(screen.queryByTestId('port-step:a-start')).toBeNull();
    });

    test('a selected node shows its Started port; a linked port always shows', () => {
        const linked = buildGraph({ ...job, actions: [{ hook: 'on_start', type: 'email', to: 'z' }] });
        renderThemed(
            <FlowCanvas
                graph={linked}
                positions={{ ...positions, 'action:job:0': { x: 300, y: 500 } }}
                selected={{ kind: 'node', key: 'step:b' }}
                issues={[]}
                onSelect={jest.fn()}
            />
        );
        expect(screen.getByTestId('port-step:b-start')).toBeInTheDocument();
        expect(screen.queryByTestId('port-step:a-start')).toBeNull();
        expect(screen.getByTestId('port-job-start')).toBeInTheDocument();
    });

    test('readOnly renders no ports and does not move nodes', () => {
        const { props, canvas } = setup({ readOnly: true });
        expect(screen.queryAllByTestId(/^port-/)).toHaveLength(0);
        fireEvent.pointerEnter(screen.getByTestId('node-step:a'));
        expect(screen.queryAllByTestId(/^port-/)).toHaveLength(0);
        const c = centre('step:a');
        fireEvent.pointerDown(screen.getByTestId('node-step:a'), c);
        fireEvent.pointerMove(canvas, { clientX: c.clientX + 100, clientY: c.clientY });
        fireEvent.pointerUp(canvas, { clientX: c.clientX + 100, clientY: c.clientY });
        expect(props.onMove).not.toHaveBeenCalled();
        expect(props.onSelect).toHaveBeenCalledWith({ kind: 'node', key: 'step:a' });
        fireEvent.keyDown(canvas, { key: 'Delete' });
        expect(props.onRequestRemove).not.toHaveBeenCalled();
    });

    describe('links', () => {
        test('a link is coloured by its port and clicking it selects it', () => {
            const { props } = setup();
            const key = 'step:a-success->step:b';
            const link = screen.getByTestId(`link-${key}`);
            const stroke = link.querySelector('path')!.getAttribute('stroke');
            const portRing = screen.getByTestId('port-step:a-success').querySelector('circle')!.getAttribute('stroke');
            expect(stroke).toBe(portRing);
            const failure = screen.getByTestId('link-step:a-failure->action:a:0').querySelector('path')!.getAttribute('stroke');
            expect(failure).not.toBe(stroke);
            fireEvent.click(link);
            expect(props.onSelect).toHaveBeenCalledWith({ kind: 'link', key });
        });

        test('clicking an action link selects the action node', () => {
            const { props } = setup();
            fireEvent.click(screen.getByTestId('link-step:a-failure->action:a:0'));
            expect(props.onSelect).toHaveBeenCalledWith({ kind: 'node', key: 'action:a:0' });
        });

        test('trigger links are dashed and cannot be selected', () => {
            setup();
            const link = screen.getByTestId('link-trigger:0->step:a');
            expect(link.getAttribute('pointer-events')).toBe('none');
            expect(link.querySelector('path')!.getAttribute('stroke-dasharray')).toBeTruthy();
            expect(screen.queryByRole('button', { name: /^Line from Schedule/ })).toBeNull();
        });

        test('a link can be selected from the keyboard', () => {
            const { props } = setup();
            const line = screen.getByRole('button', { name: 'Line from a, Succeeded, to b' });
            fireEvent.keyDown(line, { key: 'Enter' });
            expect(props.onSelect).toHaveBeenCalledWith({ kind: 'link', key: 'step:a-success->step:b' });
        });

        test('a link starts at its port and ends at the input', () => {
            setup();
            const d = screen.getByTestId('link-step:a-success->step:b').querySelector('path')!.getAttribute('d') || '';
            // step size 200×76; six fixed port slots → success at y = 76/7, shown or not.
            expect(d.startsWith(`M450,${100 + 76 / 7} `)).toBe(true);
            expect(d.endsWith('550,138')).toBe(true);
        });

        test('a data link is drawn thicker than a signal link', () => {
            const data = buildGraph({ ...job, steps: [job.steps[0], { id: 'b', type: 'previous', spl: '| head 1' }] });
            renderThemed(<FlowCanvas graph={data} positions={positions} selected={null} issues={[]} onSelect={jest.fn()} />);
            const width = (key: string) => Number(screen.getByTestId(`link-${key}`).querySelector('path')!.getAttribute('stroke-width'));
            expect(width('step:a-success->step:b')).toBeGreaterThan(width('step:a-failure->action:a:0'));
        });
    });

    describe('line widths', () => {
        test('data links are 3 px, signal links 1.5 px and trigger links dashed', () => {
            const data = buildGraph({ ...job, steps: [job.steps[0], { id: 'b', type: 'previous', spl: '| head 1' }] });
            renderThemed(<FlowCanvas graph={data} positions={positions} selected={null} issues={[]} onSelect={jest.fn()} />);
            const path = (key: string) => screen.getByTestId(`link-${key}`).querySelector('path') as SVGPathElement;
            expect(path('step:a-success->step:b').getAttribute('stroke-width')).toBe('3');
            expect(path('step:a-success->step:b').getAttribute('stroke-dasharray')).toBeNull();
            expect(path('step:a-failure->action:a:0').getAttribute('stroke-width')).toBe('1.5');
            expect(path('trigger:0->step:a').getAttribute('stroke-dasharray')).toBeTruthy();
        });
    });

    describe('legend and minimap', () => {
        const original = {
            w: Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth') as PropertyDescriptor,
            h: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight') as PropertyDescriptor,
        };
        const size = (w: number, h: number) => {
            Object.defineProperty(Element.prototype, 'clientWidth', { value: w, configurable: true });
            Object.defineProperty(Element.prototype, 'clientHeight', { value: h, configurable: true });
        };
        afterEach(() => {
            Object.defineProperty(Element.prototype, 'clientWidth', original.w);
            Object.defineProperty(Element.prototype, 'clientHeight', original.h);
        });

        test('Show node types toggles the legend', () => {
            setup();
            expect(screen.queryByTestId('legend')).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Show node types' }));
            expect(screen.getByTestId('legend')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Hide node types' }));
            expect(screen.queryByTestId('legend')).toBeNull();
        });

        test('no minimap when the whole graph is in view', () => {
            size(1200, 600);
            setup();
            expect(screen.queryByTestId('minimap')).toBeNull();
        });

        test('a small two-node graph has no minimap', () => {
            size(300, 300);
            const two = buildGraph({ ...job, triggers: [], steps: [{ id: 'a', type: 'inline', spl: 'search x' }], edges: [] });
            renderThemed(<FlowCanvas graph={two} positions={{ job: { x: 0, y: 200 }, 'step:a': { x: 10, y: 10 } }} selected={null} issues={[]} onSelect={jest.fn()} />);
            expect(screen.queryByTestId('minimap')).toBeNull();
        });

        test('minimap shows when the graph exceeds the view; clicking pans there', () => {
            size(400, 300);
            const { view } = setup();
            const map = screen.getByTestId('minimap');
            expect(map).toHaveAttribute('aria-hidden', 'true');
            expect(map.querySelectorAll('rect[data-node]')).toHaveLength(graph.nodes.length);
            expect(map.querySelector('rect[data-viewport]')).not.toBeNull();
            const before = view().getAttribute('transform');
            fireEvent.click(map, { clientX: 140, clientY: 80 });
            expect(view().getAttribute('transform')).not.toBe(before);
        });

        test('minimap also shows in read-only mode', () => {
            size(400, 300);
            setup({ readOnly: true });
            expect(screen.getByTestId('minimap')).toBeInTheDocument();
        });
    });

    describe('keyboard', () => {
        test('/ opens quick-add at the pointer', () => {
            const { props, canvas } = setup();
            fireEvent.pointerMove(canvas, { clientX: 300, clientY: 220 });
            const notPrevented = fireEvent.keyDown(canvas, { key: '/' });
            expect(notPrevented).toBe(false);
            expect(props.onQuickAdd).toHaveBeenCalledWith({ x: 300, y: 220 }, { left: 300, top: 220 });
        });

        test('/ without a pointer opens quick-add at the view centre', () => {
            const { props, canvas } = setup();
            fireEvent.keyDown(canvas, { key: '/' });
            expect(props.onQuickAdd).toHaveBeenCalledTimes(1);
            const at = (props.onQuickAdd as jest.Mock).mock.calls[0][0];
            expect(Number.isFinite(at.x) && Number.isFinite(at.y)).toBe(true);
        });

        test('once the pointer leaves, / opens quick-add at the view centre, not where the pointer was', () => {
            const { props, canvas } = setup();
            fireEvent.pointerMove(canvas, { clientX: 300, clientY: 220 });
            fireEvent.pointerLeave(canvas);
            fireEvent.keyDown(canvas, { key: '/' });
            // jsdom gives the svg no size, so the centre of the view is 0,0.
            expect(props.onQuickAdd).toHaveBeenCalledWith({ x: 0, y: 0 }, { left: 0, top: 0 });
        });

        test('/ also works with focus in the toolbar; Add node opens quick-add at the view centre', () => {
            const { props } = setup();
            const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
            expect(fireEvent.keyDown(zoomIn, { key: '/' })).toBe(false);
            expect(props.onQuickAdd).toHaveBeenCalledTimes(1);
            fireEvent.click(screen.getByRole('button', { name: 'Add node' }));
            expect(props.onQuickAdd).toHaveBeenCalledTimes(2);
            expect(props.onQuickAdd).toHaveBeenLastCalledWith({ x: 0, y: 0 }, { left: 0, top: 0 });
        });

        test('Tidy up shows only with onTidy and calls it', () => {
            const onTidy = jest.fn();
            setup({ onTidy });
            fireEvent.click(screen.getByRole('button', { name: 'Tidy up' }));
            expect(onTidy).toHaveBeenCalledTimes(1);
        });

        test('Tab opens quick-add only while the pointer is over the canvas, never Shift+Tab', () => {
            const { props, canvas } = setup();
            const node = screen.getByTestId('node-step:a');
            expect(fireEvent.keyDown(node, { key: 'Tab' })).toBe(true);
            expect(props.onQuickAdd).not.toHaveBeenCalled();
            fireEvent.pointerEnter(canvas);
            expect(fireEvent.keyDown(node, { key: 'Tab', shiftKey: true })).toBe(true);
            expect(props.onQuickAdd).not.toHaveBeenCalled();
            expect(fireEvent.keyDown(node, { key: 'Tab' })).toBe(false);
            expect(props.onQuickAdd).toHaveBeenCalledTimes(1);
            fireEvent.pointerLeave(canvas);
            fireEvent.keyDown(canvas, { key: 'Tab' });
            expect(props.onQuickAdd).toHaveBeenCalledTimes(1);
        });

        test('Delete asks to remove the selected node, never the whole job', () => {
            const sel: FlowSelection = { kind: 'node', key: 'step:a' };
            const { props, canvas } = setup({ selected: sel });
            fireEvent.keyDown(canvas, { key: 'Delete' });
            expect(props.onRequestRemove).toHaveBeenCalledWith('step:a');
        });

        test('Delete on the whole job does nothing', () => {
            const { props, canvas } = setup({ selected: { kind: 'node', key: 'job' } });
            fireEvent.keyDown(canvas, { key: 'Delete' });
            fireEvent.keyDown(screen.getByTestId('node-job'), { key: 'Backspace' });
            expect(props.onRequestRemove).not.toHaveBeenCalled();
        });

        test('Backspace on a focused node asks to remove it', () => {
            const { props } = setup();
            fireEvent.keyDown(screen.getByTestId('node-step:b'), { key: 'Backspace' });
            expect(props.onRequestRemove).toHaveBeenCalledWith('step:b');
        });

        test('arrow keys nudge the selected node by 10 px', () => {
            const { props, canvas } = setup({ selected: { kind: 'node', key: 'step:a' } });
            expect(fireEvent.keyDown(canvas, { key: 'ArrowRight' })).toBe(false);
            expect(props.onMove).toHaveBeenCalledWith({ 'step:a': { x: 260, y: 100 } });
            fireEvent.keyDown(canvas, { key: 'ArrowUp' });
            expect(props.onMove).toHaveBeenLastCalledWith({ 'step:a': { x: 250, y: 90 } });
        });

        test('F frames every node', () => {
            const { canvas, view } = setup();
            Object.defineProperty(canvas, 'clientWidth', { value: 1200, configurable: true });
            Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true });
            expect(view().getAttribute('transform')).toBe('translate(0,0) scale(1)');
            fireEvent.keyDown(canvas, { key: 'f' });
            // bounds 0..750 × 100..468 → centred at (375, 284), fits at zoom 1.
            expect(view().getAttribute('transform')).toBe('translate(225,16) scale(1)');
            fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
            fireEvent.click(screen.getByRole('button', { name: 'Frame all' }));
            expect(view().getAttribute('transform')).toBe('translate(225,16) scale(1)');
        });

        test('Escape clears the selection', () => {
            const { props, canvas } = setup({ selected: { kind: 'node', key: 'step:a' } });
            fireEvent.keyDown(canvas, { key: 'Escape' });
            expect(props.onSelect).toHaveBeenCalledWith(null);
        });
    });

    describe('pan and zoom', () => {
        test('dragging the background pans; a click on it clears the selection', () => {
            const { props, canvas, view } = setup();
            fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
            fireEvent.pointerMove(canvas, { clientX: 60, clientY: 30 });
            fireEvent.pointerUp(canvas, { clientX: 60, clientY: 30 });
            expect(view().getAttribute('transform')).toBe('translate(50,20) scale(1)');
            expect(props.onSelect).not.toHaveBeenCalled();
            fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
            fireEvent.pointerUp(canvas, { clientX: 10, clientY: 10 });
            expect(props.onSelect).toHaveBeenCalledWith(null);
        });

        test('buttons zoom within limits and reset the view', () => {
            const { view } = setup();
            fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
            expect(view().getAttribute('transform')).toBe('translate(0,0) scale(1.2)');
            for (let i = 0; i < 10; i += 1) {
                fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
            }
            expect(view().getAttribute('transform')).toBe('translate(0,0) scale(2)');
            for (let i = 0; i < 20; i += 1) {
                fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
            }
            expect(view().getAttribute('transform')).toBe('translate(0,0) scale(0.4)');
            fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
            expect(view().getAttribute('transform')).toBe('translate(0,0) scale(1)');
        });

        test('the wheel zooms', () => {
            const { canvas, view } = setup();
            fireEvent.wheel(canvas, { deltaY: -100 });
            expect(view().getAttribute('transform')).toBe('translate(0,0) scale(1.1)');
        });

        test('canvas points account for pan and zoom', () => {
            const { props, canvas } = setup();
            fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0 });
            fireEvent.pointerMove(canvas, { clientX: 100, clientY: 0 });
            fireEvent.pointerUp(canvas, { clientX: 100, clientY: 0 });
            fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
            fireEvent.pointerMove(canvas, { clientX: 220, clientY: 120 });
            fireEvent.keyDown(canvas, { key: '/' });
            const at = (props.onQuickAdd as jest.Mock).mock.calls[0][0];
            expect(at.x).toBeCloseTo(100);
            expect(at.y).toBeCloseTo(100);
        });
    });

    describe('issues, notes and status', () => {
        const issues: Issue[] = [{ level: 'error', code: 'bad_spl', message: 'Fix it', step: 'a' }];

        test('issue markers replace the detail and join the label', () => {
            setup({ issues });
            expect(screen.getByRole('button', { name: 'Search a, Search, 1 error' })).toBeInTheDocument();
            expect(screen.getByTestId('node-step:a')).toHaveTextContent('1 error');
        });

        test('preview notes show as plain text under the step', () => {
            setup({ notes: { a: { text: '✓ 7 rows' }, b: { text: 'preview failed', failed: true } } });
            expect(screen.getByTestId('note-a')).toHaveTextContent('✓ 7 rows');
            expect(screen.getByTestId('note-b')).toHaveTextContent('preview failed');
            expect(screen.getByTestId('note-b').getAttribute('fill')).not.toBe(screen.getByTestId('note-a').getAttribute('fill'));
            expect(screen.getByRole('button', { name: 'Search a, Search, ✓ 7 rows' })).toBeInTheDocument();
        });

        test('status replaces the detail with text, an icon and an outline colour', () => {
            setup({
                readOnly: true,
                status: { 'step:a': { text: 'Failed', icon: <circle data-testid="status-icon" r={4} />, color: 'crimson' } },
            });
            const node = screen.getByTestId('node-step:a');
            expect(node).toHaveTextContent('Failed');
            expect(node).not.toHaveTextContent(/Search$/);
            expect(screen.getByTestId('status-icon')).toBeInTheDocument();
            expect(node.querySelector('path[stroke]')!.getAttribute('stroke')).toBe('crimson');
            expect(screen.getByRole('button', { name: 'Search a, Failed' })).toBeInTheDocument();
        });
    });
});
