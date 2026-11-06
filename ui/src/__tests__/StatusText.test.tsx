import React from 'react';
import { screen } from '@testing-library/react';
import StatusText from '../components/StatusText';
import RunBanner, { bannerMessages } from '../components/RunBanner';
import { NOW, renderThemed, rollupRun } from './fixtures';

function backgrounds(container: HTMLElement): string[] {
    const out: string[] = [];
    container.querySelectorAll('*').forEach((el) => {
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
