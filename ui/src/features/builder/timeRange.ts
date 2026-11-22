/* Time range presets for a step's Earliest/Latest (Splunk relative time, relative to the run's
 * scheduled time). */
export interface TimeRangePreset {
    key: string;
    label: string;
    earliest: string;
    latest: string;
}

export const TIME_RANGE_PRESETS: TimeRangePreset[] = [
    { key: 'previous_hour', label: 'The hour before', earliest: '-1h@h', latest: '@h' },
    { key: 'previous_day', label: 'The day before', earliest: '-1d@d', latest: '@d' },
    { key: 'previous_week', label: 'The week before (Monday to Sunday)', earliest: '-1w@w1', latest: '@w1' },
    { key: 'previous_month', label: 'The month before', earliest: '-1mon@mon', latest: '@mon' },
    { key: 'last_24h', label: 'The 24 hours before', earliest: '-24h', latest: 'now' },
];

/** The preset key a step's range matches, 'all_time' when both are empty, else 'custom'. */
export function timeRangeChoice(earliest?: string, latest?: string): string {
    const e = (earliest || '').trim();
    const l = (latest || '').trim();
    if (!e && !l) {
        return 'all_time';
    }
    const found = TIME_RANGE_PRESETS.find((p) => p.earliest === e && p.latest === l);
    return found ? found.key : 'custom';
}

/** An epoch like "Thu 6 Nov 01:00" in `timezone`; empty or unknown zone: the browser's. */
export function formatMoment(epoch: number, timezone?: string): string {
    const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    const date = new Date(epoch * 1000);
    let parts: Intl.DateTimeFormatPart[];
    try {
        parts = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: timezone || undefined }).formatToParts(date);
    } catch {
        parts = new Intl.DateTimeFormat('en-GB', opts).formatToParts(date);
    }
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    return `${get('weekday')} ${get('day')} ${get('month')} ${get('hour')}:${get('minute')}`;
}
