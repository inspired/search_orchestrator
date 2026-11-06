/* Typed client for the Search Orchestrator REST API (bin/so/api.py), called through
 * splunkd's proxy at /<locale>/splunkd/__raw/services/orchestrator/... Every failure
 * throws ApiError with the server's {code, message, issues}. */
import { createRESTURL } from '@splunk/splunk-utils/url';
import { getCSRFToken } from '@splunk/splunk-utils/config';
import type {
    DefinitionChoice,
    Destination,
    DestinationInput,
    Health,
    Issue,
    Job,
    JobDefinition,
    Me,
    PreviewRequest,
    PreviewResults,
    PreviewStart,
    PreviewStatus,
    RerunRequest,
    RunDetailResponse,
    RunFilters,
    RunSummary,
    SaveResponse,
    Settings,
    ValidateResponse,
} from './types';

export class ApiError extends Error {
    status: number;

    code: string;

    issues: Issue[];

    /** Extra fields some codes add, such as `choices` for definition_choice_required. */
    extra: Record<string, unknown>;

    constructor(status: number, code: string, message: string, issues: Issue[] = [], extra: Record<string, unknown> = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.issues = issues;
        this.extra = extra;
    }

    get choices(): DefinitionChoice[] | undefined {
        return this.extra.choices as DefinitionChoice[] | undefined;
    }
}

/** How long a request may take before it is abandoned. */
export const REQUEST_TIMEOUT_MS = 30000;

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Query = Record<string, string | number | boolean | undefined | null>;

function url(path: string, query: Query = {}): string {
    const params = new URLSearchParams();
    Object.keys(query).forEach((key) => {
        const value = query[key];
        if (value !== undefined && value !== null && value !== '') {
            params.append(key, String(value));
        }
    });
    params.append('output_mode', 'json');
    return `${createRESTURL(`orchestrator/${path}`)}?${params.toString()}`;
}

function enc(id: string): string {
    return encodeURIComponent(id);
}

async function request<T>(method: Method, path: string, options: { query?: Query; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
    };
    const token = getCSRFToken();
    if (token) {
        headers['X-Splunk-Form-Key'] = token;
    }
    // A request that never settles would stall polling, so every request gives up after
    // REQUEST_TIMEOUT_MS, including the body read.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const init: RequestInit = { method, headers, credentials: 'include', signal: controller.signal };
    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(options.body);
    }
    let res: Response;
    let text: string;
    try {
        res = await fetch(url(path, options.query), init);
        text = await res.text();
    } catch (err) {
        if (controller.signal.aborted) {
            throw new ApiError(0, 'timeout', `Splunk did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`);
        }
        throw new ApiError(0, 'network_error', `Splunk could not be reached (${(err as Error).message}).`);
    } finally {
        clearTimeout(timer);
    }
    let payload: unknown = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch (err) {
        payload = null;
    }
    if (!res.ok) {
        const error = (payload as { error?: Record<string, unknown> } | null)?.error;
        if (error && typeof error === 'object' && typeof error.code === 'string') {
            const { code, message, issues, ...extra } = error;
            throw new ApiError(res.status, code as string, String(message ?? code), (issues as Issue[]) || [], extra);
        }
        throw new ApiError(res.status, `http_${res.status}`, `The request failed with HTTP ${res.status}.`);
    }
    return payload as T;
}

/** Fields the server computes or owns: never sent back on save. */
const SERVER_FIELDS = [
    'owner',
    'permissions',
    'next_run',
    'next_run_beyond',
    'last_run',
    'hidden_searches',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by',
];

/** A job's definition as the save routes expect it. */
export function toDefinition(job: JobDefinition | Job): JobDefinition {
    const out = { ...(job as unknown as Record<string, unknown>) };
    SERVER_FIELDS.forEach((key) => delete out[key]);
    Object.keys(out).forEach((key) => {
        if (key.startsWith('_')) {
            delete out[key];
        }
    });
    return out as unknown as JobDefinition;
}

// Jobs.

export async function listJobs(): Promise<Job[]> {
    return (await request<{ jobs: Job[] }>('GET', 'jobs')).jobs;
}

export async function getJob(jobId: string): Promise<Job> {
    return (await request<{ job: Job }>('GET', `jobs/${enc(jobId)}`)).job;
}

export function createJob(job: JobDefinition): Promise<SaveResponse> {
    return request<SaveResponse>('POST', 'jobs', { body: toDefinition(job) });
}

export function updateJob(jobId: string, job: JobDefinition | Job): Promise<SaveResponse> {
    return request<SaveResponse>('PUT', `jobs/${enc(jobId)}`, { body: toDefinition(job) });
}

