/* The warning under a run's header when it missed its deadline. */
import React from 'react';
import Message from '@splunk/react-ui/Message';
import type { RunSummary } from '../../api/types';
import { formatSpan } from '../../format';

/** An epoch as HH:MM in the job's time zone (the viewer's when the job has none or it is unknown). */
export function formatDeadline(epoch: number, timezone?: string): string {
    const format = (timeZone?: string) =>
        new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(epoch * 1000));
    try {
        return format(timezone || undefined);
    } catch {
        return format();
    }
}

export interface DeadlineMessageProps {
    run: RunSummary;
    now: number;
    timezone?: string;
}

export default function DeadlineMessage({ run, timezone }: DeadlineMessageProps) {
    if (!run.late_at || !run.deadline_at) {
        return null;
    }
    const missed = `This run missed its deadline (${formatDeadline(run.deadline_at, timezone)}).`;
    const text = run.ended_at ? `${missed} It finished ${formatSpan(run.ended_at - run.deadline_at)} late.` : `${missed} It is still running.`;
    return (
        <Message type="warning" appearance="default">
            {text}
        </Message>
    );
}
