import React from 'react';
import { act, screen } from '@testing-library/react';
import type { JobDefinition } from '../api/types';
import RunProgress from '../features/run/RunProgress';
import useNow from '../hooks/useNow';
import { formatClock, formatElapsed } from '../format';
import { NOW, renderThemed } from './fixtures';

const def: JobDefinition = {
    name: 'j',
    enabled: true,
    triggers: [],
    steps: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, type: 'inline' as const, spl: 'x' })),
    edges: [],
};
const steps = {
    a: { state: 'succeeded' as const },
    b: { state: 'failed' as const },
    c: { state: 'skipped' as const, skip_kind: 'not_taken' as const },
    d: { state: 'running' as const },
    e: { state: 'waiting' as const },
};

describe('formatting', () => {
    test('formatClock is m:ss, h:mm:ss over an hour', () => {
        expect(formatClock(0)).toBe('0:00');
        expect(formatClock(31)).toBe('0:31');
        expect(formatClock(62)).toBe('1:02');
        expect(formatClock(3725)).toBe('1:02:05');
        expect(formatClock(-4)).toBe('0:00');
    });

    test('formatElapsed spells units with spaces', () => {
        expect(formatElapsed(9)).toBe('9 s');
        expect(formatElapsed(134)).toBe('2 m 14 s');
        expect(formatElapsed(3725)).toBe('1 h 2 m');
    });
});

describe('RunProgress', () => {
    test('an active run: state, elapsed, bar, count and update note', () => {
        renderThemed(<RunProgress run={{ state: 'running', started_at: NOW - 134, ended_at: null }} definition={def} steps={steps} now={NOW} active />);
        expect(screen.getByTestId('run-progress')).toHaveTextContent('Running · 2 m 14 s');
        expect(screen.getByText('3 of 5 steps finished')).toBeInTheDocument();
        expect(screen.getByText('Updates every 5 s')).toBeInTheDocument();
        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '3');
        expect(bar).toHaveAttribute('aria-valuemax', '5');
    });

    test('the elapsed time ticks every second between polls', () => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW * 1000);
        function Live() {
            const now = useNow(true);
            return <RunProgress run={{ state: 'running', started_at: NOW - 10, ended_at: null }} definition={def} steps={steps} now={now} active />;
        }
        try {
            renderThemed(<Live />);
            expect(screen.getByTestId('run-progress')).toHaveTextContent('Running · 10 s');
            act(() => {
                jest.advanceTimersByTime(3000);
            });
            expect(screen.getByTestId('run-progress')).toHaveTextContent('Running · 13 s');
        } finally {
            jest.useRealTimers();
        }
    });

    test('a finished run shows its final time and no update note', () => {
        const done = { ...steps, d: { state: 'succeeded' as const }, e: { state: 'succeeded' as const } };
        renderThemed(<RunProgress run={{ state: 'succeeded', started_at: NOW - 600, ended_at: NOW - 538 }} definition={def} steps={done} now={NOW} active={false} />);
        expect(screen.getByTestId('run-progress')).toHaveTextContent('Succeeded · 1 m 2 s');
        expect(screen.getByText('5 of 5 steps finished')).toBeInTheDocument();
        expect(screen.queryByText('Updates every 5 s')).toBeNull();
    });

    test('a queued run without a start shows just its state', () => {
        renderThemed(<RunProgress run={{ state: 'queued', started_at: null, ended_at: null }} definition={def} steps={{}} now={NOW} active />);
        expect(screen.getByTestId('run-progress')).toHaveTextContent('Queued');
        expect(screen.getByText('0 of 5 steps finished')).toBeInTheDocument();
    });
});
