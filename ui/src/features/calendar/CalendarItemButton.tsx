/* One calendar item as a button. A run shows its job and state (StatusText) on a 3 px left
 * border in the state's colour; a scheduled time has a dashed border and muted text; a
 * planned backfill slot says "Backfill · <job>". Never a filled background. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { CalendarItem } from '../../api/calendar';
import type { RunState } from '../../api/types';
import StatusText, { statusLabel } from '../../components/StatusText';
import { pageHref } from '../../components/PageShell';
import { itemTime } from './calendarLayout';

const STATE_COLOR: Record<RunState, string> = {
    queued: 'contentColorMuted',
    running: 'statusColorInfo',
    blocked: 'statusColorMedium',
    paused: 'statusColorMedium',
    succeeded: 'statusColorNormal',
    failed: 'statusColorHigh',
    cancelled: 'contentColorMuted',
};

/** Where an item opens: a run its run page, anything else its job in the builder. */
export function itemHref(item: CalendarItem): string {
    return item.kind === 'run' ? pageHref('run', { run_id: item.run_id }) : pageHref('builder', { job_id: item.job_id });
}

export function clockTime(epoch: number): string {
    return new Date(epoch * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function itemLabel(item: CalendarItem): string {
    const at = clockTime(itemTime(item));
    if (item.kind === 'run') {
        return `${item.job_name}, ${statusLabel(item.state)}${item.late ? ', late' : ''}, ${at}`;
    }
    if (item.kind === 'scheduled') {
        return `${item.job_name}, Scheduled, ${at}`;
    }
    return `Backfill · ${item.job_name}, ${at}`;
}

export interface CalendarItemButtonProps {
    item: CalendarItem;
    onOpen: (href: string) => void;
    /** Absolute position in a day column; without it the button sits in normal flow. */
    style?: React.CSSProperties;
}

export default function CalendarItemButton({ item, onOpen, style }: CalendarItemButtonProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const open = () => onOpen(itemHref(item));
    const base: React.CSSProperties = {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '6px',
        boxSizing: 'border-box',
        minHeight: '18px',
        padding: '0 4px',
        overflow: 'hidden',
        textAlign: 'left',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '16px',
        cursor: 'pointer',
        background: theme.backgroundColorPage,
        color: theme.contentColorDefault,
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: theme.borderColor,
        borderRadius: '2px',
    };
    if (item.kind === 'run') {
        base.borderLeftWidth = '3px';
        base.borderLeftColor = theme[STATE_COLOR[item.state]] || theme.borderColor;
    } else if (item.kind === 'scheduled') {
        base.borderStyle = 'dashed';
        base.color = theme.contentColorMuted;
    } else {
        base.color = theme.contentColorMuted;
    }
    return (
        <button
            type="button"
            aria-label={itemLabel(item)}
            title={itemLabel(item)}
            style={{ ...base, ...style }}
            onClick={open}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    open();
                }
            }}
        >
            {item.kind === 'run' ? (
                <>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.job_name}</span>
                    <StatusText state={item.state} />
                    {item.late && <span style={{ color: theme.statusColorMedium }}>Late</span>}
                </>
            ) : (
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.kind === 'backfill' ? `Backfill · ${item.job_name}` : item.job_name}
                </span>
            )}
        </button>
    );
}
