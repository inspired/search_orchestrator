import React from 'react';
import { screen } from '@testing-library/react';
import DeadlineMessage from '../features/run/DeadlineMessage';
import RunHeader from '../features/run/RunHeader';
import { renderThemed, rollupRun } from './fixtures';

const DEADLINE = Date.UTC(2026, 10, 17, 6, 0, 0) / 1000;

describe('DeadlineMessage', () => {
    test('shows nothing unless the run is late', () => {
        const { container } = renderThemed(
            <DeadlineMessage run={rollupRun({ deadline_at: DEADLINE, late_at: null })} now={DEADLINE} timezone="UTC" />
        );
        expect(container.textContent).toBe('');
    });

    test('a running late run says it is still running', () => {
        renderThemed(
            <DeadlineMessage run={rollupRun({ state: 'running', deadline_at: DEADLINE, late_at: DEADLINE + 60 })} now={DEADLINE + 120} timezone="UTC" />
        );
        expect(screen.getByText('This run missed its deadline (06:00). It is still running.')).toBeInTheDocument();
    });

    test('an ended late run says how late it finished', () => {
        renderThemed(
            <DeadlineMessage
                run={rollupRun({ state: 'succeeded', deadline_at: DEADLINE, late_at: DEADLINE + 60, ended_at: DEADLINE + 720 })}
                now={DEADLINE + 900}
                timezone="UTC"
            />
        );
        expect(screen.getByText('This run missed its deadline (06:00). It finished 12 minutes late.')).toBeInTheDocument();
    });
});

test('the run header shows a muted deadline', () => {
    const noop = jest.fn();
    renderThemed(
        <RunHeader
            run={rollupRun({ deadline_at: DEADLINE, definition: { ...rollupRun().definition, timezone: 'UTC' } })}
            canRun
            onPause={noop}
            onResume={noop}
            onCancel={noop}
            onRerun={noop}
            onDismiss={noop}
        />
    );
    expect(screen.getByText('Deadline 06:00')).toBeInTheDocument();
});
