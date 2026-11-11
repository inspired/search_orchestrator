import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { readiness } from '../features/builder/readiness';
import SetupChecklist from '../features/builder/SetupChecklist';
import { blankJob } from '../features/builder/reducer';
import BuilderPage from '../features/builder/BuilderPage';
import { act, waitFor } from '@testing-library/react';
import { fakeApi, rollupJob } from './builderFixtures';
import { renderThemed } from './fixtures';
import type { Issue, JobDefinition } from '../api/types';

const noteIssue: Issue = { level: 'warning', code: 'no_failure_notification', message: 'x', step: null };
const done = (job: JobDefinition, issues: Issue[] = [], checked = true) =>
    readiness(job, issues, checked).reduce<Record<string, boolean>>((acc, i) => ({ ...acc, [i.key]: i.done }), {});
const bare = (): JobDefinition => ({ ...(rollupJob() as JobDefinition), actions: [] });

describe('readiness', () => {
    it('a blank job has nothing done', () => {
        const items = readiness(blankJob(), [], false);
        expect(items.map((i) => i.label)).toEqual([
            'Give the job a name',
            'Add a step',
            "Write each step's search",
            'Choose when it runs (optional; you can also start it by hand)',
            'Choose who hears about failures',
        ]);
        expect(items.map((i) => i.tab)).toEqual(['steps', 'steps', 'steps', 'triggers', 'actions']);
        expect(items.map((i) => i.optional)).toEqual([false, false, false, true, true]);
        expect(items.every((i) => !i.done)).toBe(true);
    });

    it('a complete job is all done', () => {
        expect(Object.values(done(rollupJob() as JobDefinition)).every(Boolean)).toBe(true);
    });

    it('an empty search makes searches not done', () => {
        const job = rollupJob() as JobDefinition;
        job.steps = [{ ...job.steps[0], spl: '  ' }];
        expect(done(job).searches).toBe(false);
    });

    it('a saved search step without a reference is not done', () => {
        const job = { ...blankJob(), name: 'j', steps: [{ id: 'a', type: 'saved_search' as const }] };
        expect(done(job).searches).toBe(false);
    });

    it('no_failure_notification makes notify not done', () => {
        const d = done(rollupJob() as JobDefinition, [noteIssue]);
        expect(d.notify).toBe(false);
        expect(d.name).toBe(true);
    });

    it('a completion trigger counts as a schedule', () => {
        const job = { ...(rollupJob() as JobDefinition), triggers: [{ type: 'completion', job: 'other' }] };
        expect(done(job).schedule).toBe(true);
    });
});

describe('readiness: failure notice', () => {
    it('is not done before a server check', () => {
        expect(done(bare(), [], false).notify).toBe(false);
    });
    it('is done after a check without the issue', () => {
        expect(done(bare(), [], true).notify).toBe(true);
    });
    it('is done by an on_failure action even unchecked', () => {
        const job = { ...bare(), actions: [{ hook: 'on_failure' as const, type: 'email' as const, to: 'a@b.c' }] };
        expect(done(job, [], false).notify).toBe(true);
    });
    it('is done by a step on_complete action', () => {
        const job = bare();
        job.steps = [{ ...job.steps[0], actions: [{ hook: 'on_complete', type: 'webhook' }] }, ...job.steps.slice(1)];
        expect(done(job, [], false).notify).toBe(true);
    });
});

describe('SetupChecklist', () => {
    it('shows the count and goes to the item tab', () => {
        const onTabChange = jest.fn();
        const job = { ...(rollupJob() as JobDefinition), name: '', triggers: [] };
        renderThemed(<SetupChecklist items={readiness(job, [], true)} onTabChange={onTabChange} />);
        expect(screen.getByText('3 of 5 done')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Go to Triggers: Choose when it runs (optional; you can also start it by hand)' }));
        expect(onTabChange).toHaveBeenCalledWith('triggers');
        expect(screen.getAllByText('Done').length).toBe(3);
        expect(screen.getAllByText('Not done').length).toBe(2);
    });

    it('shows 0 of 5 for a blank job', () => {
        renderThemed(<SetupChecklist items={readiness(blankJob(), [], false)} onTabChange={jest.fn()} />);
        expect(screen.getByText('0 of 5 done')).toBeInTheDocument();
    });

    it('offers no Go to button for a done item', () => {
        renderThemed(<SetupChecklist items={readiness(rollupJob() as JobDefinition, [], true)} onTabChange={jest.fn()} />);
        expect(screen.queryByRole('button', { name: /Go to/ })).toBeNull();
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
        fireEvent.click(screen.getByRole('button', { name: 'Go to Triggers: Choose when it runs (optional; you can also start it by hand)' }));
        expect(screen.getByRole('tab', { name: 'Triggers', selected: true })).toBeInTheDocument();
    });

    it('a templated job named by the user still lists the notice item', async () => {
        await show(<BuilderPage api={fakeApi()} template="rollup" />);
        fireEvent.change(screen.getByLabelText('Job name'), { target: { value: 'Mine' } });
        expect(screen.getByRole('button', { name: 'Go to Actions: Choose who hears about failures' })).toBeInTheDocument();
    });

    it('a ready job with no failure action still shows the notice item until checked', async () => {
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        expect(screen.getByText('4 of 5 done')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Go to Actions: Choose who hears about failures' })).toBeInTheDocument();
    });

    it('dismisses after a check finds everything done, and stays hidden when it regresses', async () => {
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
        await waitFor(() => expect(screen.queryByText(/of 5 done/)).toBeNull());
        fireEvent.change(screen.getByLabelText('Job name'), { target: { value: '' } });
        expect(screen.queryByText(/of 5 done/)).toBeNull();
    });
});
