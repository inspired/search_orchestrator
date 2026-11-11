/* The Runs page's Timeline view: window controls (24 hours / 7 days, back, now, forward),
 * a job-name search, and the timeline, polled like the runs table. */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import RadioBar from '@splunk/react-ui/RadioBar';
import Text from '@splunk/react-ui/Text';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import * as client from '../../api/client';
import usePoll from '../../hooks/usePoll';
import ScheduleTimeline from './ScheduleTimeline';
import { defaultWindow, Span, SPAN_SECONDS } from './layout';

export interface SchedulePanelProps {
    q: string;
    state?: string;
    onQChange: (q: string) => void;
    api?: { getSchedule: typeof client.getSchedule };
}

const ACTIVE = ['queued', 'running', 'blocked', 'paused'];

export default function SchedulePanel({ q, state, onQChange, api = client }: SchedulePanelProps) {
    const [span, setSpan] = useState<Span>('day');
    /** Windows away from the one around now: 0 follows now. */
    const [offset, setOffset] = useState(0);
    const [fast, setFast] = useState(false);
    const schedule = usePoll(
        () => {
            const now = Math.floor(Date.now() / 1000);
            const w = defaultWindow(now, span);
            const shift = offset * SPAN_SECONDS[span];
            return api.getSchedule(w.from + shift, w.to + shift);
        },
        fast ? 5000 : 30000,
        true
    );
    const data = schedule.data;
    const anyActive = !!data && data.jobs.some((j) => j.bars.some((b) => ACTIVE.includes(b.state)));
    React.useEffect(() => setFast(anyActive), [anyActive]);
    const first = React.useRef(true);
    React.useEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        schedule.refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [span, offset]);

    return (
        <>
            <div style={{ display: 'flex', gap: '24px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <ControlGroup label="Search by job name" labelFor="schedule-search" labelPosition="top">
                    <Text
                        inputId="schedule-search"
                        value={q}
                        canClear
                        onChange={(_e: unknown, { value }: { value: string }) => onQChange(value)}
                    />
                </ControlGroup>
                <ControlGroup label="Window" labelPosition="top">
                    <RadioBar
                        value={span}
                        onChange={(_e: unknown, { value }: { value: unknown }) => {
                            setSpan(value as Span);
                            setOffset(0);
                        }}
                    >
                        <RadioBar.Option value="day" label="24 hours" />
                        <RadioBar.Option value="week" label="7 days" />
                    </RadioBar>
                </ControlGroup>
                <div style={{ display: 'flex', gap: '4px' }}>
                    <Button appearance="secondary" label="Earlier" onClick={() => setOffset(offset - 1)} />
                    <Button appearance="secondary" label="Now" disabled={offset === 0} onClick={() => setOffset(0)} />
                    <Button appearance="secondary" label="Later" onClick={() => setOffset(offset + 1)} />
                </div>
            </div>
            {schedule.error && (
                <Message type="error" appearance="default">
                    {`The schedule could not be loaded: ${schedule.error.message}`}
                </Message>
            )}
            {!data && schedule.loading ? (
                <WaitSpinner size="medium" />
            ) : (
                data && <ScheduleTimeline data={data} from={data.from} to={data.to} now={data.now} q={q} state={state} />
            )}
            <p style={{ fontSize: '12px', opacity: 0.8 }}>
                {`Times are in your browser's time zone (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Dashed bars are scheduled runs; their length is estimated from recent runs.`}
            </p>
        </>
    );
}
