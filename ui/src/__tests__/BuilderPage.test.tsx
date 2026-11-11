import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import BuilderPage from '../features/builder/BuilderPage';
import { fakeApi } from './builderFixtures';
import { renderThemed } from './fixtures';

/** Renders and lets the page's start-up requests settle. */
async function show(ui: React.ReactElement) {
    renderThemed(ui);
    await act(async () => {
        await Promise.resolve();
    });
}

const nodes = () => document.querySelectorAll('[data-node-id]');

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
