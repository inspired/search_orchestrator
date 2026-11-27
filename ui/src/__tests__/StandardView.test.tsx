import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BuilderPage from '../features/builder/BuilderPage';
import { setTurnedOff } from '../features/builder/nodeCatalog';
import { fakeApi, rollupJob } from './builderFixtures';
import { me, renderThemed } from './fixtures';

jest.mock('../api/versions');
jest.mock('../api/snippets', () => ({ listSnippets: jest.fn(() => new Promise(() => undefined)) }));

async function show(ui: React.ReactElement) {
    renderThemed(ui);
    await act(async () => {
        await Promise.resolve();
    });
}

beforeEach(() => window.localStorage.setItem('so.builder.view', 'standard'));
afterEach(() => setTurnedOff([]));

const nodeKeys = () => Array.from(document.querySelectorAll('[data-node-key]')).map((n) => n.getAttribute('data-node-key'));

function clickNode(key: string) {
    const el = document.querySelector(`[data-node-key="${key}"]`) as Element;
    fireEvent.pointerDown(el);
    fireEvent.pointerUp(el);
    fireEvent.click(el);
}

const withExtras = () =>
    rollupJob({
        steps: [
            { id: 'daily', name: 'Daily summary', type: 'inline', spl: '| makeresults', actions: [{ hook: 'on_failure', type: 'email', to: 'ops@example.com' }] },
            { id: 'weekly', name: 'Weekly rollup', type: 'saved_search', saved_search_ref: 'Weekly rollup' },
            { id: 'gate', name: 'Gate', type: 'approval', approval: {} },
        ],
        edges: [
            { from: 'daily', to: 'weekly', condition: 'expression', expression: '$daily.resultCount$ > 0' },
            { from: 'weekly', to: 'gate', condition: 'on_success' },
        ],
        actions: [{ hook: 'on_failure', type: 'email', to: 'boss@example.com' }],
    });

