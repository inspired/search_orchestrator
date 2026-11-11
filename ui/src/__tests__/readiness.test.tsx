import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { readiness } from '../features/builder/readiness';
import SetupChecklist from '../features/builder/SetupChecklist';
import { blankJob } from '../features/builder/reducer';
import BuilderPage from '../features/builder/BuilderPage';
import { fakeApi, rollupJob } from './builderFixtures';
import { renderThemed } from './fixtures';
import type { Action, JobDefinition } from '../api/types';

const NOTIFY = "Choose who hears about failures (optional; otherwise the admin's fallback notification is used)";
const SCHEDULE = 'Choose when it runs (optional; you can also start it by hand)';
const onFailure: Action = { hook: 'on_failure', type: 'email', to: 'a@b.c' };

const done = (job: JobDefinition) =>
    readiness(job).reduce<Record<string, boolean>>((acc, i) => ({ ...acc, [i.key]: i.done }), {});
const base = (): JobDefinition => ({ ...(rollupJob() as JobDefinition), actions: [] });
const full = (): JobDefinition => ({ ...base(), actions: [onFailure] });

describe('readiness', () => {
    it('a blank job has nothing done', () => {
        const items = readiness(blankJob());
        expect(items.map((i) => i.label)).toEqual(['Give the job a name', 'Add a step', "Write each step's search", SCHEDULE, NOTIFY]);
        expect(items.map((i) => i.tab)).toEqual(['steps', 'steps', 'steps', 'triggers', 'actions']);
        expect(items.map((i) => i.optional)).toEqual([false, false, false, true, true]);
        expect(items.every((i) => !i.done)).toBe(true);
    });

    it('a complete job is all done', () => {
        expect(Object.values(done(full())).every(Boolean)).toBe(true);
    });

    it('an empty search makes searches not done', () => {
        const job = full();
        job.steps = [{ ...job.steps[0], spl: '  ' }];
        expect(done(job).searches).toBe(false);
    });

    it('a saved search step without a reference is not done', () => {
        const job = { ...blankJob(), name: 'j', steps: [{ id: 'a', type: 'saved_search' as const }] };
        expect(done(job).searches).toBe(false);
    });

    it('a completion trigger counts as a schedule', () => {
        const job = { ...full(), triggers: [{ type: 'completion', job: 'other' }] };
        expect(done(job).schedule).toBe(true);
    });

    it('a job-level on_failure action makes notify done', () => {
        expect(done(full()).notify).toBe(true);
    });

    it('a step-level on_failure action alone does not', () => {
        const job = base();
        job.steps = [{ ...job.steps[0], actions: [onFailure] }, ...job.steps.slice(1)];
        expect(done(job).notify).toBe(false);
    });

    it('a job-level on_complete action alone does not', () => {
        const job = { ...base(), actions: [{ hook: 'on_complete' as const, type: 'webhook' as const }] };
        expect(done(job).notify).toBe(false);
    });
});

describe('SetupChecklist', () => {
    it('shows the count and goes to the item tab', () => {
        const onTabChange = jest.fn();
        const job = { ...full(), name: '', triggers: [] };
        renderThemed(<SetupChecklist items={readiness(job)} onTabChange={onTabChange} />);
        expect(screen.getByText('3 of 5 done')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: `Go to Triggers: ${SCHEDULE}` }));
        expect(onTabChange).toHaveBeenCalledWith('triggers');
        expect(screen.getAllByText('Done').length).toBe(3);
        expect(screen.getAllByText('Not done').length).toBe(2);
    });

    it('shows 0 of 5 for a blank job', () => {
        renderThemed(<SetupChecklist items={readiness(blankJob())} onTabChange={jest.fn()} />);
        expect(screen.getByText('0 of 5 done')).toBeInTheDocument();
    });

    it('offers no Go to button for a done item', () => {
        renderThemed(<SetupChecklist items={readiness(full())} onTabChange={jest.fn()} />);
        expect(screen.queryByRole('button', { name: /Go to/ })).toBeNull();
    });

    it('offers Hide checklist only once the required items are done', () => {
        const { unmount } = renderThemed(<SetupChecklist items={readiness(blankJob())} onTabChange={jest.fn()} onHide={jest.fn()} />);
        expect(screen.queryByRole('button', { name: 'Hide checklist' })).toBeNull();
        unmount();
        renderThemed(<SetupChecklist items={readiness(base())} onTabChange={jest.fn()} onHide={jest.fn()} />);
        expect(screen.getByRole('button', { name: 'Hide checklist' })).toBeInTheDocument();
    });
});

async function show(ui: React.ReactElement) {
    renderThemed(ui);
    await act(async () => {
        await Promise.resolve();
    });
}

describe('BuilderPage checklist', () => {
    it('is hidden while the template picker shows', async () => {
        await show(<BuilderPage api={fakeApi()} />);
        expect(screen.queryByText(/of 5 done/)).toBeNull();
    });

    it('shows for a new blank job and Go to switches tab', async () => {
        await show(<BuilderPage api={fakeApi()} template="blank" />);
        expect(screen.getByText('0 of 5 done')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Hide checklist' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: `Go to Triggers: ${SCHEDULE}` }));
        expect(screen.getByRole('tab', { name: 'Triggers', selected: true })).toBeInTheDocument();
    });

    it('a templated job named by the user keeps the notice item until hidden', async () => {
        await show(<BuilderPage api={fakeApi()} template="rollup" />);
        fireEvent.change(screen.getByLabelText('Job name'), { target: { value: 'Mine' } });
        expect(screen.getByRole('button', { name: `Go to Actions: ${NOTIFY}` })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Hide checklist' }));
        expect(screen.queryByText(/of 5 done/)).toBeNull();
        fireEvent.change(screen.getByLabelText('Job name'), { target: { value: '' } });
        expect(screen.queryByText(/of 5 done/)).toBeNull();
    });

    it('a loaded job with a schedule but no failure action offers Hide checklist', async () => {
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        expect(screen.getByText('4 of 5 done')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Hide checklist' }));
        expect(screen.queryByText(/of 5 done/)).toBeNull();
    });
});
