import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import BuilderPage from '../features/builder/BuilderPage';
import Canvas from '../features/builder/Canvas';
import { autoLayout } from '../features/builder/graphLogic';
import GraphView from '../features/builder/GraphView';
import { fakeApi } from './builderFixtures';
import { renderThemed } from './fixtures';

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
                positions={autoLayout(steps, edges)}
                selected={null}
                issues={[]}
                onSelect={onSelect}
                onMove={jest.fn()}
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
                positions={autoLayout(steps, edges)}
                selected={null}
                issues={[]}
                onSelect={jest.fn()}
                onMove={jest.fn()}
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

    test('GraphView shows status text per step', () => {
        renderThemed(
            <GraphView steps={steps} edges={edges} statusByStep={{ daily: { state: 'failed' }, weekly: { state: 'waiting' } }} />
        );
        expect(screen.getByText('Failed')).toBeInTheDocument();
        expect(screen.getByText('Waiting')).toBeInTheDocument();
    });
});
