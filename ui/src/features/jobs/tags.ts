/* Job tags: up to 10 short words per job (bin/so/model.py TAG_RE) to group jobs by team or
 * system; the Jobs, Runs and Calendar pages filter by them. Matching ignores case. */
import type { JobDefinition } from '../../api/types';

export const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/;
export const MAX_TAGS = 10;

/** Every tag used by the jobs, once each (the first spelling seen), sorted. */
export function allTags(jobs: Array<Pick<JobDefinition, 'tags'>>): string[] {
    const seen = new Map<string, string>();
    jobs.forEach((j) =>
        (j.tags || []).forEach((t) => {
            if (!seen.has(t.toLowerCase())) {
                seen.set(t.toLowerCase(), t);
            }
        })
    );
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function hasTag(job: Pick<JobDefinition, 'tags'> | undefined, tag: string): boolean {
    return !tag || Boolean(job && (job.tags || []).some((t) => t.toLowerCase() === tag.toLowerCase()));
}

/** Tags as typed: trimmed, inner spaces collapsed, duplicates (ignoring case) and empties dropped. */
export function cleanTags(values: string[]): string[] {
    const out: string[] = [];
    values.forEach((v) => {
        const t = String(v).trim().replace(/\s+/g, ' ');
        if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) {
            out.push(t);
        }
    });
    return out;
}

/** What is wrong with the tags, or null. */
export function tagsProblem(tags: string[]): string | null {
    const bad = tags.find((t) => !TAG_RE.test(t));
    if (bad) {
        return `"${bad}" isn't a valid tag: use up to 40 letters, digits, spaces, _ . or -, starting with a letter or digit`;
    }
    return tags.length > MAX_TAGS ? `A job can have at most ${MAX_TAGS} tags` : null;
}
