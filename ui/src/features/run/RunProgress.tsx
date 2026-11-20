/* The strip above the run graph: the run's state in words with its icon and the elapsed time
 * (ticking each second from the page's shared clock), a thin bar and "3 of 5 steps finished"
 * (succeeded, failed and skipped count as finished), and "Updates every 5 s" while the run is
 * active. A finished run shows its final time. Theme tokens only. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { JobDefinition, RunState, StepStatus } from '../../api/types';
import StatusText from '../../components/StatusText';
import { formatElapsed } from '../../format';
import { progress } from './runFlow';

export interface RunProgressProps {
    run: { state: RunState; started_at: number | null; ended_at: number | null };
    definition: JobDefinition;
    steps: Record<string, StepStatus | undefined>;
    /** Epoch seconds (useNow). */
    now: number;
    active: boolean;
}

export default function RunProgress({ run, definition, steps, now, active }: RunProgressProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const { finished, total } = progress(definition, steps);
    const elapsed = run.started_at ? formatElapsed((run.ended_at ?? now) - run.started_at) : null;
    const share = total ? finished / total : 0;
    return (
        <div data-testid="run-progress" style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', padding: '6px 14px 10px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em', fontWeight: theme.fontWeightSemiBold as unknown as number }}>
                <StatusText state={run.state} />
                {elapsed && <span>{` · ${elapsed}`}</span>}
            </span>
            <div
                role="progressbar"
                aria-label="Steps finished"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={finished}
                style={{ width: '160px', height: '4px', borderRadius: '2px', background: theme.borderColor, overflow: 'hidden' }}
            >
                <div style={{ width: `${Math.round(share * 100)}%`, height: '100%', background: theme.focusColor }} />
            </div>
            <span>{`${finished} of ${total} steps finished`}</span>
            {active && <span style={{ color: theme.contentColorMuted }}>Updates every 5 s</span>}
        </div>
    );
}
