/* Snippets: copied nodes saved on the server under a name, for every builder to insert
 * (bin/so/snippets.py). Their content is the builder's copy format. */
import { enc, request } from './client';
import type { Clip } from '../features/builder/clipboard';

export interface SnippetInfo {
    id: string;
    name: string;
    description: string;
    owner: string;
    updated_at: number;
    node_count: number;
}

/** Every snippet, by name, without its content. */
export async function listSnippets(): Promise<SnippetInfo[]> {
    const res = await request<{ snippets: SnippetInfo[] }>('GET', 'snippets');
    return res.snippets;
}

export async function getSnippet(id: string): Promise<SnippetInfo & { content: Clip }> {
    const res = await request<{ snippet: SnippetInfo & { content: Clip } }>('GET', `snippets/${enc(id)}`);
    return res.snippet;
}

export async function createSnippet(s: { name: string; description: string; content: Clip }): Promise<SnippetInfo> {
    const res = await request<{ snippet: SnippetInfo }>('POST', 'snippets', { body: s });
    return res.snippet;
}

/** Renames a snippet (its content never changes). */
export async function renameSnippet(id: string, s: { name: string; description: string }): Promise<SnippetInfo> {
    const res = await request<{ snippet: SnippetInfo }>('PUT', `snippets/${enc(id)}`, { body: s });
    return res.snippet;
}

export function deleteSnippet(id: string): Promise<{ deleted: string }> {
    return request<{ deleted: string }>('DELETE', `snippets/${enc(id)}`);
}
