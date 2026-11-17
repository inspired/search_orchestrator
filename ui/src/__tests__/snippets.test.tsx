import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../api/client';
import * as snippetApi from '../api/snippets';
import type { SnippetInfo } from '../api/snippets';
import type { Me } from '../api/types';
import BuilderPage from '../features/builder/BuilderPage';
import type { Clip } from '../features/builder/clipboard';
import SnippetsDialog from '../features/builder/SnippetsDialog';
import { fakeApi } from './builderFixtures';
import { me, renderThemed } from './fixtures';

jest.mock('../api/snippets');
const api = snippetApi as jest.Mocked<typeof snippetApi>;

const hourly: SnippetInfo = { id: 'sn0123456789ab', name: 'Hourly checks', description: 'Count errors each hour', owner: 'alice', updated_at: 1762390800, node_count: 3 };
const nightly: SnippetInfo = { id: 'sn0123456789cd', name: 'Nightly', description: 'Runs hourly too, at night', owner: 'bob', updated_at: 1762390800, node_count: 1 };

/** Three nodes: a search with an email, and a step that needs a line into it. */
const hourlyClip: Clip = {
    so_clipboard: 1,
    steps: [
        { id: 'daily', name: 'Count errors', type: 'inline', spl: '| makeresults', actions: [{ hook: 'on_failure', type: 'email', to: 'a@b' }] },
        { id: 'tail', name: 'Tail', type: 'previous', spl: '| stats count' },
    ],
    edges: [],
    job_actions: [],
    triggers: [],
    positions: { 'step:daily': { x: 0, y: 0 }, 'step:tail': { x: 200, y: 0 } },
};

beforeEach(() => {
    jest.resetAllMocks();
    api.listSnippets.mockResolvedValue([hourly, nightly]);
    api.getSnippet.mockResolvedValue({ ...hourly, content: hourlyClip });
    api.createSnippet.mockResolvedValue(hourly);
});

async function show() {
    renderThemed(<BuilderPage jobId="rollups" api={fakeApi()} />);
    await act(async () => {
        await Promise.resolve();
    });
    await screen.findByRole('button', { name: /^Search Weekly rollup/ });
}

const shiftClick = (key: string) => {
    const canvas = screen.getByRole('group', { name: /^Job flow/ });
    const node = screen.getByTestId(`node-${key}`);
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(node.getAttribute('transform') || '');
    const at = { clientX: Number(m![1]) + 20, clientY: Number(m![2]) + 20, shiftKey: true };
    fireEvent.pointerDown(node, at);
    fireEvent.pointerUp(canvas, at);
};

const stepNodes = () => screen.getAllByTestId(/^node-step:/).map((n) => n.getAttribute('data-testid'));

