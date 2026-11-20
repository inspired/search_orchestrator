/* Backfills: a job run once for each slot of a past range (bin/so/backfill_api.py). Their
 * runs carry trigger "backfill" and `backfill: <id>`. */
import { enc, request } from './client';
import type { RunState } from './types';

export interface BackfillRequest {
    /** Epoch seconds, or a Splunk time such as -30d@d. */
    from: number | string;
    to: number | string;
    source: 'schedule' | 'step';
    /** Seconds between runs (`step` source only). */
    step?: number;
    /** Runs of the backfill allowed in the job's queue at once, 1 to 5. */
    concurrency?: number;
    params?: Record<string, string>;
}

export interface Backfill {
    id: string;
    job_id: string;
    created_by: string;
    created_at: number;
    from: number;
    to: number;
    source: 'schedule' | 'step';
    step?: number | null;
    concurrency: number;
    next: number;
    count: number;
    state: 'running' | 'cancelled' | 'done';
    run_ids: string[];
}

export interface BackfillRun {
    id: string;
    state: RunState;
    scheduled_time: number;
}

/** The slots a backfill would run, without starting it. */
export function planBackfill(jobId: string, req: BackfillRequest): Promise<{ slots: number[]; count: number }> {
    return request<{ slots: number[]; count: number }>('POST', `jobs/${enc(jobId)}/backfills`, { body: { ...req, dry_run: true } });
}

export async function createBackfill(jobId: string, req: BackfillRequest): Promise<Backfill> {
    const res = await request<{ backfill: Backfill }>('POST', `jobs/${enc(jobId)}/backfills`, { body: req });
    return res.backfill;
}

export async function listBackfills(filters: { job_id?: string; state?: Backfill['state'] } = {}): Promise<Backfill[]> {
    const res = await request<{ backfills: Backfill[] }>('GET', 'backfills', { query: filters });
    return res.backfills;
}

export function getBackfill(id: string): Promise<{ backfill: Backfill; runs: BackfillRun[] }> {
    return request<{ backfill: Backfill; runs: BackfillRun[] }>('GET', `backfills/${enc(id)}`);
}

export function cancelBackfill(id: string): Promise<{ command_id: string }> {
    return request<{ command_id: string }>('POST', `backfills/${enc(id)}/cancel`, { body: {} });
}
