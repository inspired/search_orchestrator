import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import JobsTable from '../features/jobs/JobsTable';
import JobsPage, { JobsApi } from '../features/jobs/JobsPage';
import RunNowDialog from '../features/jobs/RunNowDialog';
import { ApiError } from '../api/client';
import { formatTime } from '../format';
import { NOW, job, me, renderThemed } from './fixtures';
import { rollupJob } from './builderFixtures';

describe('JobsTable', () => {
    test('a job warning (an old time range on a Results of earlier steps step) shows under its name', () => {
        const warning = { level: 'warning' as const, code: 'previous_old_time_range', message: "re-save the job to drop this step's old time range", step: 'b' };
        renderThemed(<JobsTable jobs={[job({ warnings: [warning] }), job({ id: 'w', name: 'Weekly rollup' })]} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        const daily = screen.getByText('Daily summary').closest('tr') as HTMLElement;
        expect(within(daily).getByText("Step b: re-save the job to drop this step's old time range")).toBeInTheDocument();
        const weekly = screen.getByText('Weekly rollup').closest('tr') as HTMLElement;
        expect(within(weekly).queryByText(/re-save/)).toBeNull();
    });

    test('JobsTable shows next run and last outcome', () => {
        const jobs = [
            job({
                last_run: {
                    id: 'daily:1',
                    state: 'failed',
                    trigger: 'cron',
                    scheduled_time: NOW - 86400,
                    started_at: NOW - 86400,
                    ended_at: NOW - 86000,
                    delay_alerted: false,
                    held: false,
                    gave_up: false,
                },
            }),
            job({ id: 'weekly', name: 'Weekly rollup', owner: 'bob', next_run: null, last_run: null }),
        ];
        renderThemed(<JobsTable jobs={jobs} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        const daily = screen.getByText('Daily summary').closest('tr') as HTMLElement;
        expect(within(daily).getByText(formatTime(NOW + 3600))).toBeInTheDocument();
        expect(within(daily).getByText('Failed')).toBeInTheDocument();
        expect(within(daily).getByText('alice')).toBeInTheDocument();
        const link = within(daily).getByRole('link', { name: /Failed/ });
        expect(link.getAttribute('href')).toContain('run?run_id=daily%3A1');
        const weekly = screen.getByText('Weekly rollup').closest('tr') as HTMLElement;
        expect(within(weekly).getByText('Not scheduled')).toBeInTheDocument();
        expect(within(weekly).getByText('Never run')).toBeInTheDocument();
    });

    test('a next run past the walk shows a dash', () => {
        renderThemed(
            <JobsTable jobs={[job({ next_run: null, next_run_beyond: true })]} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />
        );
        const row = screen.getByText('Daily summary').closest('tr') as HTMLElement;
        expect(within(row).getByText('\u2014')).toBeInTheDocument();
        expect(within(row).queryByText('Not scheduled')).toBeNull();
    });

    test('hides Run now when the user may not run the job', () => {
        const jobs = [job({ permissions: { can_edit: false, can_run: false } })];
        const onRunNow = jest.fn();
        renderThemed(<JobsTable jobs={jobs} me={me} onRunNow={onRunNow} onToggleEnabled={jest.fn()} />);
        expect(screen.queryByRole('button', { name: /Run now/ })).toBeNull();
    });

    test('Run now and the enable switch call back', () => {
        const onRunNow = jest.fn();
        const onToggle = jest.fn();
        renderThemed(<JobsTable jobs={[job()]} me={me} onRunNow={onRunNow} onToggleEnabled={onToggle} />);
        fireEvent.click(screen.getByRole('button', { name: /Run now/ }));
        expect(onRunNow).toHaveBeenCalledWith(expect.objectContaining({ id: 'daily' }));
        fireEvent.click(screen.getByRole('switch'));
        expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'daily' }), false);
    });
});

