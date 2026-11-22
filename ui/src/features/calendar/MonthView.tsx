/* The month grid: six weeks by seven days. Each day lists up to three jobs, with a legend below, (a coloured dot
 * for the most serious state, the job's name and how many items it has that day) and
 * "+N more"; the day number and "+N more" open that day in the day view. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { CalendarItem } from '../../api/calendar';
import { monthDays, summarizeDay } from './monthLayout';
import type { DayTone } from './monthLayout';

export const SHOWN_PER_DAY = 3;

const TONE_COLOR: Record<DayTone, string> = {
    failed: 'statusColorHigh',
    late: 'statusColorMedium',
    waiting: 'statusColorMedium',
    running: 'statusColorInfo',
    queued: 'contentColorMuted',
    succeeded: 'statusColorNormal',
    cancelled: 'contentColorMuted',
    scheduled: 'contentColorMuted',
    backfill: 'contentColorMuted',
};

export const TONE_LABEL: Record<DayTone, string> = {
    failed: 'Failed',
    late: 'Late',
    waiting: 'Blocked or paused',
    running: 'Running',
    queued: 'Queued',
    succeeded: 'Succeeded',
    cancelled: 'Cancelled',
    scheduled: 'Scheduled',
    backfill: 'Backfill',
};

export interface MonthViewProps {
    /** Any day in the month to show. */
    month: Date;
    items: CalendarItem[];
    now: number;
    /** Open one day in the day view. */
    onOpenDay: (day: Date) => void;
}

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }));

export default function MonthView({ month, items, now, onOpenDay }: MonthViewProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const line = `1px solid ${theme.borderColorWeak || theme.borderColor}`;
    const today = new Date(now * 1000);
    const days = monthDays(month);
    const linkStyle: React.CSSProperties = {
        font: 'inherit',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        color: theme.contentColorDefault,
    };
    return (
        <div role="region" aria-label="Month" style={{ border: line }}>
            <div aria-hidden style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: line }}>
                {WEEKDAYS.map((w) => (
                    <div key={w} style={{ padding: '4px 8px', fontSize: '12px', color: theme.contentColorMuted, borderLeft: line }}>
                        {w}
                    </div>
                ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridAutoRows: 'minmax(96px, auto)' }}>
                {days.map((d) => {
                    const inMonth = d.getMonth() === month.getMonth();
                    const isToday = d.toDateString() === today.toDateString();
                    const jobs = summarizeDay(items, d);
                    const label = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
                    return (
                        <div
                            key={d.getTime()}
                            role="group"
                            aria-label={label}
                            aria-current={isToday ? 'date' : undefined}
                            style={{ borderLeft: line, borderTop: line, padding: '4px 6px', minWidth: 0, opacity: inMonth ? 1 : 0.55 }}
                        >
                            <button
                                type="button"
                                aria-label={`Open ${label}`}
                                onClick={() => onOpenDay(d)}
                                style={{
                                    ...linkStyle,
                                    fontSize: '13px',
                                    fontWeight: isToday ? 700 : 400,
                                    ...(isToday ? { color: theme.contentColorInverted || '#fff', background: theme.focusColor, borderRadius: '10px', padding: '0 6px' } : {}),
                                }}
                            >
                                {d.getDate()}
                            </button>
                            <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
                                {jobs.slice(0, SHOWN_PER_DAY).map((j) => (
                                    <li
                                        key={j.jobId}
                                        title={`${j.jobName}: ${j.count}, ${TONE_LABEL[j.tone]}`}
                                        style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', lineHeight: '18px', minWidth: 0 }}
                                    >
                                        <Dot tone={j.tone} theme={theme} />
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto' }}>{j.jobName}</span>
                                        <span style={{ flex: 'none', color: theme.contentColorMuted }}>{j.count > 1 ? `×${j.count}` : ''}</span>
                                        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{`, ${TONE_LABEL[j.tone]}`}</span>
                                    </li>
                                ))}
                            </ul>
                            {jobs.length > SHOWN_PER_DAY && (
                                <button
                                    type="button"
                                    onClick={() => onOpenDay(d)}
                                    style={{ ...linkStyle, fontSize: '11px', textDecoration: 'underline' }}
                                >
                                    {`+${jobs.length - SHOWN_PER_DAY} more`}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '6px 8px', borderTop: line, fontSize: '12px', color: theme.contentColorMuted }}>
                {(['failed', 'late', 'waiting', 'running', 'succeeded', 'scheduled', 'backfill'] as DayTone[]).map((tone) => (
                    <span key={tone} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Dot tone={tone} theme={theme} />
                        {TONE_LABEL[tone]}
                    </span>
                ))}
            </div>
        </div>
    );
}

function Dot({ tone, theme }: { tone: DayTone; theme: Record<string, string> }) {
    const color = theme[TONE_COLOR[tone]];
    return (
        <span
            aria-hidden
            style={{
                flex: 'none',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                boxSizing: 'border-box',
                background: tone === 'scheduled' || tone === 'backfill' ? 'none' : color,
                border: `1.5px ${tone === 'backfill' ? 'dotted' : 'solid'} ${color}`,
            }}
        />
    );
}