/** Enable or disable a job. The owner is kept: nobody takes the job over. */
export function setJobEnabled(jobId: string, enabled: boolean): Promise<{ job: Job }> {
    return request<{ job: Job }>('POST', `jobs/${enc(jobId)}/enabled`, { body: { enabled } });
}

export function deleteJob(jobId: string): Promise<{ deleted: string }> {
    return request('DELETE', `jobs/${enc(jobId)}`);
}

export function validateJob(job: JobDefinition | Job): Promise<ValidateResponse> {
    return request<ValidateResponse>('POST', 'jobs/validate', { body: toDefinition(job) });
}

export interface StartRunRequest {
    params?: Record<string, string>;
    scheduled_time?: number;
}

export function startRun(jobId: string, body: StartRunRequest = {}): Promise<{ run_id: string }> {
    return request('POST', `jobs/${enc(jobId)}/runs`, { body });
}

// Runs.

export async function listRuns(filters: RunFilters = {}): Promise<RunSummary[]> {
    const query: Query = { job_id: filters.job_id, state: filters.state, limit: filters.limit };
    return (await request<{ runs: RunSummary[] }>('GET', 'runs', { query })).runs;
}

export function getRun(runId: string): Promise<RunDetailResponse> {
    return request<RunDetailResponse>('GET', `runs/${enc(runId)}`);
}

function control(runId: string, action: 'pause' | 'resume' | 'cancel' | 'dismiss') {
    return request<{ command_id: string }>('POST', `runs/${enc(runId)}/${action}`, { body: {} });
}

export const pauseRun = (runId: string) => control(runId, 'pause');
export const resumeRun = (runId: string) => control(runId, 'resume');
export const cancelRun = (runId: string) => control(runId, 'cancel');
export const dismissRun = (runId: string) => control(runId, 'dismiss');

/** Throws ApiError `definition_choice_required` (with `choices`) if the job changed and no
 * definition was chosen. */
export function rerun(runId: string, body: RerunRequest): Promise<{ command_id: string; definition: string }> {
    return request('POST', `runs/${enc(runId)}/rerun`, { body });
}

// Step previews. Errors: needs_preview (`extra.steps`), upstream_failed, run_step_missing,
// run_results_expired and run_results_forbidden (`extra.step`), invalid (`issues`),
// bad_param, forbidden.

/** The time a preview defaults to (the job's latest cron slot, or now), and the seconds a
 * run's step results are kept after it ends. */
export function previewDefaults(job: JobDefinition | Job): Promise<{ scheduled_time: number; result_retention?: number }> {
    return request('POST', 'preview/defaults', { body: { job: toDefinition(job) } });
}

export function startPreview(req: PreviewRequest): Promise<PreviewStart> {
    return request<PreviewStart>('POST', 'preview', { body: { ...req, job: toDefinition(req.job) } });
}

/** `limit`: seconds the preview may run before the server cancels it. */
export function previewStatus(sid: string, limit?: number): Promise<PreviewStatus> {
    return request<PreviewStatus>('GET', `preview/${enc(sid)}`, { query: { limit } });
}

export function previewResults(sid: string): Promise<PreviewResults> {
    return request<PreviewResults>('GET', `preview/${enc(sid)}/results`);
}

export function cancelPreview(sid: string): Promise<{ cancelled: boolean }> {
    return request('POST', `preview/${enc(sid)}/cancel`, { body: {} });
}

// Settings, destinations, health and the caller.

export async function getSettings(): Promise<Settings> {
    return (await request<{ settings: Settings }>('GET', 'settings')).settings;
}

export async function putSettings(changes: Partial<Settings>): Promise<Settings> {
    return (await request<{ settings: Settings }>('PUT', 'settings', { body: changes })).settings;
}

export async function listDestinations(): Promise<Destination[]> {
    return (await request<{ destinations: Destination[] }>('GET', 'destinations')).destinations;
}

export async function saveDestination(dest: DestinationInput): Promise<Destination> {
    return (await request<{ destination: Destination }>('POST', 'destinations', { body: dest })).destination;
}

export function deleteDestination(name: string): Promise<{ deleted: string }> {
    return request('DELETE', `destinations/${enc(name)}`);
}

export async function health(): Promise<Health> {
    return (await request<{ health: Health }>('GET', 'health')).health;
}

/** The caller's capabilities. Used to hide what the user can't do; the server enforces it. */
export function me(): Promise<Me> {
    return request<Me>('GET', 'me');
}
