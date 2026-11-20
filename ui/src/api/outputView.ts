/* View output (bin/so/output_view.py): a read-only search of what a Lookup or Summary
 * index step, or an email or event action, wrote. Poll and read it like a preview. */
import { request } from './client';
import type { JobDefinition } from './types';

export type OutputTarget = { step_id: string } | { action: { scope: string; index: number } };
export type OutputRange = '24h' | '7d' | '30d';

export interface OutputViewStart {
    status: 'started';
    sid: string;
    spl: string;
    earliest: string | null;
    latest: string | null;
    kind: 'lookup' | 'summary_index' | 'event' | 'email';
}

/** For a run (`runId`: its definition and time window) or for the job being edited. */
export function viewOutput(target: OutputTarget, from: { runId: string } | { job: JobDefinition; range: OutputRange }): Promise<OutputViewStart> {
    const body = 'runId' in from ? { target, run_id: from.runId } : { target, job: from.job, range: from.range };
    return request<OutputViewStart>('POST', 'preview/output', { body });
}
