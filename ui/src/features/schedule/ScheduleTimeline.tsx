/* The global timeline: a "Searches at once" row, then one row per job with its past,
 * running and scheduled runs on a shared axis. Rows use the run page Timeline's layout:
 * label, track, and a right-hand column. */
import React from 'react';
import Link from '@splunk/react-ui/Link';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { ScheduleBar, ScheduleResponse } from '../../api/types';
import { pageHref } from '../../components/PageShell';
import StatusText, { statusLabel } from '../../components/StatusText';
import { formatDuration, formatTime } from '../../format';
import LoadRow from './LoadRow';
import { BarFill, barFill, orderRows, pct, place, ticks } from './layout';

export interface ScheduleTimelineProps {
    data: ScheduleResponse;
    from: number;
    to: number;
    now: number;
    /** Lower-case job-name filter. */
    q?: string;
    /** Only past runs in this state (scheduled runs always show). */
    state?: string;
}

const GRID = '180px 1fr 170px';

function describe(bar: ScheduleBar): string {
    const when = `${formatTime(bar.start)} – ${formatTime(bar.end)}`;
    if (bar.kind === 'span') {
        const what = bar.state === 'scheduled' ? 'scheduled runs' : 'runs';
        return `${bar.count} ${what}, ${when}${bar.estimated ? ' (estimated)' : ''}`;
    }
    if (bar.state === 'scheduled') {
        const dep = bar.dependent ? ', after its upstream job' : '';
        return `Scheduled ${formatTime(bar.start)}, about ${formatDuration(bar.end - bar.start)} (estimated${dep})`;
    }
    const state = statusLabel(bar.state, !!bar.delayed);
    return `${state}: ${when}`;
}

export default function ScheduleTimeline({ data, from, to, now, q = '', state }: ScheduleTimelineProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const term = q.trim().toLowerCase();
    const rows = orderRows(data.jobs).filter(({ job }) => !term || (!job.hidden && job.name.toLowerCase().includes(term)));
    const nowPct = now >= from && now < to ? pct(now, from, to) : null;

    const fill = (kind: BarFill): React.CSSProperties => {
        switch (kind) {
            case 'scheduled':
                return { border: `1.5px dashed ${theme.borderColorStrong}`, boxSizing: 'border-box', background: 'transparent' };
            case 'failed':
                return { backgroundColor: theme.statusColorHigh };
            case 'delayed':
                return { backgroundColor: theme.statusColorMedium };
            case 'running':
                return { backgroundColor: theme.contentColorDefault };
            case 'queued':
                return {
                    backgroundImage: `repeating-linear-gradient(135deg, ${theme.borderColorStrong} 0 5px, ${theme.backgroundColorSection} 5px 10px)`,
                };
            default:
                return { backgroundColor: theme.contentColorMuted };
        }
    };

    const nowLine = nowPct !== null && (
        <div
            data-testid="now-line"
            style={{ position: 'absolute', top: '-4px', bottom: '-4px', width: '2px', left: `${nowPct}%`, background: theme.focusColor }}
        />
    );

    const renderBar = (bar: ScheduleBar, i: number, hidden: boolean) => {
        const kind = barFill(bar);
        const p = place(bar, from, to);
        const style: React.CSSProperties = {
            position: 'absolute',
            top: '2px',
            bottom: '2px',
            borderRadius: '2px',
            left: `${p.leftPct}%`,
            width: `${p.widthPct}%`,
            ...fill(kind),
        };
        if (kind !== 'scheduled' && kind !== 'queued' && p.queuedPct > 0) {
            // queued first (hatched), then the run's own fill
            const solid = fill(kind).backgroundColor;
            style.backgroundImage = `linear-gradient(90deg, transparent ${p.queuedPct}%, ${solid} ${p.queuedPct}%), repeating-linear-gradient(135deg, ${theme.borderColorStrong} 0 5px, ${theme.backgroundColorSection} 5px 10px)`;
            style.backgroundColor = undefined;
        }
        const title = describe(bar);
        const key = `${bar.start}-${i}`;
        const common = {
            title,
            'aria-label': title,
            'data-testid': 'schedule-bar',
            'data-fill': kind,
            'data-span': bar.kind === 'span' ? 'true' : 'false',
            style,
        };
        if (bar.id && !hidden) {
            return <a key={key} {...common} href={pageHref('run', { run_id: bar.id })} />;
        }
        return <div key={key} {...common} />;
    };

    const tickMarks = ticks(from, to);
    return (
        <div aria-label="Schedule timeline" style={{ padding: '8px 0 12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '10px', padding: '0 14px 4px' }}>
                <span />
                <div style={{ position: 'relative', height: '16px', fontSize: '12px', color: theme.contentColorMuted }}>
                    {tickMarks.map((t) => (
                        <span key={t.pct} style={{ position: 'absolute', left: `${t.pct}%`, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>
                            {t.label}
                        </span>
                    ))}
                </div>
                <span />
            </div>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: GRID,
                    gap: '10px',
                    alignItems: 'center',
                    padding: '6px 14px',
                    borderBottom: `1px solid ${theme.borderColor}`,
                }}
            >
                <span style={{ fontWeight: theme.fontWeightSemiBold as React.CSSProperties['fontWeight'] }}>Searches at once</span>
                <LoadRow load={data.load} from={from} to={to} max={data.max_searches} now={now} />
                <span style={{ color: theme.contentColorMuted }}>{`Limit ${data.max_searches}`}</span>
            </div>
            <div role="list" aria-label="Jobs">
                {rows.map(({ job, depth }) => {
                    const bars = job.bars.filter((b) => !state || b.state === 'scheduled' || b.state === state);
                    const last = [...job.bars].reverse().find((b) => b.state !== 'scheduled');
                    return (
                        <div
                            role="listitem"
                            key={job.key}
                            style={{ display: 'grid', gridTemplateColumns: GRID, gap: '10px', alignItems: 'center', padding: '6px 14px' }}
                        >
                            <span style={{ paddingLeft: depth ? '14px' : 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {depth ? '↳ ' : ''}
                                {job.hidden ? (
                                    <span style={{ color: theme.contentColorMuted }}>{job.name}</span>
                                ) : (
                                    <Link to={pageHref('builder', { job_id: job.key })}>{job.name}</Link>
                                )}
                            </span>
                            <div style={{ position: 'relative', height: '18px', background: theme.backgroundColorSection, borderRadius: '3px' }}>
                                {bars.map((b, i) => renderBar(b, i, job.hidden))}
                                {nowLine}
                            </div>
                            <span style={{ color: theme.contentColorMuted, fontSize: '12px' }}>
                                {job.next_run ? (
                                    `Next ${formatTime(job.next_run)}`
                                ) : last && last.state !== 'scheduled' ? (
                                    <StatusText state={last.state} delayed={!!last.delayed} />
                                ) : (
                                    ''
                                )}
                            </span>
                        </div>
                    );
                })}
            </div>
            {rows.length === 0 && <p style={{ padding: '0 14px' }}>{term ? 'No jobs match this name.' : 'Nothing ran or is scheduled in this window.'}</p>}
            {data.idle_jobs > 0 && !term && (
                <p style={{ padding: '0 14px', color: theme.contentColorMuted }}>
                    {`${data.idle_jobs} job${data.idle_jobs === 1 ? ' has' : 's have'} nothing in this window.`}
                </p>
            )}
            {data.partial && (
                <p style={{ padding: '0 14px', color: theme.contentColorMuted }}>Only the newest runs in this window are shown.</p>
            )}
        </div>
    );
}
