import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import ExamplesDialog from '../features/jobs/ExamplesDialog';
import JobsPage, { JobsApi } from '../features/jobs/JobsPage';
import { EXAMPLE_JOBS, VIEWS, addExamples, examplesNeeded } from '../features/jobs/examples';
import { readSimple } from '../features/simple/simpleModel';
import { buildGraph } from '../features/builder/nodeModel';
import { findIssues } from '../features/builder/graphLogic';
import { takeImportedJob } from '../features/builder/sourceLogic';
import { ApiError } from '../api/client';
import type { JobDefinition, SaveResponse } from '../api/types';
import { job, me, renderThemed } from './fixtures';

const saved = (_job?: JobDefinition): Promise<SaveResponse> => Promise.resolve({} as SaveResponse);

function open(props: Partial<React.ComponentProps<typeof ExamplesDialog>> = {}) {
    const navigate = jest.fn();
    const createJob = jest.fn((def: JobDefinition) => saved(def));
    const onAdded = jest.fn();
    renderThemed(
        <ExamplesDialog
            onClose={jest.fn()}
            returnFocus={{ current: null }}
            navigate={navigate}
            canAdd
            existingIds={[]}
            createJob={createJob}
            onAdded={onAdded}
            {...props}
        />
    );
    return { navigate, createJob, onAdded };
}

const KEPT = {
    simple: ['example_hourly_errors'],
    standard: ['example_rollup', 'example_condition'],
    advanced: ['example_failure_path', 'example_chaining', 'example_platform_health'],
};

describe('example jobs', () => {
    test('there are six: one for Simple, two for Standard and three for Advanced, each a complete job that is turned off', () => {
        expect(EXAMPLE_JOBS).toHaveLength(6);
        expect(VIEWS.map((v) => v.id)).toEqual(['simple', 'standard', 'advanced']);
        (Object.keys(KEPT) as Array<keyof typeof KEPT>).forEach((view) => {
            expect(EXAMPLE_JOBS.filter((e) => e.view === view).map((e) => e.job.id)).toEqual(KEPT[view]);
        });
        EXAMPLE_JOBS.forEach((e) => {
            expect(e.job.id).toMatch(/^example_[a-z0-9_]+$/);
            expect(e.job.enabled).toBe(false);
            expect((e.job.triggers || []).some((t) => t.type === 'cron' && t.cron)).toBe(true);
            expect(e.job.timezone).toBeUndefined();
            expect(e.features.length).toBeGreaterThan(0);
            expect(findIssues(e.job).filter((i) => i.level === 'error')).toEqual([]);
            // Every node on the canvas has a saved position.
            const nodes = (e.job.layout && e.job.layout.nodes) || {};
            buildGraph(e.job).nodes.forEach((n) => expect(nodes[n.key]).toBeDefined());
        });
    });

    test('the Simple example can be shown in Simple, with more than one search and a save', () => {
        EXAMPLE_JOBS.filter((e) => e.view === 'simple').forEach((e) => {
            const read = readSimple(e.job);
            expect(read.reasons).toEqual([]);
            expect(read.chain.length).toBeGreaterThan(1);
            expect(read.chain.flatMap((c) => c.thens.map((t) => t.kind))).toEqual(expect.arrayContaining(['lookup', 'email']));
            expect(read.failure).toBeGreaterThanOrEqual(0);
        });
    });

    test('examplesNeeded follows Start job actions and After another job triggers', () => {
        const health = EXAMPLE_JOBS.find((e) => e.job.id === 'example_platform_health') as (typeof EXAMPLE_JOBS)[0];
        expect(examplesNeeded(health).map((e) => e.job.id).sort()).toEqual(['example_hourly_errors', 'example_rollup']);
        const chained = EXAMPLE_JOBS.find((e) => e.job.id === 'example_chaining') as (typeof EXAMPLE_JOBS)[0];
        expect(examplesNeeded(chained).map((e) => e.job.id).sort()).toEqual(['example_hourly_errors', 'example_rollup']);
    });

    test('adding one example adds what it needs first', async () => {
        const createJob = jest.fn(saved);
        const health = EXAMPLE_JOBS.find((e) => e.job.id === 'example_platform_health') as (typeof EXAMPLE_JOBS)[0];
        const out = await addExamples(['example_rollup'], createJob, [health]);
        expect(createJob.mock.calls.map((c) => (c[0] as JobDefinition).id)).toEqual(['example_hourly_errors', 'example_platform_health']);
        expect(out.skipped.map((e) => e.job.id)).toEqual(['example_rollup']);
    });

    test('addExamples creates the missing ones turned off, skips existing ids and lists errors', async () => {
        const createJob = jest.fn((def) =>
            def.id === 'example_rollup'
                ? Promise.reject(new ApiError(400, 'invalid_job', 'job is invalid', [{ level: 'error', code: 'bad_cron', message: 'schedule: bad', step: null }]))
                : def.id === 'example_condition'
                  ? Promise.reject(new ApiError(409, 'job_exists', "a job with id 'example_condition' already exists"))
                  : saved()
        );
        const out = await addExamples(['example_hourly_errors'], createJob);
        const created = createJob.mock.calls.map(([def]) => def.id);
        expect(created).not.toContain('example_hourly_errors');
        expect(created).toHaveLength(5);
        createJob.mock.calls.forEach(([def]) => expect(def.enabled).toBe(false));
        expect(out.added).toHaveLength(3);
        expect(out.skipped.map((e) => e.job.id)).toEqual(['example_hourly_errors', 'example_condition']);
        expect(out.failed).toEqual([{ example: expect.objectContaining({ title: expect.any(String) }), message: 'schedule: bad' }]);
    });
});

