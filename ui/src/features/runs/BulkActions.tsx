/* Actions on the runs ticked in the Runs table: Cancel, Re-run, Approve and Reject, each
 * offered with how many of the ticked runs it applies to, and only sent for those. A dialog
 * confirms first (Reject needs a comment), and a message says what happened, naming the runs
 * that could not be changed and why. */
import React, { useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Link from '@splunk/react-ui/Link';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import TextArea from '@splunk/react-ui/TextArea';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { BulkAction, BulkResult } from '../../api/client';
import type { RunSummary } from '../../api/types';
import { formatTime } from '../../format';

const ACTIVE = ['queued', 'running', 'paused', 'blocked'];
const RERUNNABLE = ['failed', 'blocked', 'cancelled'];

export type OfferedAction = Extract<BulkAction, 'cancel' | 'rerun' | 'approve' | 'reject'>;

const awaits = (r: RunSummary) => Object.values(r.steps || {}).some((s) => s && s.state === 'awaiting_approval');

/** Which ticked runs each action applies to. */
export function applicable(runs: RunSummary[], action: OfferedAction): RunSummary[] {
    switch (action) {
        case 'cancel':
            return runs.filter((r) => ACTIVE.includes(r.state));
        case 'rerun':
            return runs.filter((r) => RERUNNABLE.includes(r.state));
        default:
            return runs.filter(awaits);
    }
}

const LABEL: Record<OfferedAction, string> = { cancel: 'Cancel', rerun: 'Re-run', approve: 'Approve', reject: 'Reject' };
const DONE: Record<OfferedAction, string> = { cancel: 'Asked to cancel', rerun: 'Re-running', approve: 'Approved', reject: 'Rejected' };
const EXPLAIN: Record<OfferedAction, string> = {
    cancel: 'Each run stops its searches and ends as cancelled.',
    rerun: 'Each run starts again from its first failed step, with the job as it was when the run started. Steps that succeeded keep their results.',
    approve: 'Every step these runs are waiting on is approved, as if you approved each one on its run page.',
    reject: 'Every step these runs are waiting on is rejected. The comment is kept with each decision.',
};

const runs = (n: number) => `${n} run${n === 1 ? '' : 's'}`;

export interface Outcome {
    action: OfferedAction;
    results: BulkResult[];
}

export function outcomeText(o: Outcome, label: (runId: string) => string): { ok: string | null; failed: string[] } {
    const ok = o.results.filter((r) => r.ok).length;
    return {
        ok: ok ? `${DONE[o.action]} ${runs(ok)}.` : null,
        failed: o.results.filter((r) => !r.ok).map((r) => `${label(r.run_id)}: ${r.message || r.code || 'failed'}`),
    };
}

export interface BulkActionsProps {
    selected: RunSummary[];
    canApprove: boolean;
    jobNames: Record<string, string>;
    onClear: () => void;
    send: (action: BulkAction, runIds: string[], comment?: string) => Promise<BulkResult[]>;
    onDone: (outcome: Outcome) => void;
}

export default function BulkActions({ selected, canApprove, jobNames, onClear, send, onDone }: BulkActionsProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [asking, setAsking] = useState<OfferedAction | null>(null);
    const [comment, setComment] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const opener = useRef<HTMLElement | null>(null);
    const offered: OfferedAction[] = (['cancel', 'rerun', 'approve', 'reject'] as OfferedAction[]).filter(
        (a) => (a === 'approve' || a === 'reject' ? canApprove : true) && applicable(selected, a).length > 0
    );
    const targets = asking ? applicable(selected, asking) : [];

    const confirm = async () => {
        if (!asking) {
            return;
        }
        if (asking === 'reject' && !comment.trim()) {
            setError('Add a comment saying why you reject');
            return;
        }
        setSending(true);
        setError(null);
        try {
            const results = await send(
                asking,
                targets.map((r) => r.id),
                comment.trim() || undefined
            );
            onDone({ action: asking, results });
            setAsking(null);
            setComment('');
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSending(false);
        }
    };

    return (
        <div
            data-testid="bulk-actions"
            role="region"
            aria-label="Actions on the selected runs"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '8px 12px', margin: '0 0 8px', border: `1px solid ${theme.borderColor}`, borderRadius: '4px', background: theme.backgroundColorSection }}
        >
            <strong style={{ marginRight: '4px' }}>{`${runs(selected.length)} selected`}</strong>
            {offered.length === 0 && <span style={{ color: theme.contentColorMuted }}>Nothing to do on these runs.</span>}
            {offered.map((a) => (
                <Button
                    key={a}
                    appearance={a === 'cancel' || a === 'reject' ? 'secondary' : 'primary'}
                    label={`${LABEL[a]} ${applicable(selected, a).length}`}
                    onClick={() => {
                        opener.current = document.activeElement as HTMLElement | null;
                        setAsking(a);
                        setError(null);
                    }}
                />
            ))}
            <Link onClick={onClear} style={{ marginLeft: 'auto' }}>
                Clear selection
            </Link>
            {asking && (
                <Modal open onRequestClose={() => setAsking(null)} returnFocus={opener} style={{ width: '560px' }}>
                    <Modal.Header title={`${LABEL[asking]} ${runs(targets.length)}?`} />
                    <Modal.Body>
                        {error && (
                            <Message type="error" appearance="default">
                                {error}
                            </Message>
                        )}
                        <p style={{ marginTop: 0 }}>{EXPLAIN[asking]}</p>
                        {targets.length < selected.length && (
                            <p style={{ color: theme.contentColorMuted }}>{`The other ${runs(selected.length - targets.length)} you selected can't be changed this way and are left as they are.`}</p>
                        )}
                        <ul data-testid="bulk-targets" style={{ maxHeight: '160px', overflowY: 'auto', margin: '0 0 12px', paddingLeft: '20px' }}>
                            {targets.map((r) => (
                                <li key={r.id}>{`${jobNames[r.job_id] || r.job_id} · ${r.number ? `run #${r.number} · ` : ''}${formatTime(r.scheduled_time)}`}</li>
                            ))}
                        </ul>
                        {(asking === 'approve' || asking === 'reject') && (
                            <ControlGroup label={asking === 'reject' ? 'Comment (required)' : 'Comment (optional)'} labelFor="bulk-comment" labelPosition="top">
                                <TextArea inputId="bulk-comment" value={comment} rowsMin={2} onChange={(_e: unknown, { value }: { value: string }) => setComment(value)} />
                            </ControlGroup>
                        )}
                    </Modal.Body>
                    <Modal.Footer>
                        <Button appearance="secondary" label="Back" onClick={() => setAsking(null)} />
                        <Button appearance="primary" label={sending ? 'Working…' : `${LABEL[asking]} ${runs(targets.length)}`} disabled={sending} onClick={confirm} />
                    </Modal.Footer>
                </Modal>
            )}
        </div>
    );
}
