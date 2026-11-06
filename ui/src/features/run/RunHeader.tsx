/* The run's title, status and controls. Controls the user cannot use are not shown. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import type { RunDetail } from '../../api/types';
import StatusText, { isRunDelayed } from '../../components/StatusText';
import { formatTime } from '../../format';

export interface RunHeaderProps {
    run: RunDetail;
    /** The caller may run jobs (from the me route). */
    canRun: boolean;
    busy?: boolean;
    onPause: () => void;
    onResume: () => void;
    onCancel: () => void;
    onRerun: () => void;
    onDismiss: () => void;
}

export default function RunHeader({ run, canRun, busy, onPause, onResume, onCancel, onRerun, onDismiss }: RunHeaderProps) {
    const allowed = canRun && (!run.permissions || run.permissions.can_run);
    const { state } = run;
    const canPause = state === 'running' || state === 'blocked';
    const canCancel = ['queued', 'running', 'blocked', 'paused'].includes(state);
    const canRerun = ['blocked', 'failed', 'cancelled'].includes(state);
    const held = Boolean(run.held) && state === 'failed';
    const name = run.definition.name || run.job_id;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
            <strong>{name}</strong>
            <span>{`Run ${formatTime(run.scheduled_time)}`}</span>
            <StatusText state={state} delayed={isRunDelayed(run)} />
            <span style={{ flex: 1 }} />
            {allowed && (
                <>
                    {canPause && <Button label="Pause" disabled={busy} onClick={onPause} />}
                    {state === 'paused' && <Button label="Resume" disabled={busy} onClick={onResume} />}
                    {canCancel && <Button label="Cancel" disabled={busy} onClick={onCancel} />}
                    {canRerun && <Button label="Re-run" disabled={busy} onClick={onRerun} />}
                    {held && <Button label="Dismiss" disabled={busy} onClick={onDismiss} />}
                </>
            )}
        </div>
    );
}
