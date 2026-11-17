import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import BuilderPage from '../features/builder/BuilderPage';
import { fakeApi } from './builderFixtures';
import { renderThemed } from './fixtures';

async function show(ui: React.ReactElement) {
    renderThemed(ui);
    await act(async () => {
        await Promise.resolve();
    });
}

const shiftClick = (key: string) => {
    const canvas = screen.getByRole('group', { name: /^Job flow/ });
    const node = screen.getByTestId(`node-${key}`);
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(node.getAttribute('transform') || '');
    const at = { clientX: Number(m![1]) + 20, clientY: Number(m![2]) + 20, shiftKey: true };
    fireEvent.pointerDown(node, at);
    fireEvent.pointerUp(canvas, at);
};

describe('BuilderPage multi-select', () => {
    it('Shift+click two steps shows the selection panel; Remove nodes asks once and Undo brings them back', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        shiftClick('step:daily');
        expect(screen.getByRole('region', { name: /Daily summary/ })).toBeInTheDocument();
        shiftClick('step:weekly');
        expect(screen.getByRole('heading', { name: '2 nodes selected' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Tidy up selection' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove nodes' }));
        expect(screen.getByText('Remove 2 nodes?')).toBeInTheDocument();
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Daily summary')).toBeInTheDocument();
        expect(within(dialog).getByText('Weekly rollup')).toBeInTheDocument();
        expect(within(dialog).getByText('Undo brings them back.')).toBeInTheDocument();
        fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Remove nodes')!);
        await waitFor(() => expect(screen.queryByTestId('node-step:weekly')).toBeNull());
        expect(screen.queryByTestId('node-step:daily')).toBeNull();
        expect(screen.getByTestId('node-step:monthly')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: '2 nodes selected' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(screen.getByTestId('node-step:daily')).toBeInTheDocument();
        expect(screen.getByTestId('node-step:weekly')).toBeInTheDocument();
    });

    it('Delete on a multi-selection opens the same confirm; Shift+click back to one shows that node', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        shiftClick('step:daily');
        shiftClick('step:monthly');
        fireEvent.keyDown(screen.getByTestId('node-step:monthly'), { key: 'Delete' });
        expect(screen.getByText('Remove 2 nodes?')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        shiftClick('step:daily');
        expect(screen.getByRole('region', { name: /Monthly rollup/ })).toBeInTheDocument();
    });

    it('Tidy up selection is one undo step', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        shiftClick('step:daily');
        shiftClick('step:weekly');
        const undo = screen.getByRole('button', { name: 'Undo' });
        expect(undo).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Tidy up selection' }));
        expect(screen.getByRole('button', { name: 'Undo' })).not.toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('heading', { name: '2 nodes selected' })).toBeInTheDocument();
    });

    it('Ctrl+D duplicates the selection, Ctrl+C then Ctrl+V pastes it again, and Undo takes it away', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        const count = () => document.querySelectorAll('[data-node-key^="step:"]').length;
        const before = count();
        shiftClick('step:daily');
        shiftClick('step:monthly');
        const canvas = screen.getByRole('group', { name: /^Job flow/ });
        fireEvent.keyDown(canvas, { key: 'd', ctrlKey: true });
        expect(count()).toBe(before + 2);
        expect(screen.getByTestId('splice-message')).toHaveTextContent(/Pasted 2 nodes/);
        expect(screen.getByRole('heading', { name: '2 nodes selected' })).toBeInTheDocument();
        fireEvent.click(within(screen.getByTestId('splice-message')).getByRole('button', { name: 'Undo' }));
        expect(count()).toBe(before);
        shiftClick('step:daily');
        shiftClick('step:monthly');
        fireEvent.keyDown(canvas, { key: 'c', metaKey: true });
        fireEvent.keyDown(canvas, { key: 'v', metaKey: true });
        await waitFor(() => expect(count()).toBe(before + 2));
    });

    it('the clipboard shortcuts do nothing while typing in a field', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        const before = document.querySelectorAll('[data-node-key^="step:"]').length;
        shiftClick('step:daily');
        shiftClick('step:monthly');
        const field = document.createElement('input');
        screen.getByRole('group', { name: /^Job flow/ }).appendChild(field);
        fireEvent.keyDown(field, { key: 'd', ctrlKey: true });
        expect(document.querySelectorAll('[data-node-key^="step:"]').length).toBe(before);
    });
});
