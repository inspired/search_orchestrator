import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import BuilderPage from '../features/builder/BuilderPage';
import { fakeApi, rollupJob } from './builderFixtures';
import { renderThemed } from './fixtures';

jest.mock('../api/snippets', () => ({ listSnippets: jest.fn().mockResolvedValue([]) }));

async function show(api = fakeApi()) {
    renderThemed(<BuilderPage jobId="rollups" api={api} />);
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
        expect(names()).toEqual(['Rename', 'Duplicate', 'Copy', 'Save as snippet', 'Preview', 'Add a line', 'Remove']);
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
        expect(names()).toEqual(['Rename', 'Duplicate', 'Copy', 'Save as snippet', 'Preview', 'Add a line', 'Remove']);
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

    it('Save as snippet from the keyboard opens the save dialog', async () => {
        await show();
        const node = screen.getByRole('button', { name: /^Search Weekly rollup/ });
        node.focus();
        fireEvent.keyDown(node, { key: 'F10', shiftKey: true });
        const menu = screen.getByRole('menu', { name: 'Node' });
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        fireEvent.keyDown(menu, { key: 'Enter' });
        expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Save as snippet' })).toBeInTheDocument();
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
        // Its snippets load (none here).
        await waitFor(() => expect(screen.queryByText('Loading snippets…')).toBeNull());
    });

    it('a multi-selection keeps its selection on right-click and lists the group actions', async () => {
        await show();
        shiftClick('step:daily');
        shiftClick('step:weekly');
        fireEvent.contextMenu(screen.getByTestId('node-step:weekly'), { clientX: 300, clientY: 200 });
        expect(names()).toEqual(['Duplicate', 'Copy', 'Save as snippet', 'Align…', 'Distribute…Select three or more nodes', 'Tidy up selection', 'Group', 'Remove nodes']);
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

    describe('actions only: nothing to copy', () => {
        const withActions = () =>
            fakeApi({
                getJob: jest.fn().mockResolvedValue(
                    rollupJob({
                        steps: [
                            { id: 'daily', name: 'Daily summary', type: 'inline', spl: '| makeresults', actions: [{ hook: 'on_failure', type: 'email', to: 'a@b' }, { hook: 'on_success', type: 'email', to: 'c@d' }] },
                            { id: 'weekly', name: 'Weekly rollup', type: 'saved_search', saved_search_ref: 'Weekly rollup' },
                            { id: 'monthly', name: 'Monthly rollup', type: 'inline', spl: '| loadjob $weekly.sid$' },
                        ],
                    })
                ),
            });

        it('a single action has no Duplicate or Copy', async () => {
            await show(withActions());
            fireEvent.contextMenu(screen.getByTestId('node-action:daily:0'), { clientX: 300, clientY: 200 });
            expect(names()).not.toContain('Duplicate');
            expect(names()).not.toContain('Copy');
            expect(names()).not.toContain('Save as snippet');
        });

        it('a selection of actions only has no Duplicate or Copy, and Ctrl+D and Ctrl+C are left alone', async () => {
            await show(withActions());
            shiftClick('action:daily:0');
            shiftClick('action:daily:1');
            fireEvent.contextMenu(screen.getByTestId('node-action:daily:1'), { clientX: 300, clientY: 200 });
            expect(names()).toEqual(['Align…', 'Distribute…Select three or more nodes', 'Tidy up selection', 'Group', 'Remove nodes']);
            fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
            const canvas = screen.getByRole('group', { name: /^Job flow/ });
            expect(fireEvent.keyDown(canvas, { key: 'd', ctrlKey: true })).toBe(true);
            expect(fireEvent.keyDown(canvas, { key: 'c', ctrlKey: true })).toBe(true);
            expect(screen.queryByTestId('splice-message')).toBeNull();
        });

        it('an action with a step keeps Duplicate and Copy', async () => {
            await show(withActions());
            shiftClick('action:daily:0');
            shiftClick('step:daily');
            fireEvent.contextMenu(screen.getByTestId('node-step:daily'), { clientX: 300, clientY: 200 });
            expect(names().slice(0, 2)).toEqual(['Duplicate', 'Copy']);
        });
    });

    it('Preview is offered for every step: results of earlier steps too, dimmed with the reason for summary index and lookup', async () => {
        const job = rollupJob({
            steps: [
                ...rollupJob().steps,
                { id: 'prev', name: 'Combine', type: 'previous', spl: '| stats count' },
                { id: 'summary', name: 'Write summary', type: 'previous', spl: '| collect index=x', output: { kind: 'summary_index', index: 'x', add_run_id: true } },
            ],
            edges: [...(rollupJob().edges || []), { from: 'monthly', to: 'prev', condition: 'on_success' }, { from: 'prev', to: 'summary', condition: 'on_success' }],
        });
        await show(fakeApi({ getJob: jest.fn().mockResolvedValue(job) }));
        fireEvent.contextMenu(screen.getByTestId('node-step:prev'), { clientX: 300, clientY: 200 });
        expect(screen.getByRole('menuitem', { name: 'Preview' })).not.toHaveAttribute('aria-disabled', 'true');
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
        fireEvent.contextMenu(screen.getByTestId('node-step:summary'), { clientX: 300, clientY: 200 });
        const item = screen.getByRole('menuitem', { name: /^Preview/ });
        expect(item).toHaveAttribute('aria-disabled', 'true');
        expect(item).toHaveTextContent("Previews don't write to indexes or lookups; preview the step before it.");
    });
});
