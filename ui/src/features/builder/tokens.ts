/* The values a step, dependency or action can read with $token$ (front-end list for the
 * "Insert value" picker; the server resolves them when the job runs). */
import type { JobDefinition } from '../../api/types';
import { parentsOf } from './graphLogic';

export interface TokenOption {
    token: string;
    label: string;
    description: string;
}

export interface TokenGroup {
    title: string;
    options: TokenOption[];
}

export interface Selection {
    start: number;
    end: number;
}

/** Every step upstream of `id`, direct or not. */
function ancestors(edges: JobDefinition['edges'], id: string): Set<string> {
    const seen = new Set<string>();
    const stack = parentsOf(edges || [], id);
    while (stack.length) {
        const n = stack.pop() as string;
        if (!seen.has(n)) {
            seen.add(n);
            parentsOf(edges || [], n).forEach((p) => stack.push(p));
        }
    }
    return seen;
}

/** Steps in dependency order (a step after all the steps it depends on); ties keep job order. */
function topoOrder(job: JobDefinition): string[] {
    const ids = (job.steps || []).map((s) => s.id);
    const done = new Set<string>();
    const out: string[] = [];
    while (out.length < ids.length) {
        const next = ids.find((id) => !done.has(id) && parentsOf(job.edges || [], id).every((p) => done.has(p) || !ids.includes(p)));
        if (next === undefined) {
            // A cycle: keep the rest in job order rather than loop.
            ids.filter((id) => !done.has(id)).forEach((id) => out.push(id));
            break;
        }
        done.add(next);
        out.push(next);
    }
    return out;
}

const FIRST_ROW_FIELD_RE = /^[A-Za-z0-9_]+$/;

/** Token groups for a field of `stepId` (null: a job-level action, which sees every step). */
export function availableTokens(job: JobDefinition, stepId: string | null, previewFields: Record<string, string[]>): TokenGroup[] {
    const run: TokenOption[] = [
        { token: '$run.id$', label: 'Run id', description: 'The id of this run.' },
        { token: '$run.scheduled_time$', label: 'Scheduled time', description: 'When this run was scheduled to start.' },
        ...(job.params || []).map((p) => ({
            token: `$run.param.${p.name}$`,
            label: `Parameter ${p.name}`,
            description: `The value of the ${p.label || p.name} parameter for this run.`,
        })),
    ];
    const groups: TokenGroup[] = [{ title: 'This run', options: run }];
    const upstream = stepId === null ? null : ancestors(job.edges, stepId);
    const byId = new Map((job.steps || []).map((s) => [s.id, s]));
    topoOrder(job).forEach((id) => {
        if (upstream && !upstream.has(id)) {
            return;
        }
        const step = byId.get(id);
        if (!step) {
            return;
        }
        const options: TokenOption[] = [
            { token: `$${id}.sid$`, label: 'Search id', description: 'The id of the search job this step ran.' },
            { token: `$${id}.resultCount$`, label: 'Result count', description: 'Number of rows the step returned.' },
            { token: `$${id}.status$`, label: 'Status', description: 'How the step ended, such as success or failed.' },
            // The server resolves only first.<letters, digits, _>; other fields can't be tokens.
            ...(previewFields[id] || []).filter((f) => FIRST_ROW_FIELD_RE.test(f)).map((f) => ({
                token: `$${id}.first.${f}$`,
                label: `First row: ${f}`,
                description: `The ${f} value in the first row the step returned.`,
            })),
        ];
        groups.push({ title: step.name || step.id, options });
    });
    return groups;
}

/** Puts `token` at the selection (replacing it), or at the end when there is none. */
export function insertAt(text: string, selection: Selection | null, token: string): { text: string; caret: number } {
    const len = text.length;
    const start = selection ? Math.min(Math.max(selection.start, 0), len) : len;
    const end = selection ? Math.min(Math.max(selection.end, start), len) : len;
    return { text: text.slice(0, start) + token + text.slice(end), caret: start + token.length };
}
