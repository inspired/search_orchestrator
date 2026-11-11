/* Schedule presets over cron strings. Only the exact shapes below map to a preset; any
 * other cron is `custom` and passes through untouched, so loading and saving a job never
 * rewrites a schedule the presets cannot express. */

export type SchedulePreset =
    | { kind: 'hourly'; minute: number }
    | { kind: 'daily'; hour: number; minute: number }
    | { kind: 'weekly'; days: number[]; hour: number; minute: number }
    | { kind: 'monthly'; dayOfMonth: number; hour: number; minute: number }
    | { kind: 'custom'; cron: string };

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number) => String(n).padStart(2, '0');

/** A plain decimal in range, written canonically (no sign, no leading zero), else null. */
function num(text: string, min: number, max: number): number | null {
    if (!/^(0|[1-9]\d*)$/.test(text)) {
        return null;
    }
    const n = Number(text);
    return n >= min && n <= max ? n : null;
}

export function toCron(p: SchedulePreset): string {
    switch (p.kind) {
        case 'hourly':
            return `${p.minute} * * * *`;
        case 'daily':
            return `${p.minute} ${p.hour} * * *`;
        case 'weekly':
            return `${p.minute} ${p.hour} * * ${p.days.join(',')}`;
        case 'monthly':
            return `${p.minute} ${p.hour} ${p.dayOfMonth} * *`;
        default:
            return p.cron;
    }
}

export function fromCron(cron: string): SchedulePreset {
    const custom: SchedulePreset = { kind: 'custom', cron };
    const f = cron.split(' ');
    if (f.length !== 5) {
        return custom;
    }
    const [mi, h, dom, mon, dow] = f;
    const minute = num(mi, 0, 59);
    if (minute === null || mon !== '*') {
        return custom;
    }
    if (h === '*') {
        return dom === '*' && dow === '*' ? { kind: 'hourly', minute } : custom;
    }
    const hour = num(h, 0, 23);
    if (hour === null) {
        return custom;
    }
    if (dom === '*' && dow === '*') {
        return { kind: 'daily', hour, minute };
    }
    if (dom === '*') {
        const days = dow.split(',').map((d) => num(d, 0, 6));
        const ascending = days.every((d, i) => d !== null && (i === 0 || d > (days[i - 1] as number)));
        return ascending ? { kind: 'weekly', days: days as number[], hour, minute } : custom;
    }
    const dayOfMonth = num(dom, 1, 31);
    return dow === '*' && dayOfMonth !== null ? { kind: 'monthly', dayOfMonth, hour, minute } : custom;
}

function joinDays(days: number[]): string {
    const names = days.map((d) => DAY_NAMES[d]);
    return names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function describeSchedule(cron: string): string {
    const p = fromCron(cron);
    const at = (h: number, m: number) => `${pad(h)}:${pad(m)}`;
    switch (p.kind) {
        case 'hourly':
            return `Every hour at ${p.minute} minutes past`;
        case 'daily':
            return `Every day at ${at(p.hour, p.minute)}`;
        case 'weekly':
            return `Every ${joinDays(p.days)} at ${at(p.hour, p.minute)}`;
        case 'monthly':
            return `On day ${p.dayOfMonth} of every month at ${at(p.hour, p.minute)}`;
        default:
            return `Custom schedule: ${cron}`;
    }
}

/** The browser's IANA zones, plus `current` when it lists no such zone (only the server
 * judges a stored zone), sorted. */
export function timeZoneOptions(current: string | undefined): string[] {
    let zones: string[] = [];
    try {
        zones = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
    } catch {
        zones = [];
    }
    const all = new Set(zones);
    if (current) {
        all.add(current);
    }
    return [...all].sort();
}
