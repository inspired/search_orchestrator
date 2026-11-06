import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import JobsTable from '../features/jobs/JobsTable';
import RunNowDialog from '../features/jobs/RunNowDialog';
import { ApiError } from '../api/client';
import { formatTime } from '../format';
import { NOW, job, me, renderThemed } from './fixtures';

describe('JobsTable', () => {
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
