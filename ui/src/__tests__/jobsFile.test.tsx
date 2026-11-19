import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import ImportJobDialog from '../features/jobs/ImportJobDialog';
import JobsTable from '../features/jobs/JobsTable';
import { exportFileName, exportJobs, importJobs, parseJobsFile } from '../features/jobs/jobsFile';
import { ApiError } from '../api/client';
import { job, me, renderThemed } from './fixtures';

const steps = [{ id: 's1', name: 'One', type: 'inline', spl: '| makeresults' }];

describe('jobs export file', () => {
    test('exports definitions only, keeps ids, sorted by name', () => {
        const text = exportJobs([job({ id: 'b', name: 'Bravo' }), job({ id: 'a', name: 'Alpha', warnings: [], recent_runs: [] })], new Date('2026-11-19T10:00:00Z'));
        const file = JSON.parse(text);
        expect(file.format).toBe('search_orchestrator.jobs');
        expect(file.jobs.map((j: { id: string }) => j.id)).toEqual(['a', 'b']);
        ['owner', 'permissions', 'last_run', 'next_run', 'recent_runs', 'warnings'].forEach((k) => expect(file.jobs[0][k]).toBeUndefined());
        expect(exportFileName(new Date('2026-11-19T10:00:00Z'))).toBe('search_orchestrator_jobs_2026-11-19.json');
    });

    test('reads an export file, a list, or one job', () => {
        const two = parseJobsFile(JSON.stringify({ format: 'search_orchestrator.jobs', jobs: [{ id: 'a', name: 'A', steps }, { id: 'b', name: 'B', steps }] }));
        expect(two.many).toBe(true);
        expect(two.jobs?.map((j) => j.id)).toEqual(['a', 'b']);
        expect(parseJobsFile(JSON.stringify([{ name: 'A', steps }])).many).toBe(true);
        expect(parseJobsFile(JSON.stringify({ name: 'A', steps })).many).toBe(false);
        expect(parseJobsFile(JSON.stringify({ jobs: [] })).error).toBe('The file has no jobs in it');
        expect(parseJobsFile(JSON.stringify({ jobs: [{ name: 'A', steps }, { name: 'B' }] })).error).toMatch(/^Job 2 in the file: it must be a job object/);
        expect(parseJobsFile('{"jobs": [').error).toMatch(/isn't valid JSON/);
    });

    test('import skips taken ids, turns jobs off and reports failures', async () => {
        const createJob = jest.fn(async (j: { id?: string }) => {
            if (j.id === 'bad') {
                throw new ApiError(400, 'invalid_job', 'invalid', [{ level: 'error', code: 'x', message: 'the job needs a name', step: null }]);
            }
            return {} as never;
        });
        const out = await importJobs([{ id: 'a', name: 'A', steps }, { id: 'taken', name: 'T', steps }, { id: 'bad', name: 'Bad', steps }], ['taken'], createJob as never, true);
        expect(out).toEqual({ added: ['A'], skipped: ['T'], failed: [{ name: 'Bad', message: 'the job needs a name' }] });
        expect(createJob.mock.calls[0][0]).toMatchObject({ id: 'a', enabled: false });
    });

    test('the dialog imports several jobs and says what happened', async () => {
        const createJob = jest.fn().mockResolvedValue({});
        const onImported = jest.fn();
        renderThemed(<ImportJobDialog onClose={jest.fn()} returnFocus={{ current: null }} existingIds={['b']} createJob={createJob} onImported={onImported} />);
        const text = JSON.stringify({ jobs: [{ id: 'a', name: 'Alpha', steps }, { id: 'b', name: 'Bravo', steps }] });
        fireEvent.change(screen.getByLabelText('Paste one job, or a jobs export file'), { target: { value: text } });
        expect(screen.getByTestId('import-summary').textContent).toContain('2 jobs in the file: Alpha and Bravo. 1 job with an id already taken will be skipped');
        fireEvent.click(screen.getByRole('button', { name: 'Import 1 job' }));
        await waitFor(() => expect(screen.getByTestId('import-result')).toBeInTheDocument());
        expect(screen.getByText(/Imported 1 job: Alpha\. They are turned off/)).toBeInTheDocument();
        expect(screen.getByText(/Skipped 1 job whose id is already taken: Bravo/)).toBeInTheDocument();
        expect(onImported).toHaveBeenCalled();
        expect(createJob.mock.calls[0][0]).toMatchObject({ id: 'a', enabled: false });
    });

    test('Export downloads the jobs shown', () => {
        const onExport = jest.fn();
        renderThemed(<JobsTable jobs={[job({ id: 'a', name: 'Alpha' }), job({ id: 'b', name: 'Bravo' })]} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} onExport={onExport} />);
        fireEvent.click(screen.getByRole('button', { name: 'Export all jobs' }));
        expect(onExport.mock.calls[0][0].map((j: { id: string }) => j.id)).toEqual(['a', 'b']);
    });
});
