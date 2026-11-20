/* Per-step performance of a run (bin/so/perf.py): CPU and memory are read on request. */
import { enc, request } from './client';

export interface StepPerf {
    run_duration?: number;
    scan_count?: number;
    event_count?: number;
    result_count?: number;
    /** Bytes. */
    disk_usage?: number;
    cpu_peak?: number;
    cpu_avg?: number;
    mem_peak_mb?: number;
    source?: 'engine' | 'audit';
}

/** A search the route ran, to open in Search. */
export interface PerfSearch {
    label: string;
    spl: string;
    earliest: string;
    latest: string;
}

export function getPerformance(runId: string): Promise<{ steps: Record<string, StepPerf>; notes: string[]; searches?: PerfSearch[] }> {
    return request('GET', `runs/${enc(runId)}/performance`);
}
