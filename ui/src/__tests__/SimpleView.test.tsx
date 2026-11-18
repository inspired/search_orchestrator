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

describe('Simple view', () => {
    it('lists the searches in order and switches to Flow and back', async () => {
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        expect(searches().map((li) => li.querySelector('button')!.textContent)).toEqual([
            expect.stringContaining('Daily summary'),
            expect.stringContaining('Weekly rollup'),
            expect.stringContaining('Monthly rollup'),
        ]);
        expect(screen.getByRole('region', { name: 'Starts' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Flow' }));
        expect(screen.queryByTestId('simple-view')).toBeNull();
        expect(document.querySelectorAll('[data-node-key^="step:"]')).toHaveLength(3);
        expect(window.localStorage.getItem('so.builder.view')).toBe('flow');
        fireEvent.click(screen.getByRole('button', { name: 'Simple' }));
        expect(screen.getByTestId('simple-view')).toBeInTheDocument();
    });

    it('adds an email that is sent only when the search found rows, adds a search, and Save sends them', async () => {
        const api = fakeApi();
        await show(<BuilderPage api={api} jobId="rollups" />);
        const first = searches()[0];
        fireEvent.click(within(first).getByRole('button', { name: '+ Then…' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Email' }));
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

    it('shows a job it cannot edit read only, with the reason and Edit in Flow', async () => {
        const job = rollupJob({ edges: [{ from: 'daily', to: 'weekly', condition: 'on_failure' }, { from: 'weekly', to: 'monthly', condition: 'on_success' }] });
        await show(<BuilderPage api={fakeApi({ getJob: jest.fn().mockResolvedValue(job) })} jobId="rollups" />);
        expect(screen.getByText(/uses things Simple can't change/)).toBeInTheDocument();
        expect(screen.queryByText('+ Add search')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Edit in Flow' }));
        expect(screen.queryByTestId('simple-view')).toBeNull();
    });
});
