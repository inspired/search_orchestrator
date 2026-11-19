/* The app's own log lines (bin/so/logs_api.py), searched in _internal as the caller: the
 * lines, a summary for the health tiles and graphs, a breakdown of slow routes and Splunk
 * calls, and errors grouped into problems. */
import { request } from './client';

export type LogLevel = 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG';
export type LogRange = '15m' | '1h' | '24h' | '7d';

export interface LogFilters {
    run_id?: string;
    job_id?: string;
    step_id?: string;
    event?: string;
    process?: 'engine' | 'rest' | '';
    level?: LogLevel | '';
    text?: string;
    range?: LogRange;
    sort?: 'newest' | 'oldest';
    limit?: number;
}

export interface LogLine {
    time?: string;
    level?: string;
    process?: string;
    event?: string;
    run_id?: string;
    job_id?: string;
    step_id?: string;
    /** Every key=value field of the line. */
    fields?: Record<string, string>;
    /** The free text of a line without event=. */
    message?: string | null;
    traceback?: string | null;
    raw?: string;
}

/** Job and step names for the ids in the lines (jobs the caller may see). */
export type LogNames = Record<string, { name: string; steps: Record<string, string> }>;

export interface SearchLink {
    spl: string;
    earliest: string;
    latest: string;
}

export interface LogsResponse extends SearchLink {
    lines: LogLine[];
    notes: string[];
    names?: LogNames;
}

export interface LogBucket {
    time: string;
    error: number | null;
    warning: number | null;
    info: number | null;
    debug: number | null;
    req_ok: number | null;
    req_4xx: number | null;
    req_5xx: number | null;
    req_p95: number | null;
    ticks: number | null;
    tick_avg: number | null;
    tick_max: number | null;
    active_runs: number | null;
}

export interface LogTotals {
    error: number;
    warning: number;
    info: number;
    debug: number;
    requests: number;
    req_4xx: number;
    req_5xx: number;
    actions_failed: number;
    actions_done: number;
    runs_failed: number;
    runs_succeeded: number;
    steps_failed: number;
    engine: number;
    rest: number;
}

export interface LogSummary {
    range: LogRange;
    span: string;
    buckets: LogBucket[];
    totals: LogTotals;
    events: { event: string; count: number; levels: Record<string, number> }[];
    engine: { running: boolean; last_seen: number | null };
    log_level: string;
    notes: string[];
    searches: Record<string, SearchLink>;
}

export interface Timing {
    method: string;
    count: number;
    p95: number | null;
    avg: number | null;
    max: number | null;
}

export interface LogBreakdown {
    routes: (Timing & { route: string; failed: number })[];
    calls: (Timing & { endpoint: string; errors: number })[];
    requests_p95: number | null;
    requests: number;
    notes: string[];
    searches: Record<string, SearchLink>;
}

export interface LogProblem {
    signature: string;
    count: number;
    level: string;
    event?: string | null;
    first: string;
    last: string;
    jobs: string[];
    runs: number;
    sample: LogLine;
}

export interface LogProblems extends SearchLink {
    problems: LogProblem[];
    notes: string[];
    names?: LogNames;
}

function query(filters: LogFilters): Record<string, string> {
    const out: Record<string, string> = {};
    Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
            out[k] = String(v);
        }
    });
    return out;
}

export function searchLogs(filters: LogFilters): Promise<LogsResponse> {
    return request<LogsResponse>('GET', 'logs', { query: query(filters) });
}

export function logSummary(filters: LogFilters): Promise<LogSummary> {
    return request<LogSummary>('GET', 'logs/summary', { query: query(filters) });
}

export function logBreakdown(filters: LogFilters): Promise<LogBreakdown> {
    return request<LogBreakdown>('GET', 'logs/breakdown', { query: query(filters) });
}

export function logProblems(filters: LogFilters): Promise<LogProblems> {
    return request<LogProblems>('GET', 'logs/problems', { query: query(filters) });
}
