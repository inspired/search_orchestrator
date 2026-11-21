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
        expect(items.map((i) => i.tab)).toEqual(['steps', 'steps', 'steps', 'steps', 'actions']);
        expect(items[3].addKinds).toEqual(['trigger_cron', 'trigger_completion']);
        expect(items[3].node).toBeUndefined();
        expect(items[4].node).toBeUndefined();
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

    it('with a trigger the schedule item points at the first trigger node', () => {
        const item = readiness(full()).find((i) => i.key === 'schedule');
        expect(item?.node).toBe('trigger:0');
        expect(item?.addKinds).toBeUndefined();
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
    it('shows the count and goes to the item', () => {
        const onGo = jest.fn();
        const job = { ...full(), name: '', triggers: [] };
        const items = readiness(job);
        renderThemed(<SetupChecklist items={items} onGo={onGo} />);
        expect(screen.getByText('3 of 5 done')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: `Go to Flow: ${SCHEDULE}` }));
        expect(onGo).toHaveBeenCalledWith(items[3]);
        expect(screen.getAllByText('Done').length).toBe(3);
        expect(screen.getAllByText('Not done').length).toBe(2);
    });

    it('shows 0 of 5 for a blank job', () => {
        renderThemed(<SetupChecklist items={readiness(blankJob())} onGo={jest.fn()} />);
        expect(screen.getByText('0 of 5 done')).toBeInTheDocument();
    });

    it('offers no Go to button for a done item', () => {
        renderThemed(<SetupChecklist items={readiness(full())} onGo={jest.fn()} />);
        expect(screen.queryByRole('button', { name: /Go to/ })).toBeNull();
    });

    it('offers Hide checklist only once the required items are done', () => {
        const { unmount } = renderThemed(<SetupChecklist items={readiness(blankJob())} onGo={jest.fn()} onHide={jest.fn()} />);
        expect(screen.queryByRole('button', { name: 'Hide checklist' })).toBeNull();
        unmount();
        renderThemed(<SetupChecklist items={readiness(base())} onGo={jest.fn()} onHide={jest.fn()} />);
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
    it('shows for a new blank job; the schedule item opens quick-add with the two trigger kinds', async () => {
        await show(<BuilderPage api={fakeApi()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
        expect(screen.getByText('0 of 5 done')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Hide checklist' })).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: /^Settings/ }));
        fireEvent.click(screen.getByRole('button', { name: `Go to Flow: ${SCHEDULE}` }));
        expect(screen.getByRole('tab', { name: /^Flow/, selected: true })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Add a node' })).toHaveFocus();
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
            'ScheduleStart the job on a schedule.',
            'After another jobStart the job when another job finishes.',
        ]);
        fireEvent.keyDown(screen.getByRole('combobox', { name: 'Add a node' }), { key: 'Enter' });
        expect(screen.getByTestId('node-trigger:0')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('1 of 5 done')).toBeInTheDocument();
    });

    it('a new job with steps, named by the user, keeps the notice item until hidden', async () => {
        const { id: _id, ...draft } = rollupJob({ name: '', actions: [] });
        await show(<BuilderPage api={fakeApi()} imported={draft as never} />);
        fireEvent.change(screen.getByLabelText('Job name'), { target: { value: 'Mine' } });
        expect(screen.getByRole('button', { name: `Go to Job actions: ${NOTIFY}` })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Hide checklist' }));
        expect(screen.queryByText(/of 5 done/)).toBeNull();
        fireEvent.change(screen.getByLabelText('Job name'), { target: { value: '' } });
        expect(screen.queryByText(/of 5 done/)).toBeNull();
    });

    it('the failure-notification item opens the Job actions tab', async () => {
        const api = fakeApi({
            validateJob: jest.fn().mockResolvedValue({
                valid: true,
                issues: [{ level: 'warning', code: 'no_failure_notification', message: 'No one hears about failures', step: null }],
                owner_will_change: false,
                owner: 'alice',
            }),
        });
        await show(<BuilderPage api={api} jobId="rollups" />);
        fireEvent.click(screen.getByRole('tab', { name: /^Parameters/ }));
        fireEvent.click(screen.getByRole('button', { name: `Go to Job actions: ${NOTIFY}` }));
        expect(screen.getByRole('tab', { name: /^Job actions/, selected: true })).toBeInTheDocument();
        expect(screen.getByTestId('job-actions-tab')).toBeInTheDocument();
    });

    it('a loaded job with a schedule but no failure action offers Hide checklist', async () => {
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        expect(screen.getByText('4 of 5 done')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Hide checklist' }));
        expect(screen.queryByText(/of 5 done/)).toBeNull();
    });

    it('Hide checklist is remembered per job, and Show checklist brings it back', async () => {
        window.localStorage.clear();
        const { unmount } = renderThemed(<BuilderPage api={fakeApi()} jobId="rollups" />);
        await act(async () => {
            await Promise.resolve();
        });
        fireEvent.click(screen.getByRole('button', { name: 'Hide checklist' }));
        expect(screen.queryByText(/of 5 done/)).toBeNull();
        expect(window.localStorage.getItem('so.checklist.hidden.rollups')).toBe('1');
        unmount();
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        expect(screen.queryByText(/of 5 done/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Show checklist' }));
        expect(screen.getByText('4 of 5 done')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show checklist' })).toBeNull();
        expect(window.localStorage.getItem('so.checklist.hidden.rollups')).toBeNull();
    });

    it('another job is not hidden', async () => {
        window.localStorage.setItem('so.checklist.hidden.other', '1');
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        expect(screen.getByText('4 of 5 done')).toBeInTheDocument();
        window.localStorage.clear();
    });

    it('works when localStorage throws', async () => {
        const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        await show(<BuilderPage api={fakeApi()} jobId="rollups" />);
        fireEvent.click(screen.getByRole('button', { name: 'Hide checklist' }));
        expect(screen.getByRole('button', { name: 'Show checklist' })).toBeInTheDocument();
        spy.mockRestore();
        set.mockRestore();
    });
});

describe('SetupChecklist list', () => {
    it('has no list markers', () => {
        renderThemed(<SetupChecklist items={readiness(blankJob())} onGo={jest.fn()} />);
        const list = screen.getByRole('list');
        expect(list.style.listStyle).toBe('none');
        screen.getAllByRole('listitem').forEach((li) => expect((li as HTMLElement).style.listStyle).toBe('none'));
    });
});
