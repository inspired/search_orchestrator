import React from 'react';
import userEvent from '@testing-library/user-event';
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
        await screen.findByRole('button', { name: /^Step Weekly rollup/ });
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
        const node = await screen.findByRole('button', { name: /^Step Weekly rollup/ });
        fireEvent.keyDown(node, { key: 'Delete' });
        expect(await screen.findByText('Weekly rollup and its connections are removed. Undo brings them back.')).toBeInTheDocument();
    });
});
