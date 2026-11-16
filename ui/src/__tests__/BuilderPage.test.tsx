import React from 'react';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import BuilderPage from '../features/builder/BuilderPage';
import { fakeApi, rollupJob } from './builderFixtures';
import { renderThemed, runSummary } from './fixtures';

/** Renders and lets the page's start-up requests settle. */
async function show(ui: React.ReactElement) {
    renderThemed(ui);
    await act(async () => {
        await Promise.resolve();
    });
}

const nodes = () => document.querySelectorAll('[data-node-key^="step:"]');

describe('BuilderPage templates', () => {
    it('shows the picker for a new job', async () => {
        await show(<BuilderPage api={fakeApi()} />);
        expect(screen.getByRole('heading', { name: 'Start a new job' })).toBeInTheDocument();
        ['Daily, weekly and monthly rollup', 'One search after another', 'Run searches side by side, then combine', 'Blank job'].forEach((t) =>
            expect(screen.getByText(t)).toBeInTheDocument()
        );
        expect(screen.queryByRole('tab')).toBeNull();
    });

    it('choosing a template shows its steps, as one undo step', async () => {
        await show(<BuilderPage api={fakeApi()} />);
        fireEvent.click(screen.getByText('Daily, weekly and monthly rollup'));
        expect(screen.queryByRole('heading', { name: 'Start a new job' })).toBeNull();
        expect(nodes()).toHaveLength(3);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(nodes()).toHaveLength(0);
        expect(screen.queryByRole('heading', { name: 'Start a new job' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('lists each template as a button named by its title', async () => {
        await show(<BuilderPage api={fakeApi()} />);
        ['Daily, weekly and monthly rollup', 'One search after another', 'Run searches side by side, then combine', 'Blank job'].forEach((t) =>
            expect(screen.getByRole('button', { name: new RegExp(t) })).toBeInTheDocument()
        );
    });

    it('opens a template from the keyboard and selects its first step', async () => {
        await show(<BuilderPage api={fakeApi()} />);
        const card = screen.getByRole('button', { name: /Daily, weekly and monthly rollup/ });
        card.focus();
        expect(card).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        expect(nodes()).toHaveLength(3);
        expect(screen.getByRole('region', { name: /Daily summary/ })).toBeInTheDocument();
    });

    it('skips the picker for a known template', async () => {
        await show(<BuilderPage api={fakeApi()} template="rollup" />);
        expect(screen.queryByRole('heading', { name: 'Start a new job' })).toBeNull();
        expect(nodes()).toHaveLength(3);
    });

    it('shows the picker for an unknown template', async () => {
        await show(<BuilderPage api={fakeApi()} template="nope" />);
        expect(screen.getByRole('heading', { name: 'Start a new job' })).toBeInTheDocument();
    });

    it('never shows the picker when editing a job', async () => {
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        await waitFor(() => expect(nodes()).toHaveLength(3));
        expect(screen.queryByRole('heading', { name: 'Start a new job' })).toBeNull();
    });
});

describe('BuilderPage unsaved changes', () => {
    const leave = () => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event;
    };

    it('does not stop a clean page from closing', async () => {
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        expect(leave().defaultPrevented).toBe(false);
    });

    it('asks before closing once the job is edited, and not after it is saved', async () => {
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        fireEvent.change(screen.getByLabelText('Job name'), { target: { value: 'Renamed' } });
        expect(leave().defaultPrevented).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(screen.getByText('Saved.')).toBeInTheDocument());
        expect(leave().defaultPrevented).toBe(false);
    });

    it('treats a template that was never saved as unsaved', async () => {
        await show(<BuilderPage api={fakeApi()} template="rollup" />);
        expect(leave().defaultPrevented).toBe(true);
    });
});

describe('BuilderPage wording', () => {
    it('the Settings tab words the give-up choice in plain terms', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        fireEvent.click(screen.getByRole('tab', { name: /Settings/ }));
        expect(
            screen.getByText("Waiting stops a rollup running over a missing day. Starting anyway keeps the schedule but can leave gaps.")
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('combobox', { name: 'When a step gives up' }));
        expect(screen.getByRole('option', { name: 'Wait for this run to be fixed' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Start later runs anyway' })).toBeInTheDocument();
    });

    it('the remove-step confirmation names the step and says undo brings it back', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        const node = await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        fireEvent.keyDown(node, { key: 'Delete' });
        expect(await screen.findByText('Weekly rollup and its connections are removed. Undo brings them back.')).toBeInTheDocument();
    });
});

describe('BuilderPage flow', () => {
    it('shows the tabs Flow, Parameters, Access and Settings', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Flow', 'Parameters', 'Access', 'Settings']);
        expect(screen.queryByRole('tab', { name: /Triggers/ })).toBeNull();
        expect(screen.queryByRole('tab', { name: /Actions/ })).toBeNull();
        expect(screen.getByRole('group', { name: /^Job flow/ })).toBeInTheDocument();
    });

    it('says how to edit and connect nodes while nothing is selected', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        expect(
            screen.getByText('Select a node to edit it. Drag from a port on the right of a node to connect it, or press / to add a node.')
        ).toBeInTheDocument();
    });

    it('a line from a Failed port dropped on empty canvas adds an email there, and Save sends it', async () => {
        const api = fakeApi();
        await show(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Daily summary/ });
        const canvas = screen.getByRole('group', { name: /^Job flow/ });
        fireEvent.pointerDown(screen.getByTestId('port-step:daily-failure'), { clientX: 0, clientY: 0 });
        fireEvent.pointerMove(canvas, { clientX: 3000, clientY: 3000 });
        fireEvent.pointerUp(canvas, { clientX: 3000, clientY: 3000 });
        const box = screen.getByRole('combobox', { name: 'Add a node' });
        expect(box).toHaveFocus();
        // Only nodes a Failed line can go to: no triggers.
        expect(screen.queryByRole('option', { name: /^Schedule/ })).toBeNull();
        fireEvent.change(box, { target: { value: 'email' } });
        fireEvent.keyDown(box, { key: 'Enter' });
        expect(screen.queryByRole('combobox', { name: 'Add a node' })).toBeNull();
        expect(screen.getByTestId('node-action:daily:0')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('region', { name: 'Action' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalled());
        const saved = (api.updateJob as jest.Mock).mock.calls[0][1];
        const daily = saved.steps.find((st: { id: string }) => st.id === 'daily');
        expect(daily.actions).toEqual([expect.objectContaining({ hook: 'on_failure', type: 'email' })]);
        expect(saved.layout.nodes['action:daily:0']).toEqual({ x: 3000, y: 3000 });
    });

    it('Escape closes quick-add without adding anything', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        await screen.findByRole('button', { name: /^Search Daily summary/ });
        fireEvent.click(screen.getByRole('button', { name: 'Add node' }));
        fireEvent.keyDown(screen.getByRole('combobox', { name: 'Add a node' }), { key: 'Escape' });
        expect(screen.queryByRole('combobox', { name: 'Add a node' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('a line dropped on another step connects them; a line that is not allowed changes nothing', async () => {
        const job = rollupJob({ edges: [] });
        await show(<BuilderPage jobId="rollups" api={fakeApi({ getJob: jest.fn().mockResolvedValue(job) })} />);
        await screen.findByRole('button', { name: /^Search Daily summary/ });
        const canvas = screen.getByRole('group', { name: /^Job flow/ });
        const centre = (key: string) => {
            const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(screen.getByTestId(`node-${key}`).getAttribute('transform') || '');
            return { clientX: Number(m?.[1]) + 20, clientY: Number(m?.[2]) + 20 };
        };
        fireEvent.pointerDown(screen.getByTestId('port-step:daily-success'), centre('step:daily'));
        fireEvent.pointerUp(canvas, centre('step:weekly'));
        expect(screen.getByRole('button', { name: /^Line from Daily summary, Succeeded, to Weekly rollup/ })).toBeInTheDocument();
        // A trigger cannot be the end of a line.
        fireEvent.pointerDown(screen.getByTestId('port-step:weekly-success'), centre('step:weekly'));
        fireEvent.pointerUp(canvas, centre('trigger:0'));
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(screen.queryByRole('button', { name: /^Line from Daily summary/ })).toBeNull();
    });

    it('a line dropped on the selected action keeps that action selected under its new step', async () => {
        const job = rollupJob({
            actions: [
                { hook: 'on_failure', type: 'email', to: 'a@example.com' },
                { hook: 'on_failure', type: 'email', to: 'b@example.com' },
            ],
        });
        await show(<BuilderPage jobId="rollups" api={fakeApi({ getJob: jest.fn().mockResolvedValue(job) })} />);
        await screen.findByRole('button', { name: /^Search Daily summary/ });
        const canvas = screen.getByRole('group', { name: /^Job flow/ });
        const centre = (key: string) => {
            const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(screen.getByTestId(`node-${key}`).getAttribute('transform') || '');
            return { clientX: Number(m?.[1]) + 20, clientY: Number(m?.[2]) + 20 };
        };
        fireEvent.keyDown(screen.getByTestId('node-action:job:0'), { key: 'Enter' });
        expect(screen.getByTestId('node-action:job:0')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.pointerDown(screen.getByTestId('port-step:daily-failure'), centre('step:daily'));
        fireEvent.pointerUp(canvas, centre('action:job:0'));
        expect(screen.getByTestId('node-action:daily:0')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('node-action:job:0')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByLabelText('To')).toHaveValue('a@example.com');
    });

    it('Tidy up drops saved positions as one undo step', async () => {
        const api = fakeApi({ getJob: jest.fn().mockResolvedValue(rollupJob({ layout: { nodes: { 'step:daily': { x: 900, y: 900 } } } })) });
        await show(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Daily summary/ });
        expect(screen.getByTestId('node-step:daily')).toHaveAttribute('transform', 'translate(900,900)');
        fireEvent.click(screen.getByRole('button', { name: 'Tidy up' }));
        expect(screen.getByTestId('node-step:daily')).not.toHaveAttribute('transform', 'translate(900,900)');
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(screen.getByTestId('node-step:daily')).toHaveAttribute('transform', 'translate(900,900)');
    });

    const translate = (key: string) => {
        const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(screen.getByTestId(`node-${key}`).getAttribute('transform') || '');
        return { x: Number(m?.[1]), y: Number(m?.[2]) };
    };

    it('the first drag in a job without a layout keeps every other node where it was, as one undo step', async () => {
        const api = fakeApi();
        await show(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Daily summary/ });
        const keys = ['step:daily', 'step:weekly', 'step:monthly', 'trigger:0'];
        const before = Object.fromEntries(keys.map((k) => [k, translate(k)]));
        const canvas = screen.getByRole('group', { name: /^Job flow/ });
        fireEvent.pointerDown(screen.getByTestId('node-step:weekly'), { clientX: 100, clientY: 100 });
        fireEvent.pointerMove(canvas, { clientX: 120, clientY: 100 });
        fireEvent.pointerUp(canvas, { clientX: 120, clientY: 100 });
        expect(translate('step:weekly')).not.toEqual(before['step:weekly']);
        ['step:daily', 'step:monthly', 'trigger:0'].forEach((k) => expect(translate(k)).toEqual(before[k]));
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        keys.forEach((k) => expect(translate(k)).toEqual(before[k]));
        expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('adding a node at a point in a job without a layout keeps every other node where it was', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        await screen.findByRole('button', { name: /^Search Daily summary/ });
        const keys = ['step:daily', 'step:weekly', 'step:monthly', 'trigger:0'];
        const before = Object.fromEntries(keys.map((k) => [k, translate(k)]));
        const canvas = screen.getByRole('group', { name: /^Job flow/ });
        fireEvent.pointerDown(screen.getByTestId('port-step:daily-failure'), { clientX: 0, clientY: 0 });
        fireEvent.pointerMove(canvas, { clientX: 3000, clientY: 3000 });
        fireEvent.pointerUp(canvas, { clientX: 3000, clientY: 3000 });
        const box = screen.getByRole('combobox', { name: 'Add a node' });
        fireEvent.change(box, { target: { value: 'email' } });
        fireEvent.keyDown(box, { key: 'Enter' });
        expect(translate('action:daily:0')).toEqual({ x: 3000, y: 3000 });
        keys.forEach((k) => expect(translate(k)).toEqual(before[k]));
    });

    it('saving an old job without moving anything sends no layout', async () => {
        const api = fakeApi();
        await show(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Daily summary/ });
        fireEvent.change(screen.getByLabelText('Job name'), { target: { value: 'Renamed' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalled());
        const saved = (api.updateJob as jest.Mock).mock.calls[0][1];
        expect(saved.name).toBe('Renamed');
        expect(saved).not.toHaveProperty('layout');
    });

    it('switching between two nodes of the same kind shows the second one', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        fireEvent.keyDown(await screen.findByRole('button', { name: /^Search Daily summary/ }), { key: 'Enter' });
        expect(screen.getByRole('region', { name: 'Step Daily summary' })).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('button', { name: /^Search Monthly rollup/ }), { key: 'Enter' });
        expect(screen.getByRole('region', { name: 'Step Monthly rollup' })).toBeInTheDocument();
        expect((screen.getByLabelText('Search') as HTMLTextAreaElement).value).toBe('| loadjob $weekly.sid$');
    });
});

describe('BuilderPage removing nodes', () => {
    it('Delete removes a step only after the confirm', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        const node = await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        fireEvent.keyDown(node, { key: 'Delete' });
        expect(screen.getByRole('button', { name: /^Search Weekly rollup/ })).toBeInTheDocument();
        expect(screen.getByText('Remove Weekly rollup?')).toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: 'Remove step' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: /^Search Weekly rollup/ })).toBeNull());
    });

    it('removing a step with actions says its actions go too', async () => {
        const job = rollupJob({
            steps: rollupJob().steps.map((st) => (st.id === 'weekly' ? { ...st, actions: [{ hook: 'on_failure', type: 'email', to: 'ops@example.com' }] } : st)),
        });
        await show(<BuilderPage jobId="rollups" api={fakeApi({ getJob: jest.fn().mockResolvedValue(job) })} />);
        fireEvent.keyDown(await screen.findByRole('button', { name: /^Search Weekly rollup/ }), { key: 'Delete' });
        expect(screen.getByText('Remove Weekly rollup?')).toBeInTheDocument();
        expect(screen.getByText('Weekly rollup, its actions and its connections are removed. Undo brings them back.')).toBeInTheDocument();
    });

    it('a Slack action keeps its capital and an action with nothing filled in has no detail', async () => {
        const job = rollupJob({
            actions: [
                { hook: 'on_failure', type: 'webhook', preset: 'slack', destination: 'ops-channel' },
                { hook: 'on_failure', type: 'email', to: '' },
            ],
        });
        await show(<BuilderPage jobId="rollups" api={fakeApi({ getJob: jest.fn().mockResolvedValue(job) })} />);
        await screen.findByRole('button', { name: /^Search Daily summary/ });
        fireEvent.keyDown(screen.getByTestId('node-action:job:0'), { key: 'Delete' });
        expect(screen.getByText('Remove Slack (ops-channel)?')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.keyDown(screen.getByTestId('node-action:job:1'), { key: 'Delete' });
        expect(screen.getByText('Remove email?')).toBeInTheDocument();
    });

    it('focus moves to the next step after a delete, or the canvas when none remain', async () => {
        await show(<BuilderPage jobId="rollups" api={fakeApi()} />);
        const weekly = await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        weekly.focus();
        fireEvent.keyDown(weekly, { key: 'Delete' });
        fireEvent.click(await screen.findByRole('button', { name: 'Remove step' }));
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Search Monthly rollup/ })));
        for (const name of [/^Search Monthly rollup/, /^Search Daily summary/]) {
            const node = screen.getByRole('button', { name });
            node.focus();
            fireEvent.keyDown(node, { key: 'Delete' });
            fireEvent.click(await screen.findByRole('button', { name: 'Remove step' }));
            // eslint-disable-next-line no-await-in-loop
            await waitFor(() => expect(screen.queryByRole('button', { name })).toBeNull());
        }
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('group', { name: /^Job flow/ })));
    });

    it('removing an action, a trigger or a condition names it and says undo brings it back', async () => {
        const job = rollupJob({
            actions: [{ hook: 'on_failure', type: 'email', to: 'a@b.c' }],
            edges: [
                { from: 'daily', to: 'weekly', condition: 'expression', expression: '1 = 1' },
                { from: 'weekly', to: 'monthly', condition: 'on_success' },
            ],
        });
        await show(<BuilderPage jobId="rollups" api={fakeApi({ getJob: jest.fn().mockResolvedValue(job) })} />);
        await screen.findByRole('button', { name: /^Search Daily summary/ });
        const cases: [string, string, string, string][] = [
            ['action:job:0', 'Remove email (a@b.c)?', 'Email (a@b.c) is removed. Undo brings it back.', 'Remove action'],
            ['trigger:0', 'Remove schedule (Every day at 01:00)?', 'Schedule (Every day at 01:00) is removed. Undo brings it back.', 'Remove trigger'],
            [
                'cond:daily>weekly',
                'Remove the condition from Daily summary to Weekly rollup?',
                'The condition from Daily summary to Weekly rollup is removed. Undo brings it back.',
                'Remove condition',
            ],
        ];
        for (const [key, title, body, button] of cases) {
            fireEvent.keyDown(screen.getByTestId(`node-${key}`), { key: 'Delete' });
            expect(screen.getByText(title)).toBeInTheDocument();
            expect(screen.getByText(body)).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: button }));
            // eslint-disable-next-line no-await-in-loop
            await waitFor(() => expect(screen.queryByTestId(`node-${key}`)).toBeNull());
        }
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(screen.getByTestId('node-cond:daily>weekly')).toBeInTheDocument();
    });
});

