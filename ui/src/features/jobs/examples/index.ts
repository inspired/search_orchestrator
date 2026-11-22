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
import platformHealth from './11_platform_health.json';
import approvalGate from './12_approval.json';
import deadline from './13_deadline.json';
import searchCondition from './14_search_condition.json';
import summaryIndex from './15_summary_index.json';
import fanOut from './16_fan_out.json';
import businessHours from './17_business_hours.json';
import patientRetries from './18_patient_retries.json';

export type ExampleLevel = 'Simple' | 'Intermediate' | 'Advanced';

/** The tabs of Browse examples; each example's second tag is its group. */
export type ExampleGroup = 'getting started' | 'branches' | 'reliability' | 'notifications' | 'chaining';
export const GROUPS: Array<{ id: ExampleGroup; label: string }> = [
    { id: 'getting started', label: 'Getting started' },
    { id: 'branches', label: 'Branches and conditions' },
    { id: 'reliability', label: 'Retries, delays and deadlines' },
    { id: 'notifications', label: 'Approvals and notifications' },
    { id: 'chaining', label: 'Chaining jobs' },
];

export interface ExampleJob {
    title: string;
    /** One line for the gallery; the job's own description says more. */
    summary: string;
    level: ExampleLevel;
    features: string[];
    group: ExampleGroup;
    job: JobDefinition & { id: string };
}

const def = (json: unknown) => json as JobDefinition & { id: string };

type Entry = Omit<ExampleJob, 'group'>;

const ENTRIES: Entry[] = [
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
    {
        title: 'Platform health pipeline (everything)',
        summary: 'Four parallel checks, a health score with history, three kinds of condition, an approval gate and a deadline.',
        level: 'Advanced',
        features: ['Parallel steps', 'Parameters', 'Simple, SPL and search conditions', 'Approval', 'Deadline', 'Run when', 'Lookup', 'Retries', 'Delayed after', 'Event action', 'Start another job', 'Groups'],
        job: def(platformHealth),
    },
    {
        title: 'Keep a daily summary in an index',
        summary: "Writes yesterday's event counts by host and sourcetype to the summary index, marked with the run id.",
        level: 'Simple',
        features: ['Summary index node', '| collect', '$run.id$'],
        job: def(summaryIndex),
    },
    {
        title: 'Every 30 minutes in business hours',
        summary: 'A weekday schedule from 08:00 to 17:30 that lists searches the scheduler skipped.',
        level: 'Simple',
        features: ['Custom schedule', 'Schedule preview'],
        job: def(businessHours),
    },
    {
        title: 'Only when a search finds something',
        summary: 'A search returns results line checks for failed logins; only then does the detail step run.',
        level: 'Intermediate',
        features: ['Search returns results', 'Skipped branch', '_audit'],
        job: def(searchCondition),
    },
    {
        title: 'Finish by 07:00',
        summary: 'Starts at 06:00 with a deadline of 07:00 and emails when the run is late.',
        level: 'Intermediate',
        features: ['Deadline', 'Is late email'],
        job: def(deadline),
    },
    {
        title: 'Approve before recording',
        summary: 'Finds the top license-using index, asks an admin to approve, then records it as an event.',
        level: 'Intermediate',
        features: ['Approval step', 'Asks for approval email', 'Event action', '$step.first.field$'],
        job: def(approvalGate),
    },
    {
        title: 'Notify with patient retries',
        summary: 'A failure email that retries 5 times, from 2 minutes, when the mail server is down.',
        level: 'Simple',
        features: ['Job failure action', 'Action retries'],
        job: def(patientRetries),
    },
    {
        title: 'Start two jobs when done',
        summary: 'A morning check that starts the hourly errors and top sourcetypes examples when it succeeds.',
        level: 'Intermediate',
        features: ['Start another job', 'Two actions on one line'],
        job: def(fanOut),
    },
];

/** Every example with its group (from its tags), in the order above. */
export const EXAMPLE_JOBS: ExampleJob[] = ENTRIES.map((e) => ({ ...e, group: ((e.job.tags || [])[1] || 'getting started') as ExampleGroup }));

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
