/* "Searches at once": the load series as a step shape in a timeline track, with a line at
 * the max_searches limit and the part above it in the warning colour. Shared by the
 * Runs page timeline and the builder's busy-times strip. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { LoadSeries } from '../../api/types';
import { loadScale, loadSegments, pct } from './layout';

export interface LoadRowProps {
    load: LoadSeries;
    from: number;
    to: number;
    max: number;
    now?: number;
    height?: number;
    /** Bars drawn on top, such as the schedule being edited. */
    overlay?: { start: number; end: number }[];
    children?: React.ReactNode;
}

export default function LoadRow({ load, from, to, max, now, height = 36, overlay = [], children }: LoadRowProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const segments = loadSegments(load, from, to, max);
    const scale = loadScale(load, max);
    const peak = Math.max(0, ...segments.map((s) => s.count));
    return (
        <div
            role="img"
            aria-label={`Up to ${peak} search${peak === 1 ? '' : 'es'} at once; the limit is ${max}.`}
            data-testid="load-row"
            style={{
                position: 'relative',
                height: `${height}px`,
                background: theme.backgroundColorSection,
                borderRadius: '3px',
                overflow: 'hidden',
            }}
        >
            {segments.map((s) => (
                <div
                    key={`${s.leftPct}-${s.count}`}
                    data-testid="load-segment"
                    data-over={s.over ? 'true' : 'false'}
                    title={`${s.count} search${s.count === 1 ? '' : 'es'} at once`}
                    style={{
                        position: 'absolute',
                        bottom: 0,
                        left: `${s.leftPct}%`,
                        width: `${Math.max(s.widthPct, 0.15)}%`,
                        height: `${(s.count / scale) * (height - 4)}px`,
                        backgroundColor: s.over ? theme.statusColorMedium : theme.contentColorMuted,
                        opacity: s.over ? 1 : 0.6,
                    }}
                />
            ))}
            {max > 0 && (
                <div
                    data-testid="load-limit"
                    title={`Limit: ${max} searches at once`}
                    style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: `${(max / scale) * (height - 4)}px`,
                        borderTop: `1px dashed ${theme.borderColorStrong}`,
                    }}
                />
            )}
            {overlay.map((b) => (
                <div
                    key={b.start}
                    data-testid="load-overlay"
                    style={{
                        position: 'absolute',
                        top: '2px',
                        height: '6px',
                        borderRadius: '2px',
                        left: `${pct(b.start, from, to)}%`,
                        width: `${Math.max(pct(b.end, from, to) - pct(b.start, from, to), 0.4)}%`,
                        backgroundColor: theme.contentColorDefault,
                    }}
                />
            ))}
            {now !== undefined && now >= from && now < to && (
                <div style={{ position: 'absolute', top: 0, bottom: 0, width: '2px', left: `${pct(now, from, to)}%`, background: theme.focusColor }} />
            )}
            {children}
        </div>
    );
}
