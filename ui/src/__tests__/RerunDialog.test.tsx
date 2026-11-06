import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../api/client';
import RerunDialog from '../features/run/RerunDialog';
import { renderThemed, rollupRun } from './fixtures';

const failed = (over = {}) =>
    rollupRun({
        state: 'failed',
        steps: { daily: { state: 'failed' }, weekly: { state: 'waiting' }, monthly: { state: 'waiting' } },
        rerun_latest: {
            daily: { available: true, reason: null },
            weekly: { available: false, reason: "the latest definition removed step 'weekly'" },
            monthly: { available: false, reason: 'x' },
        },
        ...over,
    });

const open = (run: ReturnType<typeof rollupRun>, rerun = jest.fn().mockResolvedValue({})) => {
    renderThemed(<RerunDialog run={run} open onClose={jest.fn()} onStarted={jest.fn()} rerun={rerun} />);
    return rerun;
};
const submit = () => screen.getByRole('button', { name: 'Re-run' });

describe('RerunDialog', () => {
    test('rerun submit disabled until definition chosen when changed', async () => {
        const rerun = open(failed({ definition_changed: true }));
        expect(screen.getByRole('radio', { name: /Latest definition/ })).not.toBeChecked();
        expect(screen.getByRole('radio', { name: /Original definition/ })).not.toBeChecked();
        expect(submit()).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(screen.getByRole('radio', { name: /Original definition/ }));
        expect(submit()).not.toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(submit());
        await waitFor(() => expect(rerun).toHaveBeenCalled());
        expect(rerun).toHaveBeenCalledWith('rollup:1', {
            step: 'daily',
            definition: 'original',
            restart_downstream_jobs: false,
        });
    });

    test('no definition choice shown when unchanged', async () => {
        const rerun = open(failed());
        expect(screen.queryByRole('radio')).toBeNull();
        expect(submit()).not.toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(submit());
        await waitFor(() => expect(rerun).toHaveBeenCalled());
        expect(rerun.mock.calls[0][1]).toEqual({ step: 'daily', restart_downstream_jobs: false });
    });

    test('latest option disabled with reason', () => {
        open(failed({ definition_changed: true, steps: { daily: { state: 'succeeded' }, weekly: { state: 'failed' } } }));
        // starts on the failed step, weekly, where the latest definition is unavailable
        expect(screen.getByRole('radio', { name: /Latest definition/ })).toBeDisabled();
        expect(screen.getByText(/removed step 'weekly'/)).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /Original definition/ })).toBeEnabled();
    });

    test('duplicate warning shown', () => {
        open(failed());
        expect(screen.getByText(/write again when they re-run/)).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Start downstream jobs again' })).not.toBeChecked();
    });

    test('a 409 definition_choice_required from the server asks for a choice', async () => {
        const err = new ApiError(409, 'definition_choice_required', 'the job changed', [], {
            choices: [
                { definition: 'latest', available: true, reason: null },
                { definition: 'original', available: true, reason: null },
            ],
        });
        open(failed(), jest.fn().mockRejectedValue(err));
        fireEvent.click(submit());
        await screen.findByRole('radio', { name: /Latest definition/ });
        expect(screen.getByText('the job changed')).toBeInTheDocument();
        expect(submit()).toHaveAttribute('aria-disabled', 'true');
    });
});
