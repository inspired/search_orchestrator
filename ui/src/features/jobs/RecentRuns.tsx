/* A job's newest runs as status icons, oldest left, newest right: each links to its run and
 * names its state and time. Colour only on failed and delayed runs (as StatusText). */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Job } from '../../api/types';
import { isRunDelayed, statusIcon, statusLabel } from '../../components/StatusText';
import { pageHref } from '../../components/PageShell';
import { formatTime } from '../../format';
import { failedCount } from './jobsView';

export default function RecentRuns({ job }: { job: Job }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const runs = [...(job.recent_runs || [])].reverse();
    if (!runs.length) {
        return <span style={{ color: theme.contentColorMuted }}>Never run</span>;
    }
    const n = failedCount(job);
    return (
        <div>
            <div role="list" aria-label={`Last ${runs.length} runs of ${job.name}`} style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                {runs.map((r) => {
                    const delayed = isRunDelayed(r);
                    const Icon = statusIcon(r.state, delayed);
                    const label = `${statusLabel(r.state, delayed)} · ${formatTime(r.scheduled_time)}`;
                    const color = r.state === 'failed' ? theme.statusColorHigh : delayed ? theme.statusColorMedium : theme.contentColorMuted;
                    return (
                        <a key={r.id} role="listitem" href={pageHref('run', { run_id: r.id })} title={label} aria-label={label} data-testid="recent-run" data-state={r.state} style={{ color, display: 'inline-flex', padding: '2px' }}>
                            <Icon aria-hidden width="16" height="16" />
                        </a>
                    );
                })}
            </div>
            {n > 0 && <div style={{ fontSize: '12px', color: theme.statusColorHigh }}>{`${n} of the last ${runs.length} failed`}</div>}
        </div>
    );
}
