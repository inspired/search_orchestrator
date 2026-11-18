import React from 'react';
import { screen } from '@testing-library/react';
import RunsTable from '../features/runs/RunsTable';
import { EngineBanner, queueReasonText, stepReasonText } from '../components/WaitReason';
import { NOW, renderThemed, runSummary } from './fixtures';

describe('wait reasons', () => {
    test('say why a run is queued, naming the run that holds it up', () => {
        expect(queueReasonText({ kind: 'waiting_for_run', run_id: 'daily:1', state: 'running' })).toEqual({
            text: "Waits for the job's running run to finish (one run of a job at a time):",
            runId: 'daily:1',
            tone: 'info',
        });
        expect(queueReasonText({ kind: 'behind', ahead: 2, next_run_id: 'daily:2' }).text).toBe('2 queued runs of this job go first. Next:');
        expect(queueReasonText({ kind: 'held', run_id: 'daily:0' }).tone).toBe('warning');
        expect(queueReasonText({ kind: 'engine_stopped', last_seen: NOW - 600 }, NOW).text).toBe(
            'The engine stopped 10 minutes ago, so nothing starts. An admin can check the orchestrator_engine input.'
        );
    });

    test('say why a step waits', () => {
        expect(stepReasonText({ kind: 'waiting_for', steps: ['Count', 'Top'] })).toBe('Waits for Count, Top to finish.');
        expect(stepReasonText({ kind: 'search_slots', job_running: 4, job_max: 4, all_running: 5, all_max: 10 })).toContain('this job has 4 of its 4 searches running');
        expect(stepReasonText({ kind: 'search_slots', job_running: 1, job_max: 4, all_running: 10, all_max: 10 })).toContain('10 of 10 searches are running across all jobs');
    });

    test('the Runs table shows the reason under Queued, with a link', () => {
        const runs = [runSummary({ id: 'daily:2', state: 'queued', queue_reason: { kind: 'waiting_for_run', run_id: 'daily:1', state: 'running' } })];
        renderThemed(<RunsTable runs={runs} jobNames={{}} filters={{}} onFiltersChange={jest.fn()} now={NOW} />);
        expect(screen.getByTestId('queue-reason')).toHaveTextContent("Waits for the job's running run to finish");
        expect(screen.getByRole('link', { name: 'open that run' }).getAttribute('href')).toContain('run_id=daily%3A1');
    });

    test('the engine banner shows only when the engine is not running', () => {
        const { container } = renderThemed(<EngineBanner engine={{ running: true, last_seen: NOW }} />);
        expect(container.textContent).toBe('');
        renderThemed(<EngineBanner engine={{ running: false, last_seen: null }} now={NOW} />);
        expect(screen.getByText(/The engine is not running/)).toBeInTheDocument();
    });
});
