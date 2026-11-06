import React from 'react';
import { screen } from '@testing-library/react';
import RunHeader from '../features/run/RunHeader';
import { renderThemed, rollupRun } from './fixtures';

const noop = jest.fn();
const header = (run: ReturnType<typeof rollupRun>, canRun = true) =>
    renderThemed(
        <RunHeader run={run} canRun={canRun} onPause={noop} onResume={noop} onCancel={noop} onRerun={noop} onDismiss={noop} />
    );

describe('RunHeader', () => {
    test('dismiss only on held run', () => {
        const { unmount } = header(rollupRun({ state: 'failed', held: false }));
        expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
        unmount();
        header(rollupRun({ state: 'failed', held: true }));
        expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });

    test('pause toggles to resume', () => {
        const { unmount } = header(rollupRun({ state: 'running' }));
        expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
        unmount();
        header(rollupRun({ state: 'paused' }));
        expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    });

    test('hides controls the user cannot use', () => {
        header(rollupRun({ state: 'running' }), false);
        expect(screen.queryByRole('button')).toBeNull();
    });
});