describe('Standard view', () => {
    test('Standard draws steps but no trigger or action nodes', async () => {
        await show(<BuilderPage api={fakeApi({ getJob: jest.fn().mockResolvedValue(withExtras()) })} jobId="rollups" />);
        expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
        expect(nodeKeys().sort()).toEqual(['step:daily', 'step:gate', 'step:weekly']);
        expect(screen.getByTestId('line-label-step:daily-if->step:weekly')).toHaveTextContent('◇ $daily.resultCount$ > 0');
    });

    test('clicking a condition line opens its EdgePanel', async () => {
        await show(<BuilderPage api={fakeApi({ getJob: jest.fn().mockResolvedValue(withExtras()) })} jobId="rollups" />);
        const g = screen.getByTestId('link-step:daily-if->step:weekly');
        const paths = g.querySelectorAll('path');
        const hit = paths[paths.length - 1];
        fireEvent.pointerDown(hit);
        fireEvent.click(hit);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Remove dependency' })).toBeInTheDocument());
    });

    test('Add action on a step adds it with the chosen When', async () => {
        const user = userEvent.setup();
        const api = fakeApi();
        await show(<BuilderPage api={api} jobId="rollups" />);
        clickNode('step:daily');
        const section = await screen.findByRole('region', { name: 'Actions' });
        await user.click(within(section).getByRole('button', { name: 'Add action' }));
        await user.click(within(section).getByLabelText('When'));
        await user.click(screen.getByRole('option', { name: 'Fails' }));
        await user.click(within(section).getByLabelText('Action'));
        await user.click(screen.getByRole('option', { name: /^Email/ }));
        await user.click(within(section).getByRole('button', { name: 'Add' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalled());
        const sent = (api.updateJob as jest.Mock).mock.calls[0][1];
        expect(sent.steps.find((s: { id: string }) => s.id === 'daily').actions[0].hook).toBe('on_failure');
        expect(nodeKeys().filter((k) => k && k.startsWith('action:'))).toEqual([]);
    });

    test('approval step offers Asks for approval', async () => {
        const user = userEvent.setup();
        await show(<BuilderPage api={fakeApi({ getJob: jest.fn().mockResolvedValue(withExtras()) })} jobId="rollups" />);
        clickNode('step:gate');
        let section = await screen.findByRole('region', { name: 'Actions' });
        await user.click(within(section).getByRole('button', { name: 'Add action' }));
        await user.click(within(section).getByLabelText('When'));
        expect(screen.getByRole('option', { name: 'Asks for approval' })).toBeInTheDocument();
        await user.keyboard('{Escape}');
        clickNode('step:daily');
        section = await screen.findByRole('region', { name: 'Actions' });
        await user.click(within(section).getByRole('button', { name: 'Add action' }));
        await user.click(within(section).getByLabelText('When'));
        expect(screen.queryByRole('option', { name: 'Asks for approval' })).toBeNull();
    });

    test('Add step hides turned-off kinds', async () => {
        const user = userEvent.setup();
        await show(<BuilderPage api={fakeApi({ me: jest.fn().mockResolvedValue({ ...me, turned_off: ['lookup'] }) })} jobId="rollups" />);
        await user.click(screen.getByRole('button', { name: 'Add step' }));
        const items = screen.getAllByRole('menuitem').map((m) => m.textContent || '');
        expect(items.some((t) => t.startsWith('Search'))).toBe(true);
        expect(items.some((t) => t.startsWith('Lookup'))).toBe(false);
    });

    test('Add step adds a step and shows it', async () => {
        const user = userEvent.setup();
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        await user.click(screen.getByRole('button', { name: 'Add step' }));
        await user.click(screen.getAllByRole('menuitem').find((m) => (m.textContent || '').startsWith('Search')) as HTMLElement);
        expect(nodeKeys().filter((k) => k && k.startsWith('step:'))).toHaveLength(4);
    });

    test('switching views keeps the definition and layout', async () => {
        const loaded = withExtras();
        loaded.layout = { nodes: { 'step:daily': { x: 40, y: 60 }, 'trigger:0': { x: 0, y: 0 }, 'action:daily:0': { x: 300, y: 200 } } } as typeof loaded.layout;
        const api = fakeApi({ getJob: jest.fn().mockResolvedValue(loaded) });
        await show(<BuilderPage api={api} jobId="rollups" />);
        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
        fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalled());
        const sent = (api.updateJob as jest.Mock).mock.calls[0][1];
        expect(sent.steps).toEqual(loaded.steps);
        expect(sent.edges).toEqual(loaded.edges);
        expect(sent.triggers).toEqual(loaded.triggers);
        expect(sent.actions).toEqual(loaded.actions);
        expect(sent.layout.nodes['trigger:0']).toEqual({ x: 0, y: 0 });
        expect(sent.layout.nodes['action:daily:0']).toEqual({ x: 300, y: 200 });
    });

    test('a trigger is removed from the Triggers tab after confirming', async () => {
        const api = fakeApi();
        await show(<BuilderPage api={api} jobId="rollups" />);
        fireEvent.click(screen.getByRole('tab', { name: /Triggers/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Remove trigger' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /^Remove/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalled());
        expect((api.updateJob as jest.Mock).mock.calls[0][1].triggers).toEqual([]);
    });

    test('the builder shows no setup checklist', async () => {
        await show(<BuilderPage api={fakeApi()} />);
        expect(screen.queryByText('Set up this job')).toBeNull();
        expect(screen.queryByText(/of 5 done/)).toBeNull();
        expect(screen.queryByRole('button', { name: /Show checklist|Hide checklist/ })).toBeNull();
    });

    test('a line from + dropped on empty canvas adds a step, and offers only steps', async () => {
        const api = fakeApi();
        await show(<BuilderPage api={api} jobId="rollups" />);
        const canvas = screen.getByRole('group', { name: /^Job flow/ });
        fireEvent.pointerDown(screen.getByTestId('plus-step:daily'), { clientX: 0, clientY: 0 });
        fireEvent.pointerMove(canvas, { clientX: 3000, clientY: 3000 });
        fireEvent.pointerUp(canvas, { clientX: 3000, clientY: 3000 });
        expect(screen.queryByRole('option', { name: /^Starts/ })).toBeNull();
        fireEvent.click(screen.getByRole('option', { name: /^Fails/ }));
        const box = screen.getByRole('combobox', { name: 'Add a node' });
        fireEvent.change(box, { target: { value: 'email' } });
        expect(screen.queryByRole('option', { name: /^Email/ })).toBeNull();
        fireEvent.change(box, { target: { value: 'search' } });
        fireEvent.keyDown(box, { key: 'Enter' });
        expect(nodeKeys().filter((k) => k && k.startsWith('step:'))).toHaveLength(4);
        expect(document.querySelector('[data-link-key^="step:daily-failure->step:"]')).not.toBeNull();
    });

    test('a new job opens in Standard even when Advanced was chosen last', async () => {
        window.localStorage.setItem('so.builder.view', 'advanced');
        await show(<BuilderPage api={fakeApi()} />);
        expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
    });

    test("Go to on an action's problem opens the step with that action's panel", async () => {
        const job = rollupJob({
            steps: [{ id: 'daily', name: 'Daily summary', type: 'inline', spl: '| makeresults', actions: [{ hook: 'on_failure', type: 'email', to: 'ops@example.com' }, { hook: 'on_success', type: 'alert_action', action: '' }] }],
            edges: [],
        });
        const issue = { level: 'error', code: 'bad_action', step: 'daily', message: "the email action needs to; fill it in" };
        const api = fakeApi({ getJob: jest.fn().mockResolvedValue(job), validateJob: jest.fn().mockResolvedValue({ issues: [issue], owner_will_change: false, owner: 'alice' }) });
        await show(<BuilderPage api={api} jobId="rollups" />);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        fireEvent.click(await screen.findByRole('button', { name: /^Go to Daily summary/ }));
        const list = await screen.findByRole('list', { name: 'Actions of Daily summary' });
        const buttons = within(list).getAllByRole('button', { expanded: true });
        expect(buttons).toHaveLength(1);
        expect(buttons[0].textContent).toMatch(/Alert action/);
    });

    test("Standard draws no group frames (they belong to Advanced's layout) and keeps them in the job", async () => {
        const group = { id: 'g1', title: 'Daily', color: 'categoricalA3' as const, x: 250, y: 50, w: 300, h: 200 };
        const job = rollupJob({ layout: { nodes: { 'step:daily': { x: 300, y: 100 } }, groups: [group] } });
        const api = fakeApi({ getJob: jest.fn().mockResolvedValue(job) });
        await show(<BuilderPage api={api} jobId="rollups" />);
        await waitFor(() => expect(nodeKeys().length).toBeGreaterThan(0));
        expect(screen.queryByTestId('group-g1')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
        expect(await screen.findByTestId('group-g1')).toBeInTheDocument();
    });
});
