/* "All Splunk searches": every search on the search head over the window, against splunkd's
 * own limit. Up to now, a bar per bucket stacked by who ran it (this app, Splunk's scheduler,
 * everything else: people, dashboards, other apps); from now, Splunk's scheduled saved
 * searches projected from their schedule and usual runtime, with this app's own projected
 * searches on top. Each bar is the most searches that ran at once in its bucket. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { LoadSeries, SplunkLoad } from '../../api/types';
import { formatTime } from '../../format';
import { pct } from './layout';

/** The highest count of `load` (change points) between `start` and `end`. */
export function maxBetween(load: LoadSeries, start: number, end: number): number {
    let current = 0;
    let best = 0;
    load.forEach(([t, n]) => {
        if (t <= start) {
            current = n;
        } else if (t < end) {
            best = Math.max(best, n);
        }
    });
    return Math.max(best, current);
}

export interface SplunkBar {
    t: number;
    future: boolean;
    app: number;
    scheduled: number;
    other: number;
}

/** One bar per bucket with something in it: the past from what ran, the future from
 * Splunk's projection plus this app's own projected load (`appLoad`). */
export function splunkBars(data: SplunkLoad, appLoad: LoadSeries): SplunkBar[] {
    const out: SplunkBar[] = data.past.map(([t, app, scheduled, other]) => ({ t, future: false, app, scheduled, other }));
    const future = new Map(data.future.map(([t, n]) => [t, n]));
    const firstFuture = data.now > data.from ? data.from + Math.floor((data.now - data.from) / data.bucket) * data.bucket : data.from;
    for (let t = firstFuture; t < data.to; t += data.bucket) {
        const app = maxBetween(appLoad, Math.max(t, data.now), t + data.bucket);
        const scheduled = future.get(t) || 0;
        if (app || scheduled) {
            out.push({ t, future: true, app, scheduled, other: 0 });
        }
    }
    return out;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 'es'}`;

export function describeBar(b: SplunkBar): string {
    const total = b.app + b.scheduled + b.other;
    if (b.future) {
        return `${formatTime(b.t)}: about ${plural(total, 'search')} at once expected (${b.scheduled} scheduled, ${b.app} of this app's)`;
    }
    return `${formatTime(b.t)}: up to ${plural(total, 'search')} at once (${b.app} this app, ${b.scheduled} scheduled, ${b.other} other)`;
}

export interface SplunkLoadRowProps {
    data: SplunkLoad;
    appLoad: LoadSeries;
    from: number;
    to: number;
    now?: number;
    height?: number;
}

export default function SplunkLoadRow({ data, appLoad, from, to, now, height = 44 }: SplunkLoadRowProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const bars = splunkBars(data, appLoad);
    const limit = data.limit ? data.limit.searches : 0;
    const peak = Math.max(0, ...bars.map((b) => b.app + b.scheduled + b.other));
    const scale = Math.max(1, limit, peak);
    const h = (n: number) => (n / scale) * (height - 4);
    const width = Math.max((data.bucket / Math.max(1, to - from)) * 100, 0.2);
    const colors = { app: theme.focusColor, scheduled: theme.contentColorMuted, other: theme.borderColorStrong || theme.borderColor };
    return (
        <div
            role="img"
            aria-label={`Up to ${plural(peak, 'Splunk search')} at once${limit ? `; Splunk's limit is ${limit}` : ''}.`}
            data-testid="splunk-load-row"
            style={{ position: 'relative', height: `${height}px`, background: theme.backgroundColorSection, borderRadius: '3px', overflow: 'hidden' }}
        >
            {bars.map((b) => {
                const total = b.app + b.scheduled + b.other;
                const over = limit > 0 && total > limit;
                return (
                    <div
                        key={`${b.t}-${b.future ? 'f' : 'p'}`}
                        data-testid="splunk-load-bar"
                        data-future={b.future ? 'true' : 'false'}
                        data-over={over ? 'true' : 'false'}
                        title={describeBar(b)}
                        style={{ position: 'absolute', bottom: 0, left: `${pct(b.t, from, to)}%`, width: `${width}%`, display: 'flex', flexDirection: 'column-reverse' }}
                    >
                        {(['other', 'scheduled', 'app'] as const).map((k) =>
                            b[k] ? (
                                <div
                                    key={k}
                                    data-kind={k}
                                    style={{
                                        height: `${h(b[k])}px`,
                                        background: b.future ? `repeating-linear-gradient(135deg, ${colors[k]} 0 2px, transparent 2px 4px)` : colors[k],
                                        outline: over ? `1px solid ${theme.statusColorMedium}` : undefined,
                                        opacity: b.future ? 0.9 : 0.75,
                                    }}
                                />
                            ) : null
                        )}
                    </div>
                );
            })}
            {limit > 0 && (
                <div
                    data-testid="splunk-load-limit"
                    title={`Splunk's limit: ${plural(limit, 'search')} at once${data.limit && data.limit.scheduled ? ` (scheduled searches: ${data.limit.scheduled})` : ''}`}
                    style={{ position: 'absolute', left: 0, right: 0, bottom: `${h(limit)}px`, borderTop: `1px dashed ${theme.borderColorStrong}` }}
                />
            )}
            {height >= 80 && (
                <span data-testid="splunk-load-scale" aria-hidden style={{ position: 'absolute', top: '2px', left: '4px', fontSize: '11px', color: theme.contentColorMuted }}>
                    {scale}
                </span>
            )}
            {now !== undefined && now >= from && now < to && <div style={{ position: 'absolute', top: 0, bottom: 0, width: '2px', left: `${pct(now, from, to)}%`, background: theme.focusColor }} />}
        </div>
    );
}

/** The key under the row: what each colour is, never colour alone (the bars' titles say it too). */
export function SplunkLoadKey() {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const swatch = (bg: string, label: string, striped = false) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span
                aria-hidden
                style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: striped ? `repeating-linear-gradient(135deg, ${bg} 0 2px, transparent 2px 4px)` : bg,
                    border: striped ? `1px solid ${bg}` : undefined,
                }}
            />
            {label}
        </span>
    );
    return (
        <span style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12px', color: theme.contentColorMuted }}>
            {swatch(theme.focusColor, 'This app')}
            {swatch(theme.contentColorMuted, 'Scheduled searches')}
            {swatch(theme.borderColorStrong || theme.borderColor, 'Other searches')}
            {swatch(theme.contentColorMuted, 'Expected', true)}
            <span>Dashed line: Splunk&apos;s limit</span>
        </span>
    );
}
