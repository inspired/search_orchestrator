/* The example jobs shipped with the app: one for each builder view's level (one Simple, two
 * Standard, three Advanced). Each JSON file is a complete job definition, turned off, that
 * tests/test_examples.py also checks with the server's validator. Jobs live in KV Store under an
 * owner, so they are added from the Jobs page (Browse examples) rather than at install. */
import type { JobDefinition, SaveResponse } from '../../../api/types';
import { ApiError } from '../../../api/client';
import type { BuilderView } from '../../simple/useBuilderView';
import hourlyErrors from './01_hourly_errors.json';
import rollup from './04_rollup.json';
import condition from './06_condition.json';
import failurePath from './08_failure_path.json';
import chaining from './10_chaining.json';
import platformHealth from './11_platform_health.json';

/** The tabs of Browse examples: the builder view each example opens in. */
export const VIEWS: Array<{ id: BuilderView; label: string }> = [
    { id: 'simple', label: 'Simple' },
    { id: 'standard', label: 'Standard' },
    { id: 'advanced', label: 'Advanced' },
];

export interface ExampleJob {
    title: string;
    /** One line for the gallery; the job's own description says more. */
    summary: string;
    /** The builder view it opens in, and its tab in the gallery. */
    view: BuilderView;
    features: string[];
    job: JobDefinition & { id: string };
}

const def = (json: unknown) => json as JobDefinition & { id: string };

/** Every example, in the order of the gallery. */
export const EXAMPLE_JOBS: ExampleJob[] = [
    {
        title: 'Hourly splunkd errors',
        summary: 'Counts the errors splunkd logged in the hour before each run.',
        view: 'simple',
        features: ['Schedule', 'One search step', 'Time range'],
        job: def(hourlyErrors),
    },
    {
        title: 'Daily, weekly and monthly rollup',
        summary: 'A daily count kept in a lookup, rolled up on Mondays and on the 1st of the month.',
        view: 'standard',
        features: ['Run when', 'Lookup with append', '$run.scheduled_time$', 'Groups'],
        job: def(rollup),
    },
    {
        title: 'Investigate only when errors were found',
        summary: 'Runs the investigate step only if the count step found errors.',
        view: 'standard',
        features: ['If… condition', '$count_errors.resultCount$', '$step.first.field$'],
        job: def(condition),
    },
    {
        title: 'Retries, recovery and clean-up',
        summary: 'Retries a step, runs a recovery step if it fails and a summary either way; emails on job failure.',
        view: 'advanced',
        features: ['Retries', 'Fails line to a step', 'Finishes either way', 'Job failure action'],
        job: def(failurePath),
    },
    {
        title: 'Chained jobs',
        summary: 'Runs after the rollup example succeeds and starts the hourly errors example when it succeeds.',
        view: 'advanced',
        features: ['After another job', 'Start another job', '| rest', 'Groups'],
        job: def(chaining),
    },
    {
        title: 'Platform health pipeline (everything)',
        summary: 'Four parallel checks, a health score with history, three kinds of condition, an approval gate and a deadline.',
        view: 'advanced',
        features: ['Parallel steps', 'Parameters', 'Simple, SPL and search conditions', 'Approval', 'Deadline', 'Run when', 'Lookup', 'Retries', 'Delayed after', 'Event action', 'Start another job', 'Groups'],
        job: def(platformHealth),
    },
];

/** The ids of the examples a job starts or waits for, and theirs in turn (not the job itself). */
export function examplesNeeded(example: ExampleJob): ExampleJob[] {
    const byId = new Map(EXAMPLE_JOBS.map((e) => [e.job.id, e] as const));
    const out: ExampleJob[] = [];
    const seen = new Set<string>([example.job.id]);
    const walk = (job: JobDefinition) => {
        const actions = [...(job.actions || []), ...(job.steps || []).flatMap((s) => s.actions || [])];
        const refs = [
            ...actions.filter((a) => a.type === 'start_job' && typeof a.job === 'string').map((a) => a.job as string),
            ...(job.triggers || []).filter((t) => t.type === 'completion' && t.job).map((t) => t.job as string),
        ];
        refs.forEach((id) => {
            const dep = byId.get(id);
            if (dep && !seen.has(id)) {
                seen.add(id);
                out.push(dep);
                walk(dep.job);
            }
        });
    };
    walk(example.job);
    return out;
}

export interface AddExamplesResult {
    added: ExampleJob[];
    /** Already a job with this id. */
    skipped: ExampleJob[];
    failed: { example: ExampleJob; message: string }[];
}

/** Why a save failed: the first error issue the server gave, or its message. */
function failureText(err: unknown): string {
    if (err instanceof ApiError) {
        const issue = err.issues.find((i) => i.level === 'error');
        if (issue) {
            return issue.message;
        }
    }
    return err instanceof Error ? err.message : String(err);
}

/** Saves, one after another and turned off, every example (or only `which`, with the examples
 * they start or wait for) whose id is not a job yet. Needed ones go first. */
export async function addExamples(
    existingIds: Iterable<string>,
    createJob: (job: JobDefinition) => Promise<SaveResponse>,
    which: ExampleJob[] = EXAMPLE_JOBS
): Promise<AddExamplesResult> {
    const existing = new Set(existingIds);
    const out: AddExamplesResult = { added: [], skipped: [], failed: [] };
    const queue: ExampleJob[] = [];
    which.forEach((e) => {
        [...examplesNeeded(e).reverse(), e].forEach((x) => {
            if (!queue.includes(x)) {
                queue.push(x);
            }
        });
    });
    for (const example of queue) {
        if (existing.has(example.job.id)) {
            out.skipped.push(example);
            continue;
        }
        try {
            // eslint-disable-next-line no-await-in-loop
            await createJob({ ...example.job, enabled: false });
            out.added.push(example);
        } catch (err) {
            if (err instanceof ApiError && err.code === 'job_exists') {
                out.skipped.push(example);
            } else {
                out.failed.push({ example, message: failureText(err) });
            }
        }
    }
    return out;
}
