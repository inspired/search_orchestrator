import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import ExamplesDialog from '../features/jobs/ExamplesDialog';
import JobsPage, { JobsApi } from '../features/jobs/JobsPage';
import { EXAMPLE_JOBS, GROUPS, addExamples, examplesNeeded } from '../features/jobs/examples';
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

describe('example jobs', () => {
    test('there are eighteen, in five groups, each a complete job that is turned off', () => {
        expect(EXAMPLE_JOBS).toHaveLength(18);
        expect(new Set(EXAMPLE_JOBS.map((e) => e.group))).toEqual(new Set(GROUPS.map((g) => g.id)));
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
        expect(new Set(EXAMPLE_JOBS.map((e) => e.job.id)).size).toBe(18);
    });

    test('examplesNeeded follows Start job actions and After another job triggers', () => {
        const health = EXAMPLE_JOBS.find((e) => e.job.id === 'example_platform_health') as (typeof EXAMPLE_JOBS)[0];
        expect(examplesNeeded(health).map((e) => e.job.id).sort()).toEqual(['example_hourly_errors', 'example_rollup']);
        const fan = EXAMPLE_JOBS.find((e) => e.job.id === 'example_fan_out') as (typeof EXAMPLE_JOBS)[0];
        expect(examplesNeeded(fan).map((e) => e.job.id)).toEqual(['example_hourly_errors', 'example_top_sourcetypes']);
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
                : def.id === 'example_parallel'
                  ? Promise.reject(new ApiError(409, 'job_exists', "a job with id 'example_parallel' already exists"))
                  : saved()
        );
        const out = await addExamples(['example_hourly_errors'], createJob);
        const created = createJob.mock.calls.map(([def]) => def.id);
        expect(created).not.toContain('example_hourly_errors');
        expect(created).toHaveLength(17);
        createJob.mock.calls.forEach(([def]) => expect(def.enabled).toBe(false));
        expect(out.added).toHaveLength(15);
        expect(out.skipped.map((e) => e.job.id)).toEqual(['example_hourly_errors', 'example_parallel']);
        expect(out.failed).toEqual([{ example: expect.objectContaining({ title: expect.any(String) }), message: 'schedule: bad' }]);
    });
});

describe('ExamplesDialog', () => {
    test('tabs by group, each example a card with its diagram, level, description and features', () => {
        open();
        const first = within(screen.getByTestId(`example-${EXAMPLE_JOBS[0].job.id}`));
        expect(first.getByText(EXAMPLE_JOBS[0].title)).toBeInTheDocument();
        expect(first.getByText('Simple')).toBeInTheDocument();
        expect(first.getByText(EXAMPLE_JOBS[0].summary)).toBeInTheDocument();
        expect(first.getByText(`Shows: ${EXAMPLE_JOBS[0].features.join(', ')}`)).toBeInTheDocument();
        expect(first.getByTestId('example-diagram')).toBeInTheDocument();
        expect(screen.getAllByRole('listitem')).toHaveLength(EXAMPLE_JOBS.filter((e) => e.group === 'getting started').length);
        fireEvent.click(screen.getByRole('tab', { name: /Chaining jobs/ }));
        expect(screen.getByTestId('example-example_fan_out')).toHaveTextContent('Uses Hourly splunkd errors and Top sourcetypes to a lookup, added with it.');
    });

    test('Open in builder on an example that starts others adds those first', async () => {
        const { navigate, createJob } = open();
        fireEvent.click(screen.getByRole('tab', { name: /Chaining jobs/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Open Start two jobs when done in builder' }));
        await waitFor(() => expect(navigate).toHaveBeenCalled());
        expect(createJob.mock.calls.map(([d]) => d.id)).toEqual(['example_hourly_errors', 'example_top_sourcetypes']);
    });

    test('Open in builder opens the example as a new unsaved job', async () => {
        const { navigate, createJob } = open();
        fireEvent.click(screen.getByRole('tab', { name: /Branches and conditions/ }));
        fireEvent.click(screen.getByRole('button', { name: `Open ${EXAMPLE_JOBS[3].title} in builder` }));
        await waitFor(() => expect(navigate).toHaveBeenCalledWith(expect.stringContaining('import=1')));
        const imported = takeImportedJob() as unknown as Record<string, unknown>;
        expect(imported.name).toBe(EXAMPLE_JOBS[3].job.name);
        expect(imported.id).toBeUndefined();
        expect(imported.enabled).toBe(false);
        expect(createJob).not.toHaveBeenCalled();
    });

    test('Add all examples saves the missing ones and says what happened', async () => {
        const existing = ['example_hourly_errors', 'example_chaining'];
        const { createJob, onAdded } = open({ existingIds: existing });
        fireEvent.click(screen.getByRole('button', { name: 'Add all examples' }));
        expect(
            await screen.findByText(/^Added 16 examples: .*They're turned off; turn one on from its Settings when you're ready\.$/)
        ).toBeInTheDocument();
        expect(createJob).toHaveBeenCalledTimes(16);
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
        expect(screen.getByText(/Added 17 examples/)).toBeInTheDocument();
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
