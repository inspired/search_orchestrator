/* A banner at the top of every app page while any step waits for approval: how many,
 * the first few (job, step, message, how long it has waited) and Review, which opens the run
 * page with that step's drawer (Approve and Reject are there). Looks at running and paused
 * runs (a paused run's approval can be decided now and applies on resume). Checks every 30
 * seconds while the tab is visible, and at once when it becomes visible again; errors leave
 * it hidden. */
import React, { useEffect, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import { listRuns } from '../api/client';
import type { RunSummary } from '../api/types';
import { formatAgo } from '../format';

export const APPROVAL_POLL_MS = 30000;
const SHOWN = 3;

export interface PendingApproval {
    runId: string;
    jobId: string;
    stepId: string;
    message: string;
    since: number | null;
}

/** Every step waiting for approval in `runs`, longest waiting first. */
export function pendingApprovals(runs: RunSummary[]): PendingApproval[] {
    const out: PendingApproval[] = [];
    runs.forEach((run) =>
        Object.entries(run.steps || {}).forEach(([stepId, st]) => {
            if (st && st.state === 'awaiting_approval') {
                out.push({
                    runId: run.id,
                    jobId: run.job_id,
                    stepId,
                    message: (st.approval_state && st.approval_state.message) || '',
                    since: (st.approval_state && st.approval_state.requested_at) || st.started_at || null,
                });
            }
        })
    );
    return out.sort((a, b) => (a.since || 0) - (b.since || 0));
}

export function reviewHref(p: PendingApproval): string {
    const params = new URLSearchParams({ run_id: p.runId, step: p.stepId }).toString();
    return `run?${params}`;
}

// One function for every render: the effect below depends on it.
const runningRuns = () =>
    Promise.all([listRuns({ state: 'running' }), listRuns({ state: 'paused' })]).then(([a, b]) => [...a, ...b]);

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export default function ApprovalAlert({ load = runningRuns }: { load?: () => Promise<RunSummary[]> }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [pending, setPending] = useState<PendingApproval[]>([]);
    useEffect(() => {
        let live = true;
        const check = () => {
            if (hidden()) {
                return;
            }
            load()
                .then((runs) => live && setPending(pendingApprovals(runs)))
                .catch(() => undefined);
        };
        check();
        const timer = setInterval(check, APPROVAL_POLL_MS);
        document.addEventListener('visibilitychange', check);
        return () => {
            live = false;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', check);
        };
    }, [load]);
    if (!pending.length) {
        return null;
    }
    const now = Math.floor(Date.now() / 1000);
    const accent = theme.statusColorMedium;
    return (
        <section
            role="alert"
            aria-label="Waiting for approval"
            data-testid="approval-alert"
            style={{
                border: `2px solid ${accent}`,
                borderLeftWidth: '6px',
                borderRadius: '6px',
                padding: '10px 14px',
                margin: '0 0 16px',
                background: theme.backgroundColorSection || theme.backgroundColor,
                display: 'grid',
                gap: '6px',
            }}
        >
            <strong style={{ color: accent, fontSize: '15px' }}>
                {pending.length === 1 ? '⚑ 1 step is waiting for approval' : `⚑ ${pending.length} steps are waiting for approval`}
            </strong>
            {pending.slice(0, SHOWN).map((p) => (
                <div key={`${p.runId}:${p.stepId}`} style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{p.jobId}</span>
                    <span>{p.stepId}</span>
                    {p.message && <span style={{ color: theme.contentColorMuted, minWidth: 0, overflowWrap: 'anywhere' }}>{`“${p.message}”`}</span>}
                    {p.since && <span style={{ color: theme.contentColorMuted, fontSize: '12px' }}>{`waiting ${formatAgo(now - p.since).replace(/ ago$/, '')}`}</span>}
                    <span style={{ flex: 1 }} />
                    <Button appearance="primary" label="Review" to={reviewHref(p)} />
                </div>
            ))}
            {pending.length > SHOWN && (
                <a href="runs?state=attention" style={{ color: theme.contentColorLink }}>
                    {`and ${pending.length - SHOWN} more`}
                </a>
            )}
        </section>
    );
}
