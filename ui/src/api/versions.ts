/* Version history of a job (bin/so/history_api.py). */
import { enc, request } from './client';
import type { JobDefinition, SaveResponse } from './types';

export interface VersionInfo {
    version: number;
    saved_at: number;
    saved_by: string;
    owner: string;
    summary: string[];
    restored_from?: number | null;
}

export interface VersionChange {
    path: string;
    kind: 'added' | 'removed' | 'changed';
    label: string;
    before?: unknown;
    after?: unknown;
}

export async function listVersions(jobId: string): Promise<VersionInfo[]> {
    const res = await request<{ versions: VersionInfo[] }>('GET', `jobs/${enc(jobId)}/versions`);
    return res.versions;
}

export async function getVersion(jobId: string, version: number): Promise<VersionInfo & { definition: JobDefinition }> {
    const res = await request<{ version: VersionInfo & { definition: JobDefinition } }>('GET', `jobs/${enc(jobId)}/versions`, { query: { version } });
    return res.version;
}

export async function compareVersions(jobId: string, a: number, b: number | 'current'): Promise<VersionChange[]> {
    const res = await request<{ changes: VersionChange[] }>('GET', `jobs/${enc(jobId)}/versions`, { query: { compare: `${a},${b}` } });
    return res.changes;
}

export function restoreVersion(jobId: string, version: number): Promise<SaveResponse> {
    return request<SaveResponse>('POST', `jobs/${enc(jobId)}/restore`, { body: { version } });
}
