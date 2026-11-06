/* Details of one step, opened from the timeline or graph. */
import React from 'react';
import Link from '@splunk/react-ui/Link';
import { createURL } from '@splunk/splunk-utils/url';
import type { RunDetail } from '../../api/types';
import StatusText, { isStepDelayed } from '../../components/StatusText';
import { formatDuration, formatTime } from '../../format';

/** Links to a search job. `createURL` adds the locale and encodes the sid. */
export function searchJobUrl(sid: string): string {
    return createURL('/app/search/search', { sid });
}

export function jobInspectorUrl(sid: string): string {
    return createURL('/manager/search/job_inspector', { sid });
}

export interface StepDrawerProps {
    run: RunDetail;
    stepId: string;
    now: number;
    onClose: () => void;
}

export default function StepDrawer({ run, stepId, now, onClose }: StepDrawerProps) {
    const def = (run.definition.steps || []).find((s) => s.id === stepId);
    const st = (run.steps || {})[stepId];
    if (!def || !st) {
        return null;
    }
    const duration = st.started_at ? formatDuration((st.ended_at ?? now) - st.started_at) : null;
    return (
        <aside aria-label={`Step ${def.name || def.id}`} style={{ padding: '8px 14px 14px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <strong>{def.name || def.id}</strong>
                <StatusText state={st.state} delayed={isStepDelayed(st)} skipKind={st.skip_kind} />
                <span style={{ flex: 1 }} />
                <Link onClick={onClose}>Close</Link>
            </div>
            <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
                <dt>Attempt</dt>
                <dd>{st.attempt || 0}</dd>
                {st.started_at ? (
                    <>
                        <dt>Started</dt>
                        <dd>{formatTime(st.started_at)}</dd>
                    </>
                ) : null}
                {duration && (
                    <>
                        <dt>Duration</dt>
                        <dd>{duration}</dd>
                    </>
                )}
                {st.result_count !== null && st.result_count !== undefined && (
                    <>
                        <dt>Results</dt>
                        <dd>{st.result_count}</dd>
                    </>
                )}
                {st.error && (
                    <>
                        <dt>Error</dt>
                        <dd>{st.error}</dd>
                    </>
                )}
                {st.sid && (
                    <>
                        <dt>Search job</dt>
                        <dd>
                            <Link to={searchJobUrl(st.sid)} openInNewContext>
                                Open in Search
                            </Link>
                            {' · '}
                            <Link to={jobInspectorUrl(st.sid)} openInNewContext>
                                Job Inspector
                            </Link>
                        </dd>
                    </>
                )}
            </dl>
        </aside>
    );
}
