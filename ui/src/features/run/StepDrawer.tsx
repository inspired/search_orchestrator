/* Details of one step, opened from the timeline or graph; an approval step's decision too (ApprovalBox). */
import React from 'react';
import Link from '@splunk/react-ui/Link';
import { createURL } from '@splunk/splunk-utils/url';
import type { ConditionStatus, Me, RunDetail } from '../../api/types';
import { conditionKind } from '../builder/conditions';
import StatusText, { isStepDelayed } from '../../components/StatusText';
import { formatDuration, formatTime } from '../../format';
import ApprovalBox, { decidedText } from './ApprovalBox';

/** Links to a search job. `createURL` adds the locale and encodes the sid. */
export function searchJobUrl(sid: string): string {
    return createURL('/app/search/search', { sid });
}

export function jobInspectorUrl(sid: string): string {
    return createURL('/manager/search/job_inspector', { sid });
}

/** A line condition's result in words. */
export function conditionText(c: ConditionStatus | undefined): string {
    if (!c) {
        return 'Not checked yet';
    }
    switch (c.state) {
        case 'met':
            return 'Met';
        case 'not_met':
            return 'Not met';
        case 'failed':
            return `Failed (counts as not met): ${c.error || 'unknown error'}`;
        case 'cancelled':
            return 'Stopped when the run ended';
        default:
            return 'Checking…';
    }
}

export interface StepDrawerProps {
    run: RunDetail;
    stepId: string;
    now: number;
    onClose: () => void;
    /** Who is looking (the me route): Approve and Reject are for users who may approve. */
    me?: Me | null;
    /** An approval decision was sent. */
    onDecided?: () => void;
}

export default function StepDrawer({ run, stepId, now, onClose, me = null, onDecided = () => undefined }: StepDrawerProps) {
    const def = (run.definition.steps || []).find((s) => s.id === stepId);
    const st = (run.steps || {})[stepId];
    if (!def || !st) {
        return null;
    }
    const duration = st.started_at ? formatDuration((st.ended_at ?? now) - st.started_at) : null;
    const stepName = (id: string) => {
        const s = (run.definition.steps || []).find((x) => x.id === id);
        return s ? s.name || s.id : id;
    };
    const conditions = (run.definition.edges || []).filter((e) => e.to === stepId && e.condition === 'expression' && conditionKind(e) !== 'simple');
    return (
        <aside aria-label={`Step ${def.name || def.id}`} style={{ padding: '8px 14px 14px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <strong>{def.name || def.id}</strong>
                <StatusText
                    state={st.state}
                    delayed={isStepDelayed(st)}
                    skipKind={st.skip_kind}
                    detail={st.state === 'awaiting_approval' && st.approval_state ? `since ${formatTime(st.approval_state.requested_at)}` : undefined}
                />
                <span style={{ flex: 1 }} />
                <Link onClick={onClose}>Close</Link>
            </div>
            <ApprovalBox key={stepId} run={run} stepId={stepId} me={me} onDecided={onDecided} />
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
                {st.error && !decidedText(def, st) && (
                    <>
                        <dt>Error</dt>
                        <dd>{st.error}</dd>
                    </>
                )}
                {conditions.map((e) => {
                    const c = (run.conditions || {})[`${e.from}>${e.to}`];
                    return (
                        <React.Fragment key={e.from}>
                            <dt>{`Condition after ${stepName(e.from)}`}</dt>
                            <dd>
                                {conditionText(c)}
                                {c && c.sid && (
                                    <>
                                        {' · '}
                                        <Link to={searchJobUrl(c.sid)} openInNewContext>
                                            Open in Search
                                        </Link>
                                    </>
                                )}
                            </dd>
                        </React.Fragment>
                    );
                })}
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
