/* The friendly schedule forms and their cron. Pure, so the round trip can be tested.
 *
 * A schedule is still stored as cron. `formOfCron` opens a cron in the simplest form that
 * means exactly the same thing, or in "cron" (Advanced) when none does; `cronOfForm`
 * writes a form back. Opening and saving a schedule without touching it never changes it:
 * the editor keeps the original text until a field is changed. */
import { daysCron, daysLabel, daysOfCron } from './graphLogic';

export const MINUTE_STEPS = [5, 10, 15, 20, 30];
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export type ScheduleForm =
    | { mode: 'days'; days: number[]; hour: number; minute: number }
    | { mode: 'every'; every: number; unit: 'minutes' | 'hours'; fromHour: number; toHour: number; days: number[] }
    | { mode: 'monthly'; dom: number; hour: number; minute: number }
    | { mode: 'cron'; cron: string };

export type Mode = ScheduleForm['mode'];

function int(text: string, lo: number, hi: number): number | null {
    if (!/^[0-9]{1,2}$/.test(text)) {
        return null;
    }
    const n = Number(text);
    return n >= lo && n <= hi ? n : null;
}

function dowDays(field: string): number[] | null {
    return field === '*' ? ALL_DAYS : daysOfCron(`* * * * ${field}`);
}

function dowField(days: number[]): string {
    return days.length === 7 ? '*' : daysCron(days).split(' ')[4];
}

/** "a-b" or "*" as an hour range, inclusive. */
function hourRange(field: string): [number, number] | null {
    if (field === '*') {
        return [0, 23];
    }
    const m = /^([0-9]{1,2})-([0-9]{1,2})$/.exec(field);
    if (!m) {
        return null;
    }
    const a = int(m[1], 0, 23);
    const b = int(m[2], 0, 23);
    return a !== null && b !== null && a <= b ? [a, b] : null;
}

function rangeField(from: number, to: number): string {
    return from === 0 && to === 23 ? '*' : `${from}-${to}`;
}

/** The simplest form that means exactly `cron`, or `{mode: 'cron'}`. */
export function formOfCron(cron: string): ScheduleForm {
    const raw = { mode: 'cron' as const, cron };
    const f = (cron || '').trim().split(/\s+/);
    if (f.length !== 5 || f[3] !== '*') {
        return raw;
    }
    const [min, hour, dom, , dow] = f;
    const minute = int(min, 0, 59);
    const h = int(hour, 0, 23);
    if (minute !== null && h !== null) {
        if (dom === '*') {
            const days = dowDays(dow);
            if (days) {
                return { mode: 'days', days, hour: h, minute };
            }
        }
        const d = int(dom, 1, 31);
        if (d !== null && dow === '*') {
            return { mode: 'monthly', dom: d, hour: h, minute };
        }
        return raw;
    }
    if (dom !== '*') {
        return raw;
    }
    const days = dowDays(dow);
    if (!days) {
        return raw;
    }
    // every N minutes: */N over an hour range
    const mStep = /^\*\/([0-9]{1,2})$/.exec(min);
    if (mStep && MINUTE_STEPS.includes(Number(mStep[1]))) {
        const range = hourRange(hour);
        if (range) {
            return { mode: 'every', every: Number(mStep[1]), unit: 'minutes', fromHour: range[0], toHour: range[1], days };
        }
        return raw;
    }
    // every N hours, on the hour: 0 */N, 0 a-b/N, or 0 * / 0 a-b for every hour
    if (min === '0') {
        const hStep = /^(\*|[0-9]{1,2}-[0-9]{1,2})(?:\/([0-9]{1,2}))?$/.exec(hour);
        if (hStep) {
            const step = hStep[2] === undefined ? 1 : Number(hStep[2]);
            const range = hourRange(hStep[1]);
            if (range && HOUR_STEPS.includes(step)) {
                return { mode: 'every', every: step, unit: 'hours', fromHour: range[0], toHour: range[1], days };
            }
        }
    }
    return raw;
}

/** The cron a form means. */
export function cronOfForm(form: ScheduleForm): string {
    switch (form.mode) {
        case 'days':
            return `${form.minute} ${form.hour} * * ${dowField(form.days)}`;
        case 'monthly':
            return `${form.minute} ${form.hour} ${form.dom} * *`;
        case 'every': {
            const range = rangeField(form.fromHour, form.toHour);
            if (form.unit === 'minutes') {
                return `*/${form.every} ${range} * * ${dowField(form.days)}`;
            }
            const hours = form.every === 1 ? range : `${range}/${form.every}`;
            return `0 ${hours} * * ${dowField(form.days)}`;
        }
        default:
            return form.cron;
    }
}

export function hhmm(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** "06:00" or "6:00" as [hour, minute], or null. */
export function parseTime(text: string): [number, number] | null {
    const m = /^\s*([0-9]{1,2}):([0-9]{2})\s*$/.exec(text || '');
    if (!m) {
        return null;
    }
    const h = int(m[1], 0, 23);
    const mi = int(m[2], 0, 59);
    return h === null || mi === null ? null : [h, mi];
}

function ordinal(n: number): string {
    const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
    return `${n}${s}`;
}

function onDays(days: number[]): string {
    const label = daysLabel(days);
    if (label === 'Every day') {
        return 'every day';
    }
    if (label === 'Weekdays') {
        return 'every weekday';
    }
    if (label === 'Weekends') {
        return 'on weekends';
    }
    return `on ${label}`;
}

/** A plain-English summary: "Every weekday at 06:00". */
export function describeForm(form: ScheduleForm): string {
    switch (form.mode) {
        case 'days': {
            const when = onDays(form.days);
            return `${when.charAt(0).toUpperCase()}${when.slice(1)} at ${hhmm(form.hour, form.minute)}`;
        }
        case 'monthly':
            return `On the ${ordinal(form.dom)} of every month at ${hhmm(form.hour, form.minute)}${
                form.dom > 28 ? ` (months without a ${ordinal(form.dom)} are skipped)` : ''
            }`;
        case 'every': {
            const what =
                form.unit === 'minutes'
                    ? `Every ${form.every} minutes`
                    : form.every === 1
                      ? 'Every hour'
                      : `Every ${form.every} hours`;
            const all = form.fromHour === 0 && form.toHour === 23;
            let span = '';
            if (!all) {
                const lastMinute = form.unit === 'minutes' ? 60 - form.every : 0;
                const lastHour =
                    form.unit === 'minutes' ? form.toHour : form.fromHour + Math.floor((form.toHour - form.fromHour) / form.every) * form.every;
                span = ` from ${hhmm(form.fromHour, 0)} to ${hhmm(lastHour, lastMinute)}`;
            }
            return `${what}${span}, ${onDays(form.days)}`;
        }
        default:
            return 'Custom cron schedule';
    }
}

/** The form a mode switch starts from, carrying over what it can (days and time). */
export function switchMode(form: ScheduleForm, mode: Mode, currentCron: string): ScheduleForm {
    const days = form.mode === 'days' || form.mode === 'every' ? form.days : [1, 2, 3, 4, 5];
    const [hour, minute] = form.mode === 'days' || form.mode === 'monthly' ? [form.hour, form.minute] : [6, 0];
    switch (mode) {
        case 'days':
            return { mode, days, hour, minute };
        case 'monthly':
            return { mode, dom: 1, hour, minute };
        case 'every':
            return { mode, every: 15, unit: 'minutes', fromHour: 0, toHour: 23, days };
        default:
            return { mode: 'cron', cron: currentCron };
    }
}
