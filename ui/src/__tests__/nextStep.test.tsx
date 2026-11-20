import { nextStepText } from '../features/run/nextStep';
import { rollupRun } from './fixtures';

describe('nextStepText', () => {
    test('held run, whatever its state', () => {
        const text =
            'Later runs of this job are waiting for this one. Re-run it from the failed step to fix it, or dismiss it to let them start.';
        expect(nextStepText(rollupRun({ state: 'failed', held: true }))).toBe(text);
        expect(nextStepText(rollupRun({ state: 'succeeded', held: true }))).toBe(text);
    });

    test('blocked run names the failed step', () => {
        const run = rollupRun({
            state: 'blocked',
            steps: { daily: { state: 'succeeded' }, weekly: { state: 'failed' }, monthly: { state: 'waiting' } },
        });
        expect(nextStepText(run)).toBe(
            'Weekly rollup failed and nothing after it can start. Fix the cause, then re-run from Weekly rollup.'
        );
    });

    test('failed run names the first failed step in definition order', () => {
        const run = rollupRun({
            state: 'failed',
            steps: { monthly: { state: 'failed' }, weekly: { state: 'failed' }, daily: { state: 'succeeded' } },
        });
        expect(nextStepText(run)).toBe(
            'This run failed. Re-run it from Weekly rollup if its results are still needed.'
        );
    });

    test('falls back to the step id', () => {
        const run = rollupRun({ state: 'failed', steps: { ghost: { state: 'failed' } } });
        expect(nextStepText(run)).toContain('from ghost if');
    });

    test('nothing for other runs', () => {
        expect(nextStepText(rollupRun({ state: 'running' }))).toBeNull();
        expect(nextStepText(rollupRun({ state: 'succeeded' }))).toBeNull();
    });
});
