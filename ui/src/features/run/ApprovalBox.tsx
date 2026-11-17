/* The decision part of an approval step's drawer. While the step waits, users who may approve
 * (me.can_approve; the server checks the step's roles and says why when it refuses) see the
 * step's message and Approve and Reject, each confirmed in a Modal with a comment (required to
 * reject). Once decided, everyone sees who decided and why. */
import React, { useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import TextArea from '@splunk/react-ui/TextArea';
import { decide } from '../../api/approvals';
import type { Me, RunDetail, StepDef, StepStatus } from '../../api/types';
import ErrorMessage from './ErrorMessage';

type Decision = 'approve' | 'reject';

export interface ApprovalBoxProps {
    run: RunDetail;
    stepId: string;
    me: Me | null;
    /** The decision was sent: refresh the run. */
    onDecided: () => void;
}

/** "4 hours", "30 minutes". Keep in step with the server's approval._duration
 * (bin/so/approval.py, `"%g %s%s"`): the same wording is in a rejected step's error. */
function duration(seconds: number): string {
    const [n, unit] = seconds >= 3600 ? [seconds / 3600, 'hour'] : [seconds / 60, 'minute'];
    const amount = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
    return `${amount} ${unit}${n === 1 ? '' : 's'}`;
}

/** "Approved by bob: ok", "Rejected: no decision within 4 hours"; null while undecided. */
export function decidedText(step: StepDef, st: StepStatus): string | null {
    const a = st.approval_state;
    if (!a || (a.decision !== 'approve' && a.decision !== 'reject')) {
        return null;
    }
    const verb = a.decision === 'approve' ? 'Approved' : 'Rejected';
    if (a.by === 'timeout') {
        const timeout = step.approval && step.approval.timeout;
        return timeout ? `${verb}: no decision within ${duration(timeout)}` : `${verb}: no decision in time`;
    }
    return `${verb} by ${a.by || 'someone'}${a.comment ? `: ${a.comment}` : ''}`;
}

export default function ApprovalBox({ run, stepId, me, onDecided }: ApprovalBoxProps) {
    const [asking, setAsking] = useState<Decision | null>(null);
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [sent, setSent] = useState(false);
    const opener = useRef<HTMLElement | null>(null);
    const step = (run.definition.steps || []).find((s) => s.id === stepId);
    const st = (run.steps || {})[stepId];
    if (!step || step.type !== 'approval' || !st) {
        return null;
    }
    const decided = decidedText(step, st);
    if (decided) {
        return (
            <p data-testid="approval-decided" style={{ margin: '8px 0' }}>
                {decided}
            </p>
        );
    }
    if (st.state !== 'awaiting_approval' || !me || !me.can_approve) {
        return null;
    }
    const name = step.name || step.id;
    const message = (st.approval_state && st.approval_state.message) || `${name} waits for someone to approve or reject it.`;
    if (sent) {
        return (
            <Message type="success" appearance="default">
                Decision sent. The run updates in a few seconds.
            </Message>
        );
    }

    const open = (decision: Decision) => (ev: React.MouseEvent) => {
        opener.current = ev.currentTarget as HTMLElement;
        setComment('');
        setError(null);
        setAsking(decision);
    };
    const close = () => {
        if (!busy) {
            setAsking(null);
        }
    };
    const needsComment = asking === 'reject' && !comment.trim();
    const send = async () => {
        if (!asking || needsComment || busy) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await decide(run.id, stepId, asking, comment.trim());
            setAsking(null);
            setSent(true);
            onDecided();
        } catch (err) {
            setError(err as Error);
        } finally {
            setBusy(false);
        }
    };
    const verb = asking === 'reject' ? 'Reject' : 'Approve';

    return (
        <div style={{ margin: '8px 0' }}>
            <Message type="info" appearance="default">
                {message}
            </Message>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <Button appearance="primary" label="Approve" onClick={open('approve')} />
                <Button appearance="secondary" label="Reject" onClick={open('reject')} />
            </div>
            {asking && (
                <Modal open onRequestClose={close} returnFocus={opener} style={{ width: '480px' }}>
                    <Modal.Header title={`${verb} ${name}?`} />
                    <Modal.Body>
                        {error && <ErrorMessage error={error} />}
                        <ControlGroup
                            label="Comment"
                            labelFor="approval-comment"
                            labelPosition="top"
                            help={asking === 'reject' ? 'Add a comment saying why' : 'Optional. Shown on the run and in the audit log.'}
                        >
                            <TextArea inputId="approval-comment" value={comment} onChange={(_e: unknown, { value }: { value: string }) => setComment(value)} />
                        </ControlGroup>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button appearance="secondary" label="Cancel" onClick={close} />
                        <Button
                            appearance={asking === 'reject' ? 'destructive' : 'primary'}
                            label={`${verb} ${name}`}
                            disabled={needsComment || busy ? 'dimmed' : undefined}
                            onClick={send}
                        />
                    </Modal.Footer>
                </Modal>
            )}
        </div>
    );
}
