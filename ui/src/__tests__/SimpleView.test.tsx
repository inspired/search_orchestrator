import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import BuilderPage from '../features/builder/BuilderPage';
import { fakeApi, rollupJob } from './builderFixtures';
import { renderThemed } from './fixtures';

jest.mock('../api/versions');
jest.mock('../api/snippets', () => ({ listSnippets: jest.fn(() => new Promise(() => undefined)) }));

async function show(ui: React.ReactElement) {
    renderThemed(ui);
    await act(async () => {
        await Promise.resolve();
    });
}

beforeEach(() => window.localStorage.setItem('so.builder.view', 'simple'));

const searches = () => within(screen.getByRole('list', { name: 'Searches' })).getAllByRole('listitem');

/** "+ Add…" on search `i`: pick when, then what. */
function add(i: number, when: string, what: string) {
    fireEvent.click(within(searches()[i]).getByRole('button', { name: '+ Add…' }));
    const picker = screen.getByTestId('simple-add');
    fireEvent.click(within(picker).getByRole('menuitem', { name: new RegExp(`^${when}`) }));
    fireEvent.click(within(screen.getByTestId('simple-add')).getByRole('menuitem', { name: what }));
}

describe('Simple view', () => {
    it('lists the searches in order and switches to Advanced and back', async () => {
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        expect(searches().map((li) => li.querySelector('button')!.textContent)).toEqual([
            expect.stringContaining('Daily summary'),
            expect.stringContaining('Weekly rollup'),
            expect.stringContaining('Monthly rollup'),
        ]);
        expect(screen.getByRole('region', { name: 'Starts' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
        expect(screen.queryByTestId('simple-view')).toBeNull();
        expect(document.querySelectorAll('[data-node-key^="step:"]')).toHaveLength(3);
        expect(window.localStorage.getItem('so.builder.view')).toBe('advanced');
        fireEvent.click(screen.getByRole('button', { name: 'Simple' }));
        expect(screen.getByTestId('simple-view')).toBeInTheDocument();
    });

    it('adds an email that is sent only when the search found rows, adds a search, and Save sends them', async () => {
        const api = fakeApi();
        await show(<BuilderPage api={api} jobId="rollups" />);
        const first = searches()[0];
        expect(first).toBeTruthy();
        add(0, 'Succeeds', 'Email');
        fireEvent.change(screen.getByRole('textbox', { name: 'Email to' }), { target: { value: 'ops@example.com' } });
        fireEvent.click(within(searches()[0]).getByRole('checkbox', { name: 'Only if it found results' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalled());
        const sent = (api.updateJob as jest.Mock).mock.calls[0][1];
        const daily = sent.steps.find((s: { id: string }) => s.id === 'daily');
        expect(daily.actions).toEqual([{ hook: 'on_success', type: 'email', to: 'ops@example.com', only_if_results: true }]);
        fireEvent.click(screen.getByRole('button', { name: '+ Add search' }));
        expect(searches()).toHaveLength(4);
        expect(searches()[3].querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    });

    it('Settings opens every field of a then, such as the email subject and message', async () => {
        const api = fakeApi();
        await show(<BuilderPage api={api} jobId="rollups" />);
        add(0, 'Succeeds', 'Email');
        fireEvent.click(screen.getByRole('button', { name: 'Settings of Email' }));
        const settings = screen.getByTestId('simple-then-settings');
        fireEvent.change(within(settings).getByLabelText('Subject'), { target: { value: 'Errors in $run.param.env$' } });
        fireEvent.change(within(settings).getByLabelText('Message'), { target: { value: 'Found $daily.resultCount$ rows' } });
        fireEvent.change(screen.getAllByRole('textbox', { name: 'Email to' })[0], { target: { value: 'ops@example.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalled());
        const daily = (api.updateJob as jest.Mock).mock.calls[0][1].steps.find((s: { id: string }) => s.id === 'daily');
        expect(daily.actions[0]).toEqual(expect.objectContaining({ to: 'ops@example.com', subject: 'Errors in $run.param.env$', message: 'Found $daily.resultCount$ rows' }));
    });

    it('a search can do one thing when it succeeds and another when it fails', async () => {
        const api = fakeApi();
        await show(<BuilderPage api={api} jobId="rollups" />);
        add(0, 'Fails', 'Email');
        add(0, 'Succeeds', 'Save to lookup');
        const rows = within(searches()[0]).getAllByTestId('simple-then');
        expect(rows).toHaveLength(2);
        // Only a success item can wait for results.
        expect(within(searches()[0]).getAllByRole('checkbox', { name: 'Only if it found results' })).toHaveLength(1);
        fireEvent.change(within(searches()[0]).getByRole('textbox', { name: 'Email to' }), { target: { value: 'oncall@example.com' } });
        fireEvent.change(within(searches()[0]).getByRole('textbox', { name: 'Lookup' }), { target: { value: 'ok.csv' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalled());
        const sent = (api.updateJob as jest.Mock).mock.calls[0][1];
        expect(sent.steps.find((s: { id: string }) => s.id === 'daily').actions).toEqual([{ hook: 'on_failure', type: 'email', to: 'oncall@example.com' }]);
        expect(sent.steps.some((s: { output?: { name?: string } }) => s.output && s.output.name === 'ok.csv')).toBe(true);
    });

    it('offers every When of the Flow editor; saves only on success or a condition', async () => {
        const api = fakeApi();
        await show(<BuilderPage api={api} jobId="rollups" />);
        fireEvent.click(within(searches()[0]).getByRole('button', { name: '+ Add…' }));
        const picker = screen.getByTestId('simple-add');
        expect(within(picker).getAllByRole('menuitem').map((r) => r.textContent)).toEqual([
            '✓Succeeds›',
            '◇If a condition is true›',
            '✗Failsmessages only›',
            '∞Finishes either waymessages only›',
            '▶Startsmessages only›',
            '⏱Is delayedmessages only›',
        ]);
        fireEvent.click(within(picker).getByRole('menuitem', { name: /^Is delayed/ }));
        const then = screen.getByTestId('simple-add');
        expect(within(then).getByText('When it is delayed, then…')).toBeInTheDocument();
        expect(within(then).queryByRole('menuitem', { name: 'Save to lookup' })).toBeNull();
        fireEvent.click(within(then).getByRole('button', { name: '‹ Back' }));
        expect(within(screen.getByTestId('simple-add')).getByRole('menuitem', { name: /^Succeeds/ })).toBeInTheDocument();
        fireEvent.click(within(screen.getByTestId('simple-add')).getByRole('menuitem', { name: /^Is delayed/ }));
        fireEvent.click(within(screen.getByTestId('simple-add')).getByRole('menuitem', { name: 'Post to Teams' }));
        // Added: the picker starts over at When (it closes in the browser).
        expect(screen.queryByText('When it is delayed, then…')).toBeNull();
        add(0, 'If a condition is true', 'Save to summary index');
        add(0, 'If a condition is true', 'Email');
        expect(within(searches()[0]).getByText('When it is delayed')).toBeInTheDocument();
        const conditions = within(searches()[0]).getAllByRole('textbox', { name: 'Condition' });
        expect(conditions.map((c) => (c as HTMLInputElement).value)).toEqual(['$daily.resultCount$ > 100', '$daily.resultCount$ > 100']);
        fireEvent.change(conditions[1], { target: { value: '$daily.resultCount$ > 5' } });
        fireEvent.change(within(searches()[0]).getByRole('textbox', { name: 'Email to' }), { target: { value: 'ops@example.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalled());
        const sent = (api.updateJob as jest.Mock).mock.calls[0][1];
        const daily = sent.steps.find((s: { id: string }) => s.id === 'daily');
        expect(daily.actions).toEqual([
            { hook: 'on_delayed', type: 'webhook', preset: 'teams', destination: '' },
            { hook: 'on_success', type: 'email', to: 'ops@example.com', condition: '$daily.resultCount$ > 5' },
        ]);
        const save = sent.steps.find((s: { output?: { kind: string } }) => s.output && s.output.kind === 'summary_index');
        expect(save.run_when).toEqual({ kind: 'expression', value: '$daily.resultCount$ > 100' });
    });

    it("opens Standard for a job Simple can't show, and Simple says why", async () => {
        const job = rollupJob({ edges: [{ from: 'daily', to: 'weekly', condition: 'on_failure' }, { from: 'weekly', to: 'monthly', condition: 'on_success' }] });
        await show(<BuilderPage api={fakeApi({ getJob: jest.fn().mockResolvedValue(job) })} jobId="rollups" />);
        expect(screen.queryByTestId('simple-view')).toBeNull();
        expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: /Simple/ }));
        expect(screen.getByText(/Simple can't show this job: a line that runs on failure/)).toBeInTheDocument();
        expect(screen.queryByTestId('simple-view')).toBeNull();
    });
});
