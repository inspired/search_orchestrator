import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { readiness } from '../features/builder/readiness';
import SetupChecklist from '../features/builder/SetupChecklist';
import { blankJob } from '../features/builder/reducer';
import BuilderPage from '../features/builder/BuilderPage';
import { act } from '@testing-library/react';
import { fakeApi, rollupJob } from './builderFixtures';
import { renderThemed } from './fixtures';
import type { JobDefinition } from '../api/types';

const done = (job: JobDefinition, issues: { level: 'error' | 'warning'; code: string; message: string; step: string | null }[] = []) =>
    readiness(job, issues as never).reduce<Record<string, boolean>>((acc, i) => ({ ...acc, [i.key]: i.done }), {});

describe('readiness', () => {
    it('a blank job has nothing done', () => {
        const items = readiness(blankJob(), []);
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
        const d = done(rollupJob() as JobDefinition, [{ level: 'warning', code: 'no_failure_notification', message: 'x', step: null }]);
        expect(d.notify).toBe(false);
        expect(d.name).toBe(true);
    });

    it('a completion trigger counts as a schedule', () => {
        const job = { ...(rollupJob() as JobDefinition), triggers: [{ type: 'completion', job: 'other' }] };
        expect(done(job).schedule).toBe(true);
    });
});

describe('SetupChecklist', () => {
    it('shows the count and goes to the item tab', () => {
        const onTabChange = jest.fn();
        const job = { ...(rollupJob() as JobDefinition), name: '', triggers: [] };
        renderThemed(<SetupChecklist items={readiness(job, [])} onTabChange={onTabChange} />);
        expect(screen.getByText('3 of 5 done')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Go to Triggers' }));
        expect(onTabChange).toHaveBeenCalledWith('triggers');
        expect(screen.getAllByText('Done').length).toBe(3);
        expect(screen.getAllByText('Not done').length).toBe(2);
    });

    it('shows 0 of 5 for a blank job', () => {
        renderThemed(<SetupChecklist items={readiness(blankJob(), [])} onTabChange={jest.fn()} />);
        expect(screen.getByText('0 of 5 done')).toBeInTheDocument();
    });

    it('offers no Go to button for a done item', () => {
        renderThemed(<SetupChecklist items={readiness(rollupJob() as JobDefinition, [])} onTabChange={jest.fn()} />);
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
        fireEvent.click(screen.getByRole('button', { name: 'Go to Triggers' }));
        expect(screen.getByRole('tab', { name: 'Triggers', selected: true })).toBeInTheDocument();
    });

    it('is hidden for a ready loaded job', async () => {
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        expect(screen.queryByText(/of 5 done/)).toBeNull();
    });

    it('stays hidden once everything was done', async () => {
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        fireEvent.change(screen.getByLabelText('Job name'), { target: { value: '' } });
        expect(screen.queryByText(/of 5 done/)).toBeNull();
    });
});
