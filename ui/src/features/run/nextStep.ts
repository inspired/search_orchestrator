/* What to do next about a run that needs attention, in plain words. */
import type { RunDetail } from '../../api/types';

function failedStepName(run: RunDetail): string {
    const status = run.steps || {};
    const step = (run.definition.steps || []).find((s) => status[s.id] && status[s.id].state === 'failed');
    if (step) {
        return step.name || step.id;
    }
    // A failed step missing from the definition snapshot: fall back to its id.
    const orphan = Object.keys(status).find((id) => status[id].state === 'failed');
    return orphan || 'the failed step';
}

/** The advice sentence for a blocked run. */
export function blockedAdvice(run: RunDetail): string {
    return `Fix the cause, then re-run from ${failedStepName(run)}.`;
}

/** The next-step guidance for a run, or null when it needs nothing. */
export function nextStepText(run: RunDetail): string | null {
    if (run.held) {
        return 'Later runs of this job are waiting for this one. Re-run it from the failed step to fix it, or dismiss it to let them start.';
    }
    if (run.state === 'blocked') {
        return `${failedStepName(run)} failed and nothing after it can start. ${blockedAdvice(run)}`;
    }
    if (run.state === 'failed') {
        return `This run failed. Re-run it from ${failedStepName(run)} if its results are still needed.`;
    }
    return null;
}