describe('RunNowDialog', () => {
    const withParams = job({
        params: [
            { name: 'region', type: 'enum', values: ['emea', 'amer'], default: 'emea', label: 'Region' },
            { name: 'days', type: 'number', description: 'How many days back' },
            { name: 'tag', type: 'string', regex: '[a-z]+', default: 'x' },
        ],
    });

    test('RunNowDialog builds a form from declared params and shows validation errors', async () => {
        const startRun = jest.fn().mockResolvedValue({ run_id: 'daily:manual:abc' });
        const onStarted = jest.fn();
        renderThemed(
            <RunNowDialog job={withParams} open onClose={jest.fn()} onStarted={onStarted} startRun={startRun} />
        );
        expect(screen.getByText('Region')).toBeInTheDocument();
        expect(screen.getByText('days')).toBeInTheDocument();
        expect(screen.getByText('How many days back')).toBeInTheDocument();
        expect(screen.getByText('tag')).toBeInTheDocument();

        // Client-side: a required value is missing.
        fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
        expect(await screen.findByText('A value is required.')).toBeInTheDocument();
        expect(startRun).not.toHaveBeenCalled();

        // Client-side: not a number.
        const days = screen.getByLabelText('days');
        fireEvent.change(days, { target: { value: 'abc' } });
        fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
        expect(await screen.findByText('Enter a number.')).toBeInTheDocument();
        expect(startRun).not.toHaveBeenCalled();

        // Server-side errors are shown on the field they name.
        startRun.mockRejectedValueOnce(
            new ApiError(400, 'bad_param', 'parameter run.param.days: not a number: \'1e\'', [
                { level: 'error', code: 'bad_param', message: 'parameter run.param.days: not a number', step: null },
            ])
        );
        fireEvent.change(days, { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
        expect(await screen.findByText("not a number: '1e'")).toBeInTheDocument();
        expect(startRun).toHaveBeenLastCalledWith('daily', { params: { region: 'emea', days: '7', tag: 'x' } });

        fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
        await waitFor(() => expect(onStarted).toHaveBeenCalledWith('daily:manual:abc'));
    });

    test('a job without params starts with an empty form', async () => {
        const startRun = jest.fn().mockResolvedValue({ run_id: 'daily:manual:1' });
        const onStarted = jest.fn();
        renderThemed(<RunNowDialog job={job()} open onClose={jest.fn()} onStarted={onStarted} startRun={startRun} />);
        expect(screen.getByText('This job has no parameters.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
        await waitFor(() => expect(onStarted).toHaveBeenCalledWith('daily:manual:1'));
        expect(startRun).toHaveBeenCalledWith('daily', { params: {} });
    });

    test('other errors are shown above the form', async () => {
        const startRun = jest.fn().mockRejectedValue(new ApiError(409, 'queue_full', "job 'daily' has reached its queue cap"));
        renderThemed(<RunNowDialog job={job()} open onClose={jest.fn()} onStarted={jest.fn()} startRun={startRun} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
        expect(await screen.findByText("job 'daily' has reached its queue cap")).toBeInTheDocument();
    });
});

describe('Delete job', () => {
    function jobsApi(jobs: ReturnType<typeof job>[], over: Partial<JobsApi> = {}): JobsApi {
        let current = jobs;
        return {
            me: jest.fn(() => Promise.resolve(me)),
            listJobs: jest.fn(() => Promise.resolve(current)),
            setJobEnabled: jest.fn(() => Promise.resolve({ job: jobs[0] })),
            deleteJob: jest.fn((id: string) => {
                current = current.filter((j) => j.id !== id);
                return Promise.resolve({ deleted: id });
            }),
            ...over,
        } as unknown as JobsApi;
    }

    test('delete is hidden without edit rights', () => {
        const jobs = [
            job(),
            job({ id: 'weekly', name: 'Weekly rollup', owner: 'bob', permissions: { can_edit: false, can_run: true } }),
        ];
        renderThemed(<JobsTable jobs={jobs} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} onDelete={jest.fn()} />);
        const daily = screen.getByText('Daily summary').closest('tr') as HTMLElement;
        fireEvent.click(within(daily).getByRole('button', { name: 'More actions for Daily summary' }));
        expect(screen.getByRole('menuitem', { name: /Delete…/ })).toBeInTheDocument();
        const weekly = screen.getByText('Weekly rollup').closest('tr') as HTMLElement;
        expect(within(weekly).queryByRole('button', { name: /More actions/ })).toBeNull();
    });

    test('confirm then delete then the table refreshes', async () => {
        const api = jobsApi([job(), job({ id: 'weekly', name: 'Weekly rollup' })]);
        renderThemed(<JobsPage api={api} />);
        fireEvent.click(await screen.findByRole('button', { name: 'More actions for Daily summary' }));
        fireEvent.click(screen.getByRole('menuitem', { name: /Delete…/ }));
        // The confirmation names the job; nothing is deleted yet.
        expect(screen.getByText('Delete Daily summary?')).toBeInTheDocument();
        expect(api.deleteJob).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Delete job' }));
        await waitFor(() => expect(api.deleteJob).toHaveBeenCalledWith('daily'));
        await waitFor(() => expect(screen.queryByText('Daily summary')).toBeNull());
        expect(screen.getByText('Weekly rollup')).toBeInTheDocument();
        expect(api.listJobs).toHaveBeenCalledTimes(2);
    });

    test('a job with active runs shows the 409 message', async () => {
        const api = jobsApi([job()], {
            deleteJob: jest.fn(() =>
                Promise.reject(
                    new ApiError(409, 'job_has_active_runs', "job 'daily' has 1 active or queued run(s); cancel them first")
                )
            ),
        });
        renderThemed(<JobsPage api={api} />);
        fireEvent.click(await screen.findByRole('button', { name: 'More actions for Daily summary' }));
        fireEvent.click(screen.getByRole('menuitem', { name: /Delete…/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete job' }));
        expect(
            await screen.findByText(/Daily summary has active or queued runs\. Cancel them on the Runs page, then delete it\./)
        ).toBeInTheDocument();
        expect(screen.getByText('Daily summary', { selector: 'td *, td' })).toBeInTheDocument();
    });
});

describe('Enable switch', () => {
    test("toggling another person's job keeps its owner: no takeover dialog", async () => {
        const admin = { ...me, user: 'root', can_admin: true };
        const jobs = [job({ owner: 'bob' })];
        const api = {
            me: jest.fn(() => Promise.resolve(admin)),
            listJobs: jest.fn(() => Promise.resolve(jobs)),
            setJobEnabled: jest.fn(() => Promise.resolve({ job: { ...jobs[0], enabled: false } })),
            deleteJob: jest.fn(),
        } as unknown as JobsApi;
        renderThemed(<JobsPage api={api} />);
        await waitFor(() => expect(api.me).toHaveBeenCalled());
        const row = (await screen.findByText('Daily summary')).closest('tr') as HTMLElement;
        fireEvent.click(within(row).getByRole('switch'));
        await waitFor(() => expect(api.setJobEnabled).toHaveBeenCalledWith('daily', false));
        expect(screen.queryByText(/take ownership/)).toBeNull();
        await waitFor(() => expect(api.listJobs).toHaveBeenCalledTimes(2));
    });
});

describe('JobsTable summary, search and empty state', () => {
    test('shows a summary line under each name', () => {
        renderThemed(<JobsTable jobs={[rollupJob()]} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        expect(screen.getByText('Every day at 01:00 · 3 steps')).toBeInTheDocument();
    });

    test('the Find jobs search filters rows and reports no matches', () => {
        renderThemed(<JobsTable jobs={[job(), job({ id: 'w', name: 'Weekly rollup' })]} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        const box = screen.getByRole('searchbox', { name: 'Find jobs' });
        fireEvent.change(box, { target: { value: 'weekly' } });
        expect(screen.queryByText('Daily summary')).toBeNull();
        expect(screen.getByText('Weekly rollup')).toBeInTheDocument();
        fireEvent.change(box, { target: { value: 'zzz' } });
        expect(screen.getByText('No jobs match "zzz".')).toBeInTheDocument();
    });

    test('no search when there are no jobs; builders see templates', () => {
        renderThemed(<JobsTable jobs={[]} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        expect(screen.queryByRole('searchbox')).toBeNull();
        expect(screen.getByText('Build your first job')).toBeInTheDocument();
        const link = screen.getByRole('link', { name: /Blank job/ });
        expect(link.getAttribute('href')).toContain('template=blank');
        ['rollup', 'serial', 'parallel', 'blank'].forEach((key) => {
            const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') || '');
            expect(hrefs.some((h) => h.includes(`template=${key}`))).toBe(true);
        });
        expect(screen.queryByText(/selftest/)).toBeNull();
    });

    test('admins get the install check', () => {
        renderThemed(<JobsTable jobs={[]} me={{ ...me, can_admin: true }} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        expect(screen.getByText(/Check the install first: run/)).toBeInTheDocument();
        const l = screen.getByRole('link', { name: '| orchestrate selftest' });
        expect(l.getAttribute('href')).toBe('/app/search/search?q=%7C%20orchestrate%20selftest');
    });

    test('without can_build the empty state asks for access', () => {
        renderThemed(<JobsTable jobs={[]} me={{ ...me, can_build: false }} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        expect(screen.getByText('No jobs you can run yet. Ask a job owner to add one of your roles under Access.')).toBeInTheDocument();
        expect(screen.queryByText('Build your first job')).toBeNull();
    });
});

test('the Jobs page primary button is Create job', async () => {
    const api = {
        me: jest.fn().mockResolvedValue(me),
        listJobs: jest.fn().mockResolvedValue([job()]),
        setJobEnabled: jest.fn(),
        deleteJob: jest.fn(),
    } as unknown as JobsApi;
    renderThemed(<JobsPage api={api} />);
    expect(await screen.findByRole('link', { name: 'Create job' })).toBeInTheDocument();
});

test('when the jobs fail to load, the Jobs page shows the error and no empty state', async () => {
    const api = {
        me: jest.fn().mockResolvedValue(me),
        listJobs: jest.fn().mockRejectedValue(new Error('splunkd is down')),
        setJobEnabled: jest.fn(),
        deleteJob: jest.fn(),
    } as unknown as JobsApi;
    renderThemed(<JobsPage api={api} />);
    expect(await screen.findByText('The jobs could not be loaded: splunkd is down')).toBeInTheDocument();
    expect(screen.queryByText('Build your first job')).toBeNull();
    expect(screen.queryByText(/No jobs you can run yet/)).toBeNull();
});

test('JobsTable shows nothing for no jobs when loading failed', () => {
    const { container } = renderThemed(<JobsTable jobs={[]} loadFailed me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
});

describe('JobsTable empty state and access', () => {
    test('while access loads, no claim is made', () => {
        renderThemed(<JobsTable jobs={[]} me={undefined} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        expect(screen.queryByText('Build your first job')).toBeNull();
        expect(screen.queryByText(/No jobs you can run yet/)).toBeNull();
    });
    test('when access failed to load, the line is neutral', () => {
        renderThemed(<JobsTable jobs={[]} me={null} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        expect(screen.getByText('No jobs yet.')).toBeInTheDocument();
        expect(screen.queryByText(/No jobs you can run yet/)).toBeNull();
    });
});

describe('Jobs page: recent runs, show and sort', () => {
    const run = (id: string, state: string, t: number) => ({ id, state, trigger: 'cron', scheduled_time: t, started_at: t, ended_at: t + 5, delay_alerted: false, held: false, gave_up: false });
    beforeEach(() => window.localStorage.removeItem('so.jobs.view'));

    test('the newest runs show as icons, oldest first, with how many failed', () => {
        const j = job({ recent_runs: [run('r3', 'failed', 300), run('r2', 'succeeded', 200), run('r1', 'failed', 100)] as never, last_run: run('r3', 'failed', 300) as never });
        renderThemed(<JobsTable jobs={[j]} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        const icons = screen.getAllByTestId('recent-run');
        expect(icons.map((i) => i.getAttribute('data-state'))).toEqual(['failed', 'succeeded', 'failed']);
        expect(icons[2].getAttribute('href')).toBe('run?run_id=r3');
        expect(screen.getByText('2 of the last 3 failed')).toBeInTheDocument();
    });

    test('show and sort filter the rows and are remembered', () => {
        const ok = job({ id: 'a', name: 'Alpha', last_run: run('a1', 'succeeded', 100) as never });
        const bad = job({ id: 'b', name: 'Bravo', last_run: run('b1', 'failed', 50) as never });
        const off = job({ id: 'c', name: 'Charlie', enabled: false });
        const { showJobs, sortJobs } = jest.requireActual('../features/jobs/jobsView');
        expect(showJobs([ok, bad, off], 'failing', me).map((x: { id: string }) => x.id)).toEqual(['b']);
        expect(showJobs([ok, bad, off], 'disabled', me).map((x: { id: string }) => x.id)).toEqual(['c']);
        expect(sortJobs([ok, bad, off], 'failing').map((x: { id: string }) => x.id)).toEqual(['b', 'a', 'c']);
        expect(sortJobs([ok, bad, off], 'last').map((x: { id: string }) => x.id)).toEqual(['a', 'b', 'c']);
        renderThemed(<JobsTable jobs={[ok, bad, off]} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        expect(screen.getByText('Alpha')).toBeInTheDocument();
    });

    test('next run says how soon, warnings filter, and the last run is compared with the usual time', () => {
        const { inText, typicalDuration, slowRatio, showJobs } = jest.requireActual('../features/jobs/jobsView');
        expect(inText(3)).toBe('now');
        expect(inText(40)).toBe('in 40 s');
        expect(inText(360)).toBe('in 6 min');
        expect(inText(3600 * 2 + 300)).toBe('in 2 h 5 min');
        expect(inText(86400 * 3)).toBe('in 3 days');
        const timed = (id: string, state: string, t: number, took: number) => ({ ...run(id, state, t), ended_at: t + took });
        const usual = [timed('r2', 'succeeded', 200, 40), timed('r1', 'succeeded', 100, 50), timed('r0', 'succeeded', 50, 60), timed('rx', 'failed', 10, 900)];
        const slow = job({ next_run: NOW + 360, recent_runs: [timed('r3', 'succeeded', 300, 200), ...usual] as never, last_run: timed('r3', 'succeeded', 300, 200) as never });
        expect(typicalDuration(slow)).toBe(55);
        expect(slowRatio(slow, NOW)).toBeCloseTo(200 / 55);
        const fine = job({ id: 'f', name: 'Fine', recent_runs: usual as never, last_run: usual[0] as never });
        expect(slowRatio(fine, NOW)).toBeNull();
        expect(typicalDuration(job({ recent_runs: usual.slice(0, 2) as never }))).toBeNull();
        const warned = job({ id: 'w', name: 'Warned', warnings: [{ level: 'warning', code: 'missing_target_job', message: "a Start job action starts job 'gone'", step: null }] });
        expect(showJobs([fine, warned], 'warnings', me).map((x: { id: string }) => x.id)).toEqual(['w']);
        renderThemed(<JobsTable jobs={[slow, warned]} me={me} now={NOW} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        const row = screen.getByText('Daily summary').closest('tr') as HTMLElement;
        expect(within(row).getByText('in 6 min')).toBeInTheDocument();
        expect(within(row).getByText('3m 20s')).toBeInTheDocument();
        expect(within(row).getByText('3.6× the usual 55s')).toBeInTheDocument();
        expect(screen.getByTestId('job-warning').textContent).toContain("Warning: a Start job action starts job 'gone'");
    });
});
