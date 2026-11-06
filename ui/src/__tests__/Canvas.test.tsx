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

    test('GraphView shows status text per step', () => {
        renderThemed(
            <GraphView steps={steps} edges={edges} statusByStep={{ daily: { state: 'failed' }, weekly: { state: 'waiting' } }} />
        );
        expect(screen.getByText('Failed')).toBeInTheDocument();
        expect(screen.getByText('Waiting')).toBeInTheDocument();
    });
});
