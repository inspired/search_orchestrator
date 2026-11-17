import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import BuilderPage from '../features/builder/BuilderPage';
import type { JobDefinition } from '../api/types';
import { fakeApi, rollupJob } from './builderFixtures';
import { renderThemed } from './fixtures';

async function show(ui: React.ReactElement) {
    renderThemed(ui);
    await act(async () => {
        await Promise.resolve();
    });
}

const nodes = {
    'trigger:0': { x: 0, y: 0 },
    job: { x: 0, y: 600 },
    'step:daily': { x: 300, y: 100 },
    'step:weekly': { x: 600, y: 100 },
    'step:monthly': { x: 900, y: 100 },
};
const daily = { id: 'g1', title: 'Daily', color: 'categoricalA3' as const, x: 250, y: 50, w: 300, h: 200 };

const shiftClick = (key: string) => {
    const canvas = screen.getByRole('group', { name: /^Job flow/ });
    const node = screen.getByTestId(`node-${key}`);
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(node.getAttribute('transform') || '');
    const at = { clientX: Number(m![1]) + 20, clientY: Number(m![2]) + 20, shiftKey: true };
    fireEvent.pointerDown(node, at);
    fireEvent.pointerUp(canvas, at);
};

const savedLayout = (api: ReturnType<typeof fakeApi>) => ((api.updateJob as jest.Mock).mock.calls[0][1] as JobDefinition).layout;

describe('BuilderPage groups', () => {
    it('Ctrl+G groups the selection; the group panel edits title, colour and collapse; Save sends layout.groups', async () => {
        const api = fakeApi({ getJob: jest.fn().mockResolvedValue(rollupJob({ layout: { nodes } })) });
        await show(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        shiftClick('step:daily');
        shiftClick('step:weekly');
        fireEvent.keyDown(screen.getByTestId('node-step:weekly'), { key: 'g', ctrlKey: true });
        const frame = screen.getByTestId('group-g1');
        expect(frame).toHaveTextContent('Group');
        // daily and weekly with 24 px around them and a 28 px title bar.
        expect(screen.getByTestId('group-body-g1')).toHaveAttribute('x', '276');
        expect(screen.getByTestId('group-body-g1')).toHaveAttribute('y', '48');
        const panel = screen.getByRole('region', { name: 'Group' });
        const title = within(panel).getByRole('textbox', { name: 'Title' });
        expect(title).toHaveValue('Group');
        fireEvent.change(title, { target: { value: 'Rollups' } });
        expect(screen.getByTestId('group-g1')).toHaveTextContent('Rollups');
        fireEvent.click(within(panel).getByRole('button', { name: 'Collapse' }));
        expect(screen.getByTestId('group-block-g1')).toHaveTextContent('2 nodes');
        expect(screen.queryByTestId('node-step:daily')).toBeNull();
        fireEvent.click(within(panel).getByRole('button', { name: 'Expand' }));
        expect(screen.getByTestId('node-step:daily')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalledTimes(1));
        const layout = savedLayout(api);
        expect(layout && layout.groups).toEqual([{ id: 'g1', title: 'Rollups', color: 'categoricalA2', x: 276, y: 48, w: 548, h: 152 }]);
    });

    it('the multi-selection menu has Group', async () => {
        const api = fakeApi({ getJob: jest.fn().mockResolvedValue(rollupJob({ layout: { nodes } })) });
        await show(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        shiftClick('step:daily');
        shiftClick('step:weekly');
        fireEvent.contextMenu(screen.getByTestId('node-step:weekly'), { clientX: 620, clientY: 120 });
        fireEvent.click(within(screen.getByRole('menu', { name: 'Selected nodes' })).getByRole('menuitem', { name: 'Group' }));
        expect(screen.getByTestId('group-g1')).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Group' })).toBeInTheDocument();
    });

    it('Remove group asks first; the nodes stay; Undo brings the group back', async () => {
        const api = fakeApi({ getJob: jest.fn().mockResolvedValue(rollupJob({ layout: { nodes, groups: [daily] } })) });
        await show(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        const g = document.querySelector('[data-group-id="g1"]') as HTMLElement;
        fireEvent.keyDown(g, { key: 'Delete' });
        expect(screen.getByText('Remove group Daily?')).toBeInTheDocument();
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('The nodes in it stay.')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Remove group' }));
        await waitFor(() => expect(screen.queryByTestId('group-g1')).toBeNull());
        expect(screen.getByTestId('node-step:daily')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(screen.getByTestId('group-g1')).toBeInTheDocument();
    });

    it('the panel Remove group button and a double-click on the title', async () => {
        const api = fakeApi({ getJob: jest.fn().mockResolvedValue(rollupJob({ layout: { nodes, groups: [daily] } })) });
        await show(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        fireEvent.doubleClick(screen.getByTestId('group-title-g1'));
        const panel = screen.getByRole('region', { name: 'Group' });
        await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole('textbox', { name: 'Title' })));
        expect(within(panel).getByText('Teal')).toBeInTheDocument();
        fireEvent.click(within(panel).getByRole('button', { name: 'Remove group' }));
        expect(screen.getByText('Remove group Daily?')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByTestId('group-g1')).toBeInTheDocument();
    });

    it('going to an issue on a node inside a collapsed group expands the group first', async () => {
        const job = rollupJob({
            layout: { nodes, groups: [{ ...daily, collapsed: true }] },
            steps: [
                { id: 'daily', name: 'Daily summary', type: 'inline', spl: '' },
                { id: 'weekly', name: 'Weekly rollup', type: 'saved_search', saved_search_ref: 'Weekly rollup' },
                { id: 'monthly', name: 'Monthly rollup', type: 'inline', spl: '| loadjob $weekly.sid$' },
            ],
        });
        const api = fakeApi({ getJob: jest.fn().mockResolvedValue(job) });
        await show(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        expect(screen.queryByTestId('node-step:daily')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        fireEvent.click(await screen.findByRole('button', { name: /^Go to Daily summary/ }));
        expect(screen.getByTestId('node-step:daily')).toBeInTheDocument();
        expect(screen.queryByTestId('group-block-g1')).toBeNull();
        expect(screen.getByRole('region', { name: /Daily summary/ })).toBeInTheDocument();
    });

    it('opening and saving a job with groups but no node positions keeps its layout as it was', async () => {
        const api = fakeApi({ getJob: jest.fn().mockResolvedValue(rollupJob({ layout: { groups: [daily] } })) });
        await show(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalledTimes(1));
        expect(savedLayout(api)).toEqual({ groups: [daily] });
    });
});
