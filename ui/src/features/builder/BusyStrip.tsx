/* Under a cron schedule: how busy the other jobs are around this schedule's runs (in the
 * job's time zone), and a quieter nearby start time when there is one. Only a hint: it
 * never changes the schedule unless "Use this time" is clicked, and that changes only the
 * minute and hour. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { SchedulePreview, SchedulePreviewResponse } from '../../api/types';
import LoadRow from '../schedule/LoadRow';
import { clock, pct } from '../schedule/layout';

export interface BusyStripProps {
    preview: SchedulePreviewResponse;
    schedule: SchedulePreview;
    onUseTime: (hour: number, minute: number) => void;
    dismissed: boolean;
    onDismiss: () => void;
}

export default function BusyStrip({ preview, schedule, onUseTime, dismissed, onDismiss }: BusyStripProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const { from, to, load, max_searches: max } = preview;
    const tz = preview.timezone;
    // The server's ticks are in the zone the cron runs in, even when that is the server's.
    const marks = (preview.ticks || []).map(([t, label]) => ({ pct: pct(t, from, to), label }));
    const s = schedule.suggestion;
    const week = to - from > 2 * 86400;
    const span = preview.from > preview.now + 60 ? 'the 7 days around the next run' : `next ${week ? '7 days' : '24 hours'}`;
    return (
        <div data-testid="busy-strip" style={{ margin: '4px 0 10px' }}>
            <div style={{ fontSize: '12px', color: theme.contentColorMuted, marginBottom: '2px' }}>
                {`Concurrent searches from other jobs, ${span} (${tz || "the server's time zone"}). This schedule's runs are on top.`}
            </div>
            <LoadRow load={load} from={from} to={to} max={max} height={32} overlay={schedule.runs} />
            <div style={{ position: 'relative', height: '14px', fontSize: '11px', color: theme.contentColorMuted }}>
                {marks.map((t) => (
                    <span key={t.pct} style={{ position: 'absolute', left: `${t.pct}%`, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>
                        {t.label}
                    </span>
                ))}
            </div>
            {s && !dismissed && (
                <div
                    role="status"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}
                >
                    <span>
                        {'Quieter nearby: '}
                        <strong>{clock(s.hour, s.minute)}</strong>
                        {`, with up to ${s.peak} other search${s.peak === 1 ? '' : 'es'} running instead of ${s.base_peak}.`}
                    </span>
                    <Button appearance="secondary" label="Use this time" onClick={() => onUseTime(s.hour, s.minute)} />
                    <Button appearance="subtle" label="Dismiss" onClick={onDismiss} />
                </div>
            )}
        </div>
    );
}
