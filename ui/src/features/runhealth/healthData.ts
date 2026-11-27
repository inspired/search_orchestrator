/* Pure helpers for the Run health page: search rows into the columns Splunk's charts take,
 * the tiles with their tone, and the names of jobs and steps. */
import type { EngineSection, LateSection, Row, RunsSection } from '../../api/runHealth';
import type { Tone } from '../logs/catalog';
import { formatDuration } from '../../format';

/** The states of a run in the over-time chart, in stacking order, with their tone. */
export const STATES: { key: string; label: string; tone: Tone }[] = [
    { key: 'succeeded', label: 'Succeeded', tone: 'ok' },
    { key: 'failed', label: 'Failed', tone: 'error' },
    { key: 'held', label: 'Held', tone: 'warning' },
    { key: 'blocked', label: 'Blocked', tone: 'warning' },
    { key: 'cancelled', label: 'Cancelled', tone: 'muted' },
    { key: 'in progress', label: 'In progress', tone: 'info' },
];

export interface ChartData {
    fields: { name: string }[];
    columns: string[][];
}

const iso = (epoch: number) => new Date(epoch * 1000).toISOString();

/** Runs by state per time bucket, as chart columns: _time, then one column per state seen. */
export function overTimeData(over: RunsSection['over_time']): ChartData {
    const seen = STATES.filter((s) => over.buckets.some((b) => b.counts[s.key]));
    return {
        fields: [{ name: '_time' }, ...seen.map((s) => ({ name: s.key })), { name: '_span' }],
        columns: [over.buckets.map((b) => iso(b.t)), ...seen.map((s) => over.buckets.map((b) => String(b.counts[s.key] || 0))), over.buckets.map(() => String(over.span))],
    };
}

/** Rows as chart columns, in `fields` order (default: every field of the first row, without
 * Splunk's internal ones such as _span). */
export function columnsOf(rows: Row[], fields?: string[]): ChartData {
    const names = fields || Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).filter((f) => f === '_time' || !f.startsWith('_'));
    return {
        fields: names.map((name) => ({ name })),
        columns: names.map((name) =>
            rows.map((r) => {
                const v = r[name];
                return Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v);
            })
        ),
    };
}

export const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
};

export interface Tile {
    id: string;
    label: string;
    value: string;
    sub: string;
    tone: Tone;
}

/** The tiles at the top: the runs, late runs and the engine, each with a tone that is never
 * colour alone (the page draws an icon and the word too). */
export function tiles(runs: RunsSection | null, late: LateSection | null, engine: EngineSection | null): Tile[] {
    const k = runs ? runs.kpi : null;
    const rate = k ? k.success_rate : null;
    const minutes = engine ? num(engine.last.minutes) : null;
    const lateCount = late ? late.count : null;
    const dash = '–';
    return [
        {
            id: 'runs',
            label: 'Runs',
            value: k ? String(k.runs) : dash,
            sub: 'with activity in the range',
            tone: 'muted',
        },
        {
            id: 'succeeded',
            label: 'Succeeded',
            value: k ? String(k.succeeded) : dash,
            sub: 'runs',
            tone: k && k.succeeded ? 'ok' : 'muted',
        },
        {
            id: 'failed',
            label: 'Failed',
            value: k ? String(k.failed) : dash,
            sub: 'runs',
            tone: k && k.failed ? 'error' : 'muted',
        },
        {
            id: 'held',
            label: 'Held or blocked',
            value: k ? String(k.held_blocked) : dash,
            sub: 'waiting for someone',
            tone: k && k.held_blocked ? 'warning' : 'muted',
        },
        {
            id: 'rate',
            label: 'Success rate',
            value: rate === null ? dash : `${rate}%`,
            sub: 'of finished runs',
            tone: rate === null ? 'muted' : rate >= 95 ? 'ok' : rate >= 80 ? 'warning' : 'error',
        },
        {
            id: 'duration',
            label: 'Median run',
            value: k && k.median_duration !== null ? formatDuration(k.median_duration) : dash,
            sub: 'start to finish',
            tone: 'muted',
        },
        {
            id: 'late',
            label: 'Late runs',
            value: lateCount === null ? dash : String(lateCount),
            sub: 'missed their deadline',
            tone: lateCount ? 'warning' : 'muted',
        },
        {
            id: 'engine',
            label: 'Engine last seen',
            value: !engine ? dash : minutes === null ? 'Not seen' : minutes < 1 ? 'Just now' : `${Math.round(minutes)} min ago`,
            sub: 'red after 5 minutes',
            tone: !engine ? 'muted' : minutes !== null && minutes < 5 ? 'ok' : 'error',
        },
    ];
}

export type Names = RunsSection['names'];

export const jobName = (names: Names, id: unknown): string => {
    const key = typeof id === 'string' ? id : '';
    return (names[key] && names[key].name) || key;
};

export const stepName = (names: Names, job: unknown, step: unknown): string => {
    const j = typeof job === 'string' ? names[job] : undefined;
    const s = typeof step === 'string' ? step : '';
    return (j && j.steps[s]) || s;
};