describe('ExamplesDialog', () => {
    test('every example on one page, each a card with its diagram, view, description and features', () => {
        open();
        expect(screen.queryAllByRole('tab')).toHaveLength(0);
        expect(screen.getAllByRole('listitem')).toHaveLength(6);
        const first = within(screen.getByTestId('example-example_hourly_errors'));
        const hourly = EXAMPLE_JOBS[0];
        expect(first.getByText(hourly.title)).toBeInTheDocument();
        expect(first.getByText('Opens in Simple')).toBeInTheDocument();
        expect(first.getByText(hourly.summary)).toBeInTheDocument();
        expect(first.getByText(`Shows: ${hourly.features.join(', ')}`)).toBeInTheDocument();
        expect(first.getByTestId('example-diagram')).toBeInTheDocument();
        // One button per card: Open in builder (Add all examples is at the bottom).
        expect(first.getAllByRole('button').map((b) => b.textContent)).toEqual(['Open in builder']);
        expect(screen.getByTestId('example-example_chaining')).toHaveTextContent('Opens in Advanced');
        expect(screen.getByTestId('example-example_chaining')).toHaveTextContent('added with it.');
    });

    test('Open in builder on an example that uses others adds those first, and opens it in its view', async () => {
        const { navigate, createJob } = open();
        fireEvent.click(screen.getByRole('button', { name: 'Open Chained jobs in builder' }));
        await waitFor(() => expect(navigate).toHaveBeenCalled());
        expect(createJob.mock.calls.map(([d]) => d.id).sort()).toEqual(['example_hourly_errors', 'example_rollup']);
        expect(navigate).toHaveBeenCalledWith(expect.stringContaining('view=advanced'));
    });

    test('Open in builder opens the example as a new unsaved job', async () => {
        const { navigate, createJob } = open();
        const rollup = EXAMPLE_JOBS.find((e) => e.job.id === 'example_rollup')!;
        fireEvent.click(screen.getByRole('button', { name: `Open ${rollup.title} in builder` }));
        await waitFor(() => expect(navigate).toHaveBeenCalledWith(expect.stringContaining('import=1')));
        expect(navigate).toHaveBeenCalledWith(expect.stringContaining('view=standard'));
        const imported = takeImportedJob() as unknown as Record<string, unknown>;
        expect(imported.name).toBe(rollup.job.name);
        expect(imported.id).toBeUndefined();
        expect(imported.enabled).toBe(false);
        expect(createJob).not.toHaveBeenCalled();
    });

    test('Add all examples saves the missing ones and says what happened', async () => {
        const existing = ['example_hourly_errors', 'example_chaining'];
        const { createJob, onAdded } = open({ existingIds: existing });
        fireEvent.click(screen.getByRole('button', { name: 'Add all examples' }));
        expect(
            await screen.findByText(/^Added 4 examples: .*They're turned off; turn one on from its Settings when you're ready\.$/)
        ).toBeInTheDocument();
        expect(createJob).toHaveBeenCalledTimes(4);
        createJob.mock.calls.forEach(([def]) => {
            expect(existing).not.toContain(def.id);
            expect(def.enabled).toBe(false);
        });
        expect(screen.getByText(/Already there, so skipped: /)).toBeInTheDocument();
        expect(onAdded).toHaveBeenCalled();
    });

    test('a job that fails to save is listed with its error', async () => {
        open({ createJob: jest.fn((def) => (def.id === 'example_condition' ? Promise.reject(new Error('Network down')) : saved())) });
        fireEvent.click(screen.getByRole('button', { name: 'Add all examples' }));
        const title = EXAMPLE_JOBS.find((e) => e.job.id === 'example_condition')!.title;
        expect(await screen.findByText(`${title}: Network down`)).toBeInTheDocument();
        expect(screen.getByText(/Added 5 examples/)).toBeInTheDocument();
    });

    test('without build access there is no Add all examples', () => {
        open({ canAdd: false });
        expect(screen.queryByRole('button', { name: 'Add all examples' })).toBeNull();
    });
});

describe('Jobs page examples', () => {
    const api = (jobs = [job()]): JobsApi => ({
        me: jest.fn().mockResolvedValue(me),
        listJobs: jest.fn().mockResolvedValue(jobs),
        setJobEnabled: jest.fn(),
        deleteJob: jest.fn(),
        createJob: jest.fn(saved),
    });

    test('Browse examples sits next to Import job and opens the gallery', async () => {
        renderThemed(<JobsPage api={api()} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Browse examples' }));
        expect(await screen.findByRole('heading', { name: 'Example jobs' })).toBeInTheDocument();
    });

    test('the empty Jobs page offers the examples too', async () => {
        renderThemed(<JobsPage api={api([])} />);
        await screen.findByText('Build your first job');
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Browse examples' }).length).toBe(2));
    });
});
