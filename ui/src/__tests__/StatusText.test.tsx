import React from 'react';
import { screen } from '@testing-library/react';
import StatusText from '../components/StatusText';
import JobsTable from '../features/jobs/JobsTable';
import RunsTable from '../features/runs/RunsTable';
import RunBanner, { bannerMessages } from '../components/RunBanner';
import { NOW, job, me, renderThemed, rollupRun, runSummary } from './fixtures';

function backgrounds(container: Element): string[] {
    const out: string[] = [];
    [container, ...Array.from(container.querySelectorAll('*'))].forEach((el) => {
        const node = el as HTMLElement;
        const computed = window.getComputedStyle(node);
        [node.style.background, node.style.backgroundColor, computed.backgroundColor, computed.background].forEach(
            (v) => {
                if (v && v !== 'transparent' && v !== 'rgba(0, 0, 0, 0)' && v !== 'none') {
                    out.push(`${node.tagName}: ${v}`);
                }
            }
        );
    });
    return out;
}

describe('StatusText', () => {
    test.each(['queued', 'running', 'blocked', 'paused', 'succeeded', 'failed', 'cancelled'] as const)(
        'StatusText renders no filled background (%s)',
        (state) => {
            const { container } = renderThemed(<StatusText state={state} delayed={state === 'running'} />);
            expect(backgrounds(container)).toEqual([]);
            expect(container.querySelector('svg')).not.toBeNull();
        }
    );

    test('StatusText renders no filled background inside JobsTable and RunsTable cells', () => {
        const states = ['queued', 'running', 'blocked', 'paused', 'succeeded', 'failed', 'cancelled'] as const;
        const jobs = states.map((state, i) =>
            job({
                id: `j${i}`,
                name: `Job ${i}`,
                last_run: {
                    id: `j${i}:1`,
                    state,
                    trigger: 'cron',
                    scheduled_time: NOW,
                    started_at: NOW,
                    ended_at: null,
                    delay_alerted: state === 'running',
                    held: false,
                    gave_up: false,
                },
            })
        );
        const runs = states.map((state, i) =>
            runSummary({ id: `r:${i}`, state, delay_alerted: state === 'queued' })
        );
        const { container: jobsTable } = renderThemed(
            <JobsTable jobs={jobs} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />
        );
        const { container: runsTable } = renderThemed(
            <RunsTable runs={runs} jobNames={{ daily: 'Daily' }} filters={{}} onFiltersChange={jest.fn()} now={NOW} />
        );
        [jobsTable, runsTable].forEach((table) => {
            const statuses = table.querySelectorAll('[data-state]');
            expect(statuses).toHaveLength(states.length);
            statuses.forEach((status) => {
                expect(backgrounds(status)).toEqual([]);
                // The cell holding it is not filled either.
                const cell = status.closest('td') as HTMLElement;
                expect(cell.style.background).toBe('');
                expect(cell.style.backgroundColor).toBe('');
            });
            expect(table.querySelectorAll('[data-delayed="true"]')).toHaveLength(1);
        });
    });

    test('renders plain text labels', () => {
        renderThemed(<StatusText state="succeeded" />);
        expect(screen.getByText('Succeeded')).toBeInTheDocument();
    });

    test('colours only failed and delayed', () => {
        const { container: failed } = renderThemed(<StatusText state="failed" />);
        const { container: delayed } = renderThemed(<StatusText state="running" delayed />);
        const { container: ok } = renderThemed(<StatusText state="succeeded" />);
        const colour = (c: HTMLElement) => (c.firstElementChild as HTMLElement).style.color;
        expect(colour(failed)).not.toBe('');
        expect(colour(delayed)).not.toBe('');
        expect(colour(delayed)).not.toBe(colour(failed));
        expect(colour(ok)).toBe('');
        expect(screen.getByText('Delayed')).toBeInTheDocument();
    });

    test('names the kind of skip', () => {
        renderThemed(<StatusText state="skipped" skipKind="run_when" />);
        renderThemed(<StatusText state="skipped" skipKind="not_taken" />);
        expect(screen.getByText('Skipped (run when)')).toBeInTheDocument();
        expect(screen.getByText('Skipped (not taken)')).toBeInTheDocument();
    });
});

describe('RunBanner', () => {
    test('delayed banner text matches pattern', () => {
        const run = rollupRun({
            delay_base: NOW - (3600 + 42 * 60),
            delay_alerted: true,
            steps: {
                daily: { state: 'running', delay_alerted: true },
                weekly: { state: 'waiting', delay_alerted: true },
                monthly: { state: 'waiting', delay_alerted: true },
            },
        });
        expect(bannerMessages(run, NOW)).toEqual([
            {
                type: 'warning',
                text:
                    'Daily summary is delayed. It passed its 60 minute threshold 42 minutes ago. ' +
                    'Weekly rollup will start when it finishes.',
            },
        ]);
        renderThemed(<RunBanner run={run} now={NOW} />);
        expect(
            screen.getByText(/^Daily summary is delayed\. It passed its 60 minute threshold 42 minutes ago\./)
        ).toBeInTheDocument();
    });

    test('blocked banner names failed step', () => {
        const run = rollupRun({
            state: 'blocked',
            steps: {
                daily: { state: 'failed', error: 'search failed: no such index' },
                weekly: { state: 'waiting' },
                monthly: { state: 'waiting' },
            },
        });
        const messages = bannerMessages(run, NOW);
        expect(messages).toEqual([
            {
                type: 'error',
                text:
                    'This run is blocked: Daily summary failed (search failed: no such index). ' +
                    'Weekly rollup is waiting on it. Re-run from the failed step or cancel the run.',
            },
        ]);
        renderThemed(<RunBanner run={run} now={NOW} />);
        expect(screen.getByText(/Daily summary failed/)).toBeInTheDocument();
    });

    test('no banner for a run that is on time', () => {
        const run = rollupRun({ steps: { daily: { state: 'running' }, weekly: { state: 'waiting' } } });
        expect(bannerMessages(run, NOW)).toEqual([]);
        const { container } = renderThemed(<RunBanner run={run} now={NOW} />);
        expect(container.textContent).toBe('');
    });
});
