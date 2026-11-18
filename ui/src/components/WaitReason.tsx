/* Why a run is queued or a step hasn't started, in words, with a link to the run that holds
 * it up when there is one (bin/so/queue_info.py). Shown under the status on the Runs page,
 * in the run header and in the step drawer, so nobody has to go looking. */
import React from 'react';
import Link from '@splunk/react-ui/Link';
import Message from '@splunk/react-ui/Message';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { EngineStatus, QueueReason, StepReason } from '../api/types';
import { formatAgo } from '../format';
import { pageHref } from './PageShell';

const STATE_WORD: Record<string, string> = { running: 'running', blocked: 'blocked', paused: 'paused' };

/** The reason in words, and the run it names (if any). */
export function queueReasonText(r: QueueReason, now: number = Math.floor(Date.now() / 1000)): { text: string; runId?: string; tone: 'info' | 'warning' | 'error' } {
    switch (r.kind) {
        case 'engine_stopped':
            return {
                text:
                    r.last_seen === null
                        ? 'The engine is not running, so nothing starts. An admin can check the orchestrator_engine input.'
                        : `The engine stopped ${formatAgo(now - r.last_seen)}, so nothing starts. An admin can check the orchestrator_engine input.`,
                tone: 'error',
            };
        case 'held':
            return { text: 'Blocked by a run that gave up. Re-run or dismiss it to let this one start:', runId: r.run_id, tone: 'warning' };
        case 'waiting_for_run':
            return { text: `Waits for the job's ${STATE_WORD[r.state] || r.state} run to finish (one run of a job at a time):`, runId: r.run_id, tone: 'info' };
        case 'behind':
            return { text: `${r.ahead} queued run${r.ahead === 1 ? '' : 's'} of this job go${r.ahead === 1 ? 'es' : ''} first. Next:`, runId: r.next_run_id, tone: 'info' };
        default:
            return { text: 'Starts within a few seconds.', tone: 'info' };
    }
}

export function stepReasonText(r: StepReason): string {
    switch (r.kind) {
        case 'waiting_for':
            return `Waits for ${r.steps.join(', ')} to finish.`;
        case 'search_slots':
            return r.job_running >= r.job_max
                ? `Waits for a search slot: this job has ${r.job_running} of its ${r.job_max} searches running (Settings → Searches at once per job).`
                : `Waits for a search slot: ${r.all_running} of ${r.all_max} searches are running across all jobs (Settings → Searches at once).`;
        default:
            return 'Starts within a few seconds.';
    }
}

/** One line: the reason and a link to the run it names. */
export function QueueReasonLine({ reason }: { reason: QueueReason }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const { text, runId, tone } = queueReasonText(reason);
    const color = tone === 'error' ? theme.statusColorHigh : tone === 'warning' ? theme.statusColorMedium : theme.contentColorMuted;
    return (
        <span data-testid="queue-reason" style={{ display: 'block', fontSize: '12px', color }}>
            {text}
            {runId && (
                <>
                    {' '}
                    <Link to={pageHref('run', { run_id: runId })}>open that run</Link>
                </>
            )}
        </span>
    );
}

/** A banner when the engine isn't ticking. */
export function EngineBanner({ engine, now = Math.floor(Date.now() / 1000) }: { engine?: EngineStatus | null; now?: number }) {
    if (!engine || engine.running) {
        return null;
    }
    return (
        <Message type="error" appearance="fill">
            {queueReasonText({ kind: 'engine_stopped', last_seen: engine.last_seen }, now).text}
        </Message>
    );
}
