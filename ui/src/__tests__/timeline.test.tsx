import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import Timeline from '../features/run/Timeline';
import { bars } from '../features/run/bars';
import StepDrawer from '../features/run/StepDrawer';
import { NOW, renderThemed, rollupRun } from './fixtures';

const run = rollupRun({
    started_at: NOW - 6000,
    steps: {
        daily: { state: 'running', started_at: NOW - 3000, sid: 'scheduler__admin__x:1', attempt: 1 },
        weekly: { state: 'waiting' },
        monthly: { state: 'skipped', skip_kind: 'not_taken' },
    },
});

describe('Timeline', () => {
    test('renders solid running, hatched waiting and no bar for skipped', () => {
        renderThemed(<Timeline run={run} now={NOW} onSelect={jest.fn()} />);
        expect(screen.getByTestId('bar-daily')).toHaveAttribute('data-pattern', 'solid');
        expect(screen.getByTestId('bar-weekly')).toHaveAttribute('data-pattern', 'hatched');
        expect(screen.queryByTestId('bar-monthly')).toBeNull();
        expect(screen.getByText('Skipped (not taken)')).toBeInTheDocument();
    });

    test('step click opens drawer with sid link', () => {
        function Host() {
            const [sel, setSel] = React.useState<string | null>(null);
            return (
                <>
                    <Timeline run={run} now={NOW} selected={sel} onSelect={setSel} />
                    {sel && <StepDrawer run={run} stepId={sel} now={NOW} onClose={() => setSel(null)} />}
                </>
            );
        }
        renderThemed(<Host />);
        expect(screen.queryByRole('complementary')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Daily summary' }));
        const drawer = screen.getByRole('complementary');
        const search = drawer.querySelector('a[href*="/app/search/search"]') as HTMLAnchorElement;
        expect(search.getAttribute('href')).toContain('sid=scheduler__admin__x%3A1');
        expect(search.getAttribute('href')).toContain('/en-US/');
        const inspector = drawer.querySelector('a[href*="job_inspector"]') as HTMLAnchorElement;
        expect(inspector.getAttribute('href')).toContain('sid=scheduler__admin__x%3A1');
    });
});

const withSteps = (steps: Record<string, object>) => rollupRun({ started_at: NOW - 6000, steps: steps as never });

describe('timeline.bars', () => {
    test('running bar solid and waiting bar hatched', () => {
        const out = bars(
            withSteps({
                daily: { state: 'running', started_at: NOW - 3000, delay_alerted: true },
                weekly: { state: 'waiting' },
                monthly: { state: 'waiting' },
            }),
            NOW
        );
        expect(out[0]).toMatchObject({ kind: 'running', statusText: 'Delayed', delayed: true });
        expect(out[0].startPct).toBeCloseTo(50);
        expect(out[0].widthPct).toBeCloseTo(50);
        expect(out[1]).toMatchObject({ kind: 'waiting', statusText: 'Waiting' });
        expect(out[1].widthPct).toBeGreaterThan(0);
    });

    test('skipped has no bar', () => {
        const out = bars(
            withSteps({
                daily: { state: 'succeeded', started_at: NOW - 6000, ended_at: NOW - 3000 },
                weekly: { state: 'skipped', skip_kind: 'run_when' },
                monthly: { state: 'skipped', skip_kind: 'not_taken' },
            }),
            NOW
        );
        expect(out[0]).toMatchObject({ kind: 'done', startPct: 0 });
        expect(out[1]).toMatchObject({ kind: 'skipped', widthPct: 0, statusText: 'Skipped (run when)' });
        expect(out[2].statusText).toBe('Skipped (not taken)');
    });
});
