/* Test a dependency's condition now (POST preview/condition): a simple comparison is answered
 * at once; an eval or search condition starts a search, polled with previewStatus. */
import type { ConditionKind, JobDefinition, PreviewInput } from './types';
import { request, toDefinition } from './client';

export type ConditionTestStart =
    | { status: 'done'; kind: ConditionKind; result: boolean; why: string; filled?: string; values?: Record<string, string>; error?: string }
    | { status: 'started'; kind: 'eval' | 'search'; sid: string; spl: string; earliest: string | null; latest: string | null };

export function testCondition(req: {
    job: JobDefinition;
    from: string;
    to: string;
    scheduled_time: number;
    params: Record<string, string>;
    input: PreviewInput;
}): Promise<ConditionTestStart> {
    return request<ConditionTestStart>('POST', 'preview/condition', { body: { ...req, job: toDefinition(req.job) } });
}
