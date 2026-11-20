/* Export and import of several jobs as one JSON file: the jobs keep their ids, so Start job
 * actions and After another job triggers between them still point at each other. Import never
 * replaces a job: an id that is already taken is skipped. */
import { ApiError, toDefinition } from '../../api/client';
import type { Job, JobDefinition, SaveResponse } from '../../api/types';
import { parseJobSource } from '../builder/sourceLogic';

export const JOBS_FORMAT = 'search_orchestrator.jobs';

export interface JobsFile {
    format: typeof JOBS_FORMAT;
    version: 1;
    exported_at: string;
    jobs: JobDefinition[];
}

/** The jobs as an export file's text, sorted by name. */
export function exportJobs(jobs: Job[], now: Date = new Date()): string {
    const file: JobsFile = {
        format: JOBS_FORMAT,
        version: 1,
        exported_at: now.toISOString(),
        jobs: [...jobs].sort((a, b) => a.name.localeCompare(b.name)).map((j) => toDefinition(j)),
    };
    return JSON.stringify(file, null, 2);
}

/** A file name with the date: search_orchestrator_jobs_2026-11-19.json, or for one job
 * search_orchestrator_job_daily_logins_2026-11-19.json. */
export function exportFileName(now: Date = new Date(), jobId?: string): string {
    const day = now.toISOString().slice(0, 10);
    return jobId ? `search_orchestrator_job_${jobId.replace(/[^A-Za-z0-9_-]+/g, '_')}_${day}.json` : `search_orchestrator_jobs_${day}.json`;
}

/** Starts a download of `text` as `name`; false where the browser can't. */
export function download(text: string, name: string): boolean {
    try {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
    } catch (err) {
        return false;
    }
}

export type ParsedJobs = { jobs: Array<Record<string, unknown>>; many: boolean; error?: undefined } | { error: string; jobs?: undefined; many?: undefined };

/** Reads pasted or chosen text: an export file, a list of jobs, or one job (`many` false). */
export function parseJobsFile(text: string): ParsedJobs {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (err) {
        const one = parseJobSource(text); // for its line and column message
        return { error: one.error || 'The text is not valid JSON' };
    }
    const obj = value as Record<string, unknown> | null;
    let list: unknown[] | null = null;
    if (Array.isArray(value)) {
        list = value;
    } else if (obj && typeof obj === 'object' && Array.isArray(obj.jobs)) {
        list = obj.jobs as unknown[];
    }
    if (list === null) {
        const one = parseJobSource(text);
        return one.error ? { error: one.error } : { jobs: [one.job as Record<string, unknown>], many: false };
    }
    if (!list.length) {
        return { error: 'The file has no jobs in it' };
    }
    const jobs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < list.length; i += 1) {
        const parsed = parseJobSource(JSON.stringify(list[i]));
        if (parsed.error) {
            return { error: `Job ${i + 1} in the file: ${parsed.error.replace(/^The source/, 'it')}` };
        }
        const id = (list[i] as Record<string, unknown>).id;
        jobs.push(typeof id === 'string' && id ? { ...parsed.job, id } : (parsed.job as Record<string, unknown>));
    }
    return { jobs, many: true };
}

export interface ImportResult {
    added: string[];
    /** Names of jobs whose id is already taken. */
    skipped: string[];
    failed: { name: string; message: string }[];
}

function failureText(err: unknown): string {
    if (err instanceof ApiError) {
        const issue = err.issues.find((i) => i.level === 'error');
        if (issue) {
            return issue.message;
        }
    }
    return err instanceof Error ? err.message : String(err);
}

/** Creates the jobs one after another, skipping ids already taken; turned off when `turnOff`. */
export async function importJobs(
    jobs: Array<Record<string, unknown>>,
    existingIds: Iterable<string>,
    createJob: (job: JobDefinition) => Promise<SaveResponse>,
    turnOff: boolean
): Promise<ImportResult> {
    const existing = new Set(existingIds);
    const out: ImportResult = { added: [], skipped: [], failed: [] };
    for (const job of jobs) {
        const name = String(job.name);
        if (typeof job.id === 'string' && existing.has(job.id)) {
            out.skipped.push(name);
            continue;
        }
        try {
            const body = { ...job, ...(turnOff ? { enabled: false } : {}) } as unknown as JobDefinition;
            // eslint-disable-next-line no-await-in-loop
            await createJob(body);
            out.added.push(name);
        } catch (err) {
            if (err instanceof ApiError && err.code === 'job_exists') {
                out.skipped.push(name);
            } else {
                out.failed.push({ name, message: failureText(err) });
            }
        }
    }
    return out;
}