describe('BuilderPage previews', () => {
    it('Preview step in the editor previews upstream steps and shows the result', async () => {
        const api = fakeApi();
        await show(<BuilderPage jobId="rollups" api={api} />);
        const weekly = await screen.findByRole('button', { name: /^Search Weekly rollup/ });
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
        fireEvent.keyDown(screen.getByRole('button', { name: /^Search Daily summary/ }), { key: 'Enter' });
        fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: '| makeresults count=2' } });
        expect(screen.getByTestId('note-daily')).toHaveTextContent('out of date');
        expect(screen.getByTestId('note-weekly')).toHaveTextContent('out of date');
        expect(screen.getByText('Out of date. Preview again to refresh.')).toBeInTheDocument();
    });

    it('the run list reloads after a save and when Input from is opened', async () => {
        const api = fakeApi();
        await show(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(2));
        fireEvent.click(screen.getByTestId('input-from'));
        await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(3));
        expect(api.listRuns).toHaveBeenLastCalledWith({ job_id: 'rollups', limit: 20 });
    });

    it('Input from greys out runs past the retention the server reports', async () => {
        const now = Math.floor(Date.now() / 1000);
        const api = fakeApi({
            previewDefaults: jest.fn().mockResolvedValue({ scheduled_time: 1762390800, result_retention: 3600 }),
            listRuns: jest.fn().mockResolvedValue([
                runSummary({ id: 'rollups:1', job_id: 'rollups', scheduled_time: 1762304400, ended_at: now - 7200 }),
            ]),
        });
        await show(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        await waitFor(() => expect(api.previewDefaults).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByTestId('input-from'));
        expect(await screen.findByRole('option', { name: / · succeeded \(results expired\)$/ })).toBeDisabled();
    });
});
