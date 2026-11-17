import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import BuilderPage from '../features/builder/BuilderPage';
import { fakeApi } from './builderFixtures';
import { renderThemed } from './fixtures';

async function show() {
    renderThemed(<BuilderPage jobId="rollups" api={fakeApi()} />);
    await act(async () => {
        await Promise.resolve();
    });
    await screen.findByRole('button', { name: /^Search Weekly rollup/ });
}

const names = () => screen.getAllByRole('menuitem').map((r) => r.textContent);
const shiftClick = (key: string) => {
    const canvas = screen.getByRole('group', { name: /^Job flow/ });
    const node = screen.getByTestId(`node-${key}`);
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(node.getAttribute('transform') || '');
    const at = { clientX: Number(m![1]) + 20, clientY: Number(m![2]) + 20, shiftKey: true };
    fireEvent.pointerDown(node, at);
    fireEvent.pointerUp(canvas, at);
};

describe('BuilderPage right-click menu', () => {
    it('right-click on a node selects it and lists its actions', async () => {
        await show();
        fireEvent.contextMenu(screen.getByTestId('node-step:weekly'), { clientX: 300, clientY: 200 });
        expect(screen.getByRole('menu', { name: 'Node' })).toBeInTheDocument();
        expect(names()).toEqual(['Rename', 'Duplicate', 'Copy', 'Preview', 'Add a line', 'Remove']);
        expect(screen.getByRole('region', { name: /Weekly rollup/ })).toBeInTheDocument();
    });

    it('the browser menu is prevented over the canvas', async () => {
        await show();
        const notCancelled = fireEvent.contextMenu(screen.getByRole('group', { name: /^Job flow/ }));
        expect(notCancelled).toBe(false);
        expect(fireEvent.contextMenu(document.body)).toBe(true);
    });

    it('Shift+F10 on a focused node opens the same menu; Escape closes and returns focus', async () => {
        await show();
        const node = screen.getByRole('button', { name: /^Search Weekly rollup/ });
        node.focus();
        fireEvent.keyDown(node, { key: 'F10', shiftKey: true });
        expect(names()).toEqual(['Rename', 'Duplicate', 'Copy', 'Preview', 'Add a line', 'Remove']);
        fireEvent.keyDown(screen.getByRole('menu', { name: 'Node' }), { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.getByRole('button', { name: /^Search Weekly rollup/ })).toHaveFocus();
    });

    it('the Menu key works too', async () => {
        await show();
        const node = screen.getByRole('button', { name: /^Search Weekly rollup/ });
        node.focus();
        fireEvent.keyDown(node, { key: 'ContextMenu' });
        expect(screen.getByRole('menu', { name: 'Node' })).toBeInTheDocument();
    });

    it('Rename selects the node and focuses the name field', async () => {
        await show();
        fireEvent.contextMenu(screen.getByTestId('node-step:weekly'), { clientX: 300, clientY: 200 });
        fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
        await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus());
    });

    it('Remove asks first', async () => {
        await show();
        fireEvent.contextMenu(screen.getByTestId('node-step:weekly'), { clientX: 300, clientY: 200 });
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
        expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('Add a line opens the When list', async () => {
        await show();
        fireEvent.contextMenu(screen.getByTestId('node-step:weekly'), { clientX: 300, clientY: 200 });
        fireEvent.click(screen.getByRole('menuitem', { name: 'Add a line' }));
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.getByRole('listbox', { name: 'When' })).toBeInTheDocument();
    });

    it('the canvas menu has Add node here, Paste and Tidy up; Add node here opens the node search', async () => {
        await show();
        fireEvent.contextMenu(screen.getByRole('group', { name: /^Job flow/ }), { clientX: 50, clientY: 60 });
        expect(screen.getByRole('menu', { name: 'Canvas' })).toBeInTheDocument();
        expect(names()).toEqual(['Add node here', 'Paste', 'Tidy up']);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Add node here' }));
        expect(screen.getByPlaceholderText('Search for a node')).toBeInTheDocument();
    });

    it('a multi-selection keeps its selection on right-click and lists the group actions', async () => {
        await show();
        shiftClick('step:daily');
        shiftClick('step:weekly');
        fireEvent.contextMenu(screen.getByTestId('node-step:weekly'), { clientX: 300, clientY: 200 });
        expect(names()).toEqual(['Duplicate', 'Copy', 'Align…', 'Distribute…Select three or more nodes', 'Tidy up selection', 'Group', 'Remove nodes']);
        expect(screen.getByRole('heading', { name: '2 nodes selected' })).toBeInTheDocument();
    });

    it('Align… opens a second list; Distribute… is dimmed for two nodes', async () => {
        await show();
        shiftClick('step:daily');
        shiftClick('step:weekly');
        fireEvent.contextMenu(screen.getByTestId('node-step:weekly'), { clientX: 300, clientY: 200 });
        expect(screen.getByRole('menuitem', { name: /Distribute…/ })).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(screen.getByRole('menuitem', { name: 'Align…' }));
        expect(names()).toEqual(['Align left', 'Align centres', 'Align right', 'Align top', 'Align middles', 'Align bottom']);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Align top' }));
        const top = (k: string) => /translate\([-\d.]+,([-\d.]+)\)/.exec(screen.getByTestId(`node-${k}`).getAttribute('transform') || '')![1];
        expect(top('step:daily')).toBe(top('step:weekly'));
    });

    it('the selection panel aligns too, and dims Distribute for two nodes', async () => {
        await show();
        shiftClick('step:daily');
        shiftClick('step:weekly');
        expect(screen.getByRole('button', { name: 'Distribute horizontally' })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByText('Select three or more nodes')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Align left' }));
        const left = (k: string) => /translate\(([-\d.]+),/.exec(screen.getByTestId(`node-${k}`).getAttribute('transform') || '')![1];
        expect(left('step:daily')).toBe(left('step:weekly'));
    });

    it('right-click on a node outside the multi-selection selects only that node', async () => {
        await show();
        shiftClick('step:daily');
        shiftClick('step:weekly');
        fireEvent.contextMenu(screen.getByTestId('node-step:monthly'), { clientX: 300, clientY: 200 });
        expect(names()).toContain('Rename');
        expect(screen.getByRole('region', { name: /Monthly rollup/ })).toBeInTheDocument();
    });

    it('right-click on a line lists the line menu entries', async () => {
        await show();
        const link = document.querySelector('[data-link-hit]') as Element;
        expect(link).not.toBeNull();
        fireEvent.contextMenu(link, { clientX: 300, clientY: 200 });
        expect(screen.getByRole('listbox', { name: 'Line' })).toBeInTheDocument();
        expect(screen.getByText('Remove line')).toBeInTheDocument();
    });
});