async function openQuickAdd() {
    fireEvent.contextMenu(screen.getByRole('group', { name: /^Job flow/ }), { clientX: 50, clientY: 60 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add node here' }));
    await act(async () => {
        await Promise.resolve();
    });
    return screen.getByRole('combobox', { name: 'Add a node' });
}

describe('Save as snippet', () => {
    it('sends the clip Copy would make, with the typed name, and says who can see it', async () => {
        await show();
        shiftClick('step:daily');
        shiftClick('step:weekly');
        fireEvent.click(screen.getByRole('button', { name: 'Save as snippet' }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Everyone who can build jobs can see and insert this snippet, including its searches.')).toBeInTheDocument();
        fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Hourly checks' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save snippet' }));
        await waitFor(() => expect(api.createSnippet).toHaveBeenCalled());
        const sent = api.createSnippet.mock.calls[0][0];
        expect(sent.name).toBe('Hourly checks');
        expect(sent.description).toBe('');
        expect(sent.content.so_clipboard).toBe(1);
        expect(sent.content.steps.map((s) => s.id)).toEqual(['daily', 'weekly']);
        expect(sent.content.edges).toEqual([{ from: 'daily', to: 'weekly', condition: 'on_success' }]);
        expect(Object.keys(sent.content.positions).sort()).toEqual(['step:daily', 'step:weekly']);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('is on the right-click menu of a node too', async () => {
        await show();
        fireEvent.contextMenu(screen.getByTestId('node-step:weekly'), { clientX: 300, clientY: 200 });
        fireEvent.click(screen.getByRole('menuitem', { name: 'Save as snippet' }));
        fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Name'), { target: { value: 'Weekly' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }));
        await waitFor(() => expect(api.createSnippet).toHaveBeenCalled());
        expect(api.createSnippet.mock.calls[0][0].content.steps.map((s) => s.id)).toEqual(['weekly']);
    });

    it('shows the 409 message and stays open', async () => {
        api.createSnippet.mockRejectedValue(new ApiError(409, 'snippet_exists', 'A snippet named Hourly checks already exists; pick another name'));
        await show();
        shiftClick('step:daily');
        shiftClick('step:weekly');
        fireEvent.click(screen.getByRole('button', { name: 'Save as snippet' }));
        fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Name'), { target: { value: 'hourly checks' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }));
        expect(await screen.findByText('A snippet named Hourly checks already exists; pick another name')).toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
});

describe('Inserting a snippet', () => {
    it('quick-add lists matching snippets by name and description', async () => {
        await show();
        const box = await openQuickAdd();
        fireEvent.change(box, { target: { value: 'hourly' } });
        const group = await screen.findByRole('group', { name: 'Snippets' });
        expect(within(group).getAllByRole('option').map((o) => o.textContent)).toEqual([
            expect.stringContaining('Hourly checks'),
            expect.stringContaining('Nightly'),
        ]);
    });

    it('inserts with new ids as one undo step and says what it added', async () => {
        await show();
        const before = stepNodes();
        const box = await openQuickAdd();
        fireEvent.change(box, { target: { value: 'hourly' } });
        fireEvent.click(await screen.findByRole('option', { name: /^Hourly checks/ }));
        await waitFor(() => expect(screen.getByTestId('splice-message')).toHaveTextContent('Inserted Hourly checks: 3 nodes; 1 needs a line into it'));
        expect(api.getSnippet).toHaveBeenCalledWith('sn0123456789ab');
        const after = stepNodes();
        expect(after).toHaveLength(before.length + 2);
        // daily is taken: it gets a new id; tail is free and keeps its own.
        expect(after.filter((k) => !before.includes(k))).toEqual([expect.not.stringMatching(/^node-step:daily$/), 'node-step:tail']);
        expect(screen.queryByRole('combobox', { name: 'Add a node' })).toBeNull();
        // The toolbar's Undo: one step takes all of it away.
        fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
        expect(stepNodes()).toEqual(before);
    });

    it('a quick-add from a + handle has no Snippets section', async () => {
        await show();
        const canvas = screen.getByRole('group', { name: /^Job flow/ });
        fireEvent.pointerDown(screen.getByTestId('plus-step:daily'), { clientX: 0, clientY: 0 });
        fireEvent.pointerMove(canvas, { clientX: 3000, clientY: 3000 });
        fireEvent.pointerUp(canvas, { clientX: 3000, clientY: 3000 });
        fireEvent.click(screen.getByRole('option', { name: /^Succeeds/ }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Add a node' }), { target: { value: 'hourly' } });
        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.queryByRole('group', { name: 'Snippets' })).toBeNull();
        expect(api.listSnippets).not.toHaveBeenCalled();
    });

    it('a list that fails to load says why', async () => {
        api.listSnippets.mockRejectedValue(new ApiError(500, 'internal', 'KV store is down'));
        await show();
        await openQuickAdd();
        expect(await screen.findByText("Snippets couldn't load: KV store is down")).toBeInTheDocument();
    });
});

describe('the Snippets… toolbar button', () => {
    it('opens the list of snippets', async () => {
        await show();
        fireEvent.click(screen.getByRole('button', { name: 'Snippets…' }));
        const dialog = await screen.findByRole('dialog');
        expect(await within(dialog).findByRole('row', { name: /Hourly checks/ })).toBeInTheDocument();
        expect(api.listSnippets).toHaveBeenCalled();
    });
});

describe('SnippetsDialog', () => {
    const admin: Me = { ...me, user: 'carol', can_admin: true };
    function open(who: Me, over: Partial<React.ComponentProps<typeof SnippetsDialog>> = {}) {
        const props = {
            snippets: [hourly, nightly],
            error: null,
            me: who,
            onRename: jest.fn().mockResolvedValue(undefined),
            onDelete: jest.fn().mockResolvedValue(undefined),
            onClose: jest.fn(),
            ...over,
        };
        renderThemed(<SnippetsDialog {...props} />);
        return props;
    }
    const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

    it('lists name, owner and nodes; Rename and Delete only on the owner’s own', () => {
        open(me);
        const mine = rowOf('Hourly checks');
        expect(mine).toHaveTextContent('alice');
        expect(mine).toHaveTextContent('3');
        expect(within(mine).getByRole('button', { name: 'Rename' })).toBeInTheDocument();
        expect(within(mine).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        const theirs = rowOf('Nightly');
        expect(within(theirs).queryByRole('button', { name: 'Rename' })).toBeNull();
        expect(within(theirs).queryByRole('button', { name: 'Delete' })).toBeNull();
    });

    it('an admin can rename and delete every snippet', () => {
        open(admin);
        expect(within(rowOf('Nightly')).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        expect(within(rowOf('Hourly checks')).getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    });

    it('Delete asks first', async () => {
        const props = open(me);
        fireEvent.click(within(rowOf('Hourly checks')).getByRole('button', { name: 'Delete' }));
        expect(screen.getByRole('heading', { name: 'Delete snippet Hourly checks?' })).toBeInTheDocument();
        expect(props.onDelete).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Delete snippet' }));
        await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith('sn0123456789ab'));
    });

    it('Rename sends the new name and description', async () => {
        const props = open(me);
        fireEvent.click(within(rowOf('Hourly checks')).getByRole('button', { name: 'Rename' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Hourly error checks' } });
        fireEvent.click(screen.getByRole('button', { name: 'Rename snippet' }));
        await waitFor(() => expect(props.onRename).toHaveBeenCalledWith('sn0123456789ab', { name: 'Hourly error checks', description: 'Count errors each hour' }));
    });

    it('a failed list says why', () => {
        open(me, { snippets: null, error: "Snippets couldn't load: KV store is down" });
        expect(screen.getByText("Snippets couldn't load: KV store is down")).toBeInTheDocument();
    });
});
