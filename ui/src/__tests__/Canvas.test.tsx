import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import SplunkThemeProvider from '@splunk/themes/SplunkThemeProvider';
import BuilderPage from '../features/builder/BuilderPage';
import Canvas from '../features/builder/Canvas';
import { autoLayout, NODE_H, NODE_W } from '../features/builder/graphLogic';
import GraphView from '../features/builder/GraphView';
import { fakeApi } from './builderFixtures';
import { renderThemed, runSummary } from './fixtures';

const steps = [
    { id: 'daily', type: 'inline' as const, spl: '| makeresults' },
    { id: 'weekly', type: 'inline' as const, spl: '| makeresults' },
];
const edges = [{ from: 'daily', to: 'weekly' }];

describe('Canvas', () => {
    test('canvas nodes are keyboard focusable', () => {
        const onSelect = jest.fn();
        const onRequestRemove = jest.fn();
        renderThemed(
            <Canvas
                steps={steps}
                edges={edges}
                selected={null}
                issues={[]}
                onSelect={onSelect}
                onAddFrom={jest.fn()}
                onConnect={jest.fn()}
                onRequestRemove={onRequestRemove}
            />
        );
        const node = screen.getByRole('button', { name: /^Step daily/ });
        expect(node).toHaveAttribute('tabindex', '0');
        node.focus();
        expect(document.activeElement).toBe(node);
        fireEvent.keyDown(node, { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledWith({ kind: 'step', id: 'daily' });
        fireEvent.keyDown(node, { key: 'Delete' });
        expect(onRequestRemove).toHaveBeenCalledWith('daily');
    });

    test('Delete removes a step only after the confirm', async () => {
        renderThemed(<BuilderPage jobId="rollups" api={fakeApi()} />);
        const node = await screen.findByRole('button', { name: /^Step Weekly rollup/ });
        fireEvent.keyDown(node, { key: 'Delete' });
        expect(screen.getByRole('button', { name: /^Step Weekly rollup/ })).toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: 'Remove step' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: /^Step Weekly rollup/ })).toBeNull());
    });

    test('focus moves to the next step after a delete, or the canvas when none remain', async () => {
        renderThemed(<BuilderPage jobId="rollups" api={fakeApi()} />);
        const weekly = await screen.findByRole('button', { name: /^Step Weekly rollup/ });
        weekly.focus();
        fireEvent.keyDown(weekly, { key: 'Delete' });
        fireEvent.click(await screen.findByRole('button', { name: 'Remove step' }));
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Step Monthly rollup/ })));
        for (const name of [/^Step Monthly rollup/, /^Step Daily summary/]) {
            const node = screen.getByRole('button', { name });
            node.focus();
            fireEvent.keyDown(node, { key: 'Delete' });
            fireEvent.click(await screen.findByRole('button', { name: 'Remove step' }));
            // eslint-disable-next-line no-await-in-loop
            await waitFor(() => expect(screen.queryByRole('button', { name })).toBeNull());
        }
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('group', { name: /^Job steps/ })));
    });

    test('preview notes show as plain text under the step', () => {
        renderThemed(
            <Canvas
                steps={steps}
                edges={edges}
                selected={null}
                issues={[]}
                onSelect={jest.fn()}
                onAddFrom={jest.fn()}
                onConnect={jest.fn()}
                onRequestRemove={jest.fn()}
                notes={{ daily: { text: '✓ 7 rows' }, weekly: { text: 'preview failed', failed: true } }}
            />
        );
        expect(screen.getByTestId('note-daily')).toHaveTextContent('✓ 7 rows');
        expect(screen.getByTestId('note-weekly')).toHaveTextContent('preview failed');
        expect(screen.getByTestId('note-weekly').getAttribute('fill')).not.toBe(screen.getByTestId('note-daily').getAttribute('fill'));
        expect(screen.getByRole('button', { name: 'Step daily, ✓ 7 rows' })).toBeInTheDocument();
    });

    test('Preview step in the editor previews upstream steps and shows the result', async () => {
        const api = fakeApi();
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        const weekly = await screen.findByRole('button', { name: /^Step Weekly rollup/ });
        await waitFor(() => expect(api.previewDefaults).toHaveBeenCalledTimes(1));
        expect(api.listRuns).toHaveBeenCalledWith({ job_id: 'rollups', limit: 20 });
        fireEvent.keyDown(weekly, { key: 'Enter' });
        fireEvent.click(screen.getByRole('button', { name: 'Preview step' }));
        expect(await screen.findByText(/^7 rows · 0.2 s · input: daily preview/)).toBeInTheDocument();
        const calls = (api.startPreview as jest.Mock).mock.calls.map((c) => c[0]);
        expect(calls.map((c) => c.step_id)).toEqual(['daily', 'weekly']);
        expect(calls[0].scheduled_time).toBe(1762390800);
        expect(screen.getByTestId('note-daily')).toHaveTextContent('✓ 7 rows');
        expect(screen.getByTestId('note-weekly')).toHaveTextContent('✓ 7 rows');
        expect(screen.queryByTestId('note-monthly')).toBeNull();
        fireEvent.keyDown(screen.getByRole('button', { name: /^Step Daily summary/ }), { key: 'Enter' });
        fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: '| makeresults count=2' } });
        expect(screen.getByTestId('note-daily')).toHaveTextContent('out of date');
        expect(screen.getByTestId('note-weekly')).toHaveTextContent('out of date');
        expect(screen.getByText('Out of date. Preview again to refresh.')).toBeInTheDocument();
    });

    test('the run list reloads after a save and when Input from is opened', async () => {
        const api = fakeApi();
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Step Weekly rollup/ });
        await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(2));
        fireEvent.click(screen.getByTestId('input-from'));
        await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(3));
        expect(api.listRuns).toHaveBeenLastCalledWith({ job_id: 'rollups', limit: 20 });
    });

    test('Input from greys out runs past the retention the server reports', async () => {
        const now = Math.floor(Date.now() / 1000);
        const api = fakeApi({
            previewDefaults: jest.fn().mockResolvedValue({ scheduled_time: 1762390800, result_retention: 3600 }),
            listRuns: jest.fn().mockResolvedValue([
                runSummary({ id: 'rollups:1', job_id: 'rollups', scheduled_time: 1762304400, ended_at: now - 7200 }),
            ]),
        });
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Step Weekly rollup/ });
        await waitFor(() => expect(api.previewDefaults).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByTestId('input-from'));
        expect(await screen.findByRole('option', { name: / · succeeded \(results expired\)$/ })).toBeDisabled();
    });

    describe('drawing a line from a step', () => {
        // jsdom has no layout: the svg sits at 0,0 with zoom 1, so client and canvas
        // coordinates match, and the nodes sit where autoLayout puts them.
        const at = autoLayout(steps, edges);
        const centre = (id: string) => ({ clientX: at[id].x + NODE_W / 2, clientY: at[id].y + NODE_H / 2 });
        const setup = () => {
            const props = { onSelect: jest.fn(), onConnect: jest.fn(), onAddFrom: jest.fn() };
            renderThemed(
                <Canvas steps={steps} edges={edges} selected={null} issues={[]} onRequestRemove={jest.fn()} {...props} />
            );
            const drag = (from: string, to: { clientX: number; clientY: number }) => {
                fireEvent.pointerDown(screen.getByTestId(`handle-${from}`), centre(from));
                fireEvent.pointerMove(screen.getByRole('group', { name: /^Job steps/ }), to);
                fireEvent.pointerUp(screen.getByRole('group', { name: /^Job steps/ }), to);
            };
            return { ...props, drag };
        };

        test('let go on empty canvas: adds a step from it', () => {
            const { drag, onAddFrom, onConnect } = setup();
            drag('weekly', { clientX: 900, clientY: 900 });
            expect(onAddFrom).toHaveBeenCalledWith('weekly');
            expect(onConnect).not.toHaveBeenCalled();
        });

        test('let go on another step: connects them', () => {
            const { drag, onAddFrom, onConnect } = setup();
            drag('weekly', centre('daily'));
            expect(onConnect).toHaveBeenCalledWith('weekly', 'daily');
            expect(onAddFrom).not.toHaveBeenCalled();
        });

        test('let go on the step it started from: nothing happens', () => {
            const { drag, onAddFrom, onConnect } = setup();
            drag('weekly', centre('weekly'));
            expect(onConnect).not.toHaveBeenCalled();
            expect(onAddFrom).not.toHaveBeenCalled();
        });

        test('a click on the handle, with no line drawn, adds nothing', () => {
            const { onAddFrom, onConnect } = setup();
            const handle = screen.getByTestId('handle-weekly');
            const below = { clientX: at.weekly.x + NODE_W / 2, clientY: at.weekly.y + NODE_H + 4 };
            fireEvent.pointerDown(handle, below);
            fireEvent.pointerUp(screen.getByRole('group', { name: /^Job steps/ }), below);
            expect(onAddFrom).not.toHaveBeenCalled();
            expect(onConnect).not.toHaveBeenCalled();
        });

        test('steps are not dragged: pressing and moving a step only selects it', () => {
            const { onSelect } = setup();
            const node = screen.getByTestId('node-daily');
            const before = node.getAttribute('transform');
            fireEvent.pointerDown(node, centre('daily'));
            fireEvent.pointerMove(screen.getByRole('group', { name: /^Job steps/ }), { clientX: 600, clientY: 600 });
            fireEvent.pointerUp(screen.getByRole('group', { name: /^Job steps/ }), { clientX: 600, clientY: 600 });
            expect(node.getAttribute('transform')).toBe(before);
            expect(onSelect).toHaveBeenCalledWith({ kind: 'step', id: 'daily' });
        });
    });

    test('in the editor, a line dropped on empty canvas adds a selected From previous steps step; one undo removes it', async () => {
        renderThemed(<BuilderPage jobId="rollups" api={fakeApi()} />);
        await screen.findByRole('button', { name: /^Step Monthly rollup/ });
        expect(screen.queryByRole('button', { name: 'Auto layout' })).toBeNull();
        const canvas = screen.getByRole('group', { name: /^Job steps/ });
        fireEvent.pointerDown(screen.getByTestId('handle-monthly'), { clientX: 0, clientY: 0 });
        fireEvent.pointerUp(canvas, { clientX: 2000, clientY: 2000 });
        const added = await screen.findByRole('button', { name: /^Step step_4/ });
        expect(added).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByLabelText('Input (added for you)')).toHaveTextContent('| loadjob ‹monthly›');
        expect(screen.getByRole('button', { name: /^Dependency: Monthly rollup to step_4/ })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: /^Step step_4/ })).toBeNull());
        expect(screen.queryByRole('button', { name: /^Dependency: Monthly rollup to step_4/ })).toBeNull();
    });

    test('the layout follows the graph: a new edge moves the target below its source', () => {
        const loose = [
            { id: 'a', type: 'inline' as const, spl: '| makeresults' },
            { id: 'b', type: 'inline' as const, spl: '| makeresults' },
        ];
        const { rerender } = renderThemed(
            <Canvas steps={loose} edges={[]} selected={null} issues={[]} onSelect={jest.fn()} onConnect={jest.fn()} onAddFrom={jest.fn()} onRequestRemove={jest.fn()} />
        );
        const y = (id: string) => Number((screen.getByTestId(`node-${id}`).getAttribute('transform') || '').match(/,(-?[\d.]+)\)/)?.[1]);
        expect(y('a')).toBe(y('b'));
        rerender(
            <SplunkThemeProvider family="enterprise" colorScheme="light" density="comfortable">
                <Canvas steps={loose} edges={[{ from: 'a', to: 'b' }]} selected={null} issues={[]} onSelect={jest.fn()} onConnect={jest.fn()} onAddFrom={jest.fn()} onRequestRemove={jest.fn()} />
            </SplunkThemeProvider>
        );
        expect(y('b')).toBeGreaterThan(y('a'));
    });

    test('GraphView shows status text per step', () => {
        renderThemed(
            <GraphView steps={steps} edges={edges} statusByStep={{ daily: { state: 'failed' }, weekly: { state: 'waiting' } }} />
        );
        expect(screen.getByText('Failed')).toBeInTheDocument();
        expect(screen.getByText('Waiting')).toBeInTheDocument();
    });
});
