/* The example jobs shipped with the app, from simple to advanced. Each JSON file is a complete
 * job definition, turned off, that tests/test_examples.py also checks with the server's
 * validator. Jobs live in KV Store under an owner, so they are added from the Jobs page
 * (Browse examples) rather than at install. */
import type { JobDefinition, SaveResponse } from '../../../api/types';
import { ApiError } from '../../../api/client';
import hourlyErrors from './01_hourly_errors.json';
import topSourcetypes from './02_top_sourcetypes.json';
import searchActivity from './03_search_activity.json';
import rollup from './04_rollup.json';
import parallel from './05_parallel.json';
import condition from './06_condition.json';
import parameters from './07_parameters.json';
import failurePath from './08_failure_path.json';
import slowStep from './09_slow_step.json';
import chaining from './10_chaining.json';

export type ExampleLevel = 'Simple' | 'Intermediate' | 'Advanced';

export interface ExampleJob {
    title: string;
    /** One line for the gallery; the job's own description says more. */
    summary: string;
    level: ExampleLevel;
    features: string[];
    job: JobDefinition & { id: string };
}

const def = (json: unknown) => json as JobDefinition & { id: string };

export const EXAMPLE_JOBS: ExampleJob[] = [
    {
        title: 'Hourly splunkd errors',
        summary: 'Counts the errors splunkd logged in the hour before each run.',
        level: 'Simple',
        features: ['Schedule', 'One search step', 'Time range'],
        job: def(hourlyErrors),
    },
    {
        title: 'Top sourcetypes to a lookup',
        summary: "Writes yesterday's top 20 sourcetypes by events to so_example_top_sourcetypes.csv.",
        level: 'Simple',
        features: ['Lookup node', 'Results of earlier steps'],
        job: def(topSourcetypes),
    },
    {
        title: 'Daily search activity',
        summary: 'Searches per user from _audit, with an email (to you@example.com) if the step fails.',
        level: 'Simple',
        features: ['Fails line', 'Email action'],
        job: def(searchActivity),
    },
    {
        title: 'Daily, weekly and monthly rollup',
        summary: 'A daily count kept in a lookup, rolled up on Mondays and on the 1st of the month.',
        level: 'Intermediate',
        features: ['Run when', 'Lookup with append', '$run.scheduled_time$', 'Groups'],
        job: def(rollup),
    },
    {
        title: 'Two branches, one report',
        summary: 'Errors by component and warnings by host run side by side, then merge into one table.',
        level: 'Intermediate',
        features: ['Parallel steps', 'Results of earlier steps'],
        job: def(parallel),
    },
    {
        title: 'Investigate only when errors were found',
        summary: 'Runs the investigate step only if the count step found errors.',
        level: 'Intermediate',
        features: ['If… condition', '$count_errors.resultCount$', '$step.first.field$'],
        job: def(condition),
    },
    {
        title: 'Parameters for component and threshold',
        summary: 'A component (list) and threshold (number) used in the searches and in a condition.',
        level: 'Intermediate',
        features: ['Parameters', '$run.param.name$', 'If… condition'],
        job: def(parameters),
    },
    {
        title: 'Retries, recovery and clean-up',
        summary: 'Retries a step, runs a recovery step if it fails and a summary either way; emails on job failure.',
        level: 'Advanced',
        features: ['Retries', 'Fails line to a step', 'Finishes either way', 'Job failure action'],
        job: def(failurePath),
    },
    {
        title: 'A slow step and a delay alert',
        summary: 'A deliberately slow step that counts as delayed after 30 seconds and emails once.',
        level: 'Advanced',
        features: ['Delayed after', 'Is delayed email', 'Max runtime', 'Live run graph'],
        job: def(slowStep),
    },
    {
        title: 'Chained jobs',
        summary: 'Runs after the rollup example succeeds and starts the hourly errors example when it succeeds.',
        level: 'Advanced',
        features: ['After another job', 'Start another job', '| rest', 'Groups'],
        job: def(chaining),
    },
];

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

/** Saves, one after another and turned off, every example whose id is not a job yet. */
export async function addExamples(existingIds: Iterable<string>, createJob: (job: JobDefinition) => Promise<SaveResponse>): Promise<AddExamplesResult> {
    const existing = new Set(existingIds);
    const out: AddExamplesResult = { added: [], skipped: [], failed: [] };
    for (const example of EXAMPLE_JOBS) {
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
