/* The app's own log lines (bin/so/logs_api.py), searched in _internal as the caller. */
import { request } from './client';

export type LogLevel = 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG';
export type LogRange = '15m' | '1h' | '24h' | '7d';

export interface LogFilters {
    run_id?: string;
    job_id?: string;
    step_id?: string;
    process?: 'engine' | 'rest' | '';
    level?: LogLevel | '';
    text?: string;
    range?: LogRange;
    limit?: number;
}

export interface LogLine {
    time?: string;
    level?: string;
    process?: string;
    logger?: string;
    event?: string;
    run_id?: string;
    job_id?: string;
    step_id?: string;
    raw?: string;
}

export interface LogsResponse {
    lines: LogLine[];
    notes: string[];
    spl: string;
    earliest: string;
    latest: string;
}

export function searchLogs(filters: LogFilters): Promise<LogsResponse> {
    const query: Record<string, string> = {};
    Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
            query[k] = String(v);
        }
    });
    return request<LogsResponse>('GET', 'logs', { query });
}
