/* What a bulk action on the Jobs page does to each picked job: which jobs it applies to and
 * why it skips the others (each checked as if done on its own), and running it one job at a
 * time so one failure doesn't stop the rest. */
import type { Job, Me } from '../../api/types';

export type JobBulkAction = 'run' | 'enable' | 'disable' | 'export' | 'tag' | 'delete';

export interface Skipped {
    job: Job;
    reason: string;
}

export interface Plan {
    targets: Job[];
    skipped: Skipped[];
}

export interface Outcome {
    job: Job;
    ok: boolean;
    message?: string;
}

const hasTag = (job: Job, tag: string) => (job.tags || []).some((t) => t.toLowerCase() === tag.toLowerCase());

/** Why `action` doesn't apply to `job`, or null when it does. */
function whyNot(job: Job, action: JobBulkAction, me: Me | null | undefined, tag: string): string | null {
    const canEdit = Boolean(job.permissions && job.permissions.can_edit);
    const canRun = Boolean(job.permissions && job.permissions.can_run) && (!me || me.can_run || me.can_admin);
    switch (action) {
        case 'export':
            return null;
        case 'run':
            return canRun ? null : "you can't run it";
        case 'enable':
        case 'disable': {
            if (!canEdit) {
                return "you can't edit it";
            }
            const on = job.enabled !== false;
            return on === (action === 'enable') ? `already ${action}d` : null;
        }
        case 'tag':
            // Tags are changed on their own (jobs/<id>/tags), so the owner stays.
            if (!canEdit) {
                return "you can't edit it";
            }
            return hasTag(job, tag) ? `already tagged ${tag}` : null;
        case 'delete':
            return canEdit ? null : "you can't edit it";
        default: {
            const never: never = action;
            throw new Error(`Unknown bulk action ${String(never)}`);
        }
    }
}

export function plan(jobs: Job[], action: JobBulkAction, me: Me | null | undefined, tag = ''): Plan {
    const out: Plan = { targets: [], skipped: [] };
    jobs.forEach((job) => {
        const reason = whyNot(job, action, me, tag);
        if (reason) {
            out.skipped.push({ job, reason });
        } else {
            out.targets.push(job);
        }
    });
    return out;
}

/** `fn` on each job in turn; a failure is reported and the rest still run. */
/** How the result banner looks: a warning if anything failed or was skipped, info if nothing was done. */
export type ResultTone = 'success' | 'warning' | 'info';

export function resultTone(outcomes: Outcome[], skipped: Skipped[]): ResultTone {
    if (outcomes.some((o) => !o.ok) || skipped.length) {
        return 'warning';
    }
    return outcomes.length ? 'success' : 'info';
}

export async function runEach(jobs: Job[], fn: (job: Job) => Promise<unknown>): Promise<Outcome[]> {
    const out: Outcome[] = [];
    for (const job of jobs) {
        try {
            await fn(job);
            out.push({ job, ok: true });
        } catch (err) {
            out.push({ job, ok: false, message: (err as Error).message });
        }
    }
    return out;
}
