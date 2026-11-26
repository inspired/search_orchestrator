/* Webhook, Slack, Teams, PagerDuty and ServiceNow actions were removed in 1.50.1 (an Alert
 * action from the service's own Splunk app does it). A job saved before still has them: the
 * builder drops them when it opens the job and says so, and saving keeps the job without them.
 * The server refuses a save that still has one, and skips one still in a run. */
import type { Action, JobDefinition } from '../../api/types';

const REMOVED = ['webhook'];

const isRemoved = (a: unknown) => typeof a === 'object' && a !== null && REMOVED.includes(String((a as Action).type));

/** The job without removed actions, and how many it had. */
export function dropRemovedActions(job: JobDefinition): { job: JobDefinition; dropped: number } {
    let dropped = 0;
    const keep = (list: Action[] | undefined) => {
        const out = (list || []).filter((a) => !isRemoved(a));
        dropped += (list || []).length - out.length;
        return out;
    };
    const actions = keep(job.actions);
    const steps = (job.steps || []).map((s) => (s.actions && s.actions.some(isRemoved) ? { ...s, actions: keep(s.actions) } : s));
    return dropped ? { job: { ...job, actions, steps }, dropped } : { job, dropped: 0 };
}

export const droppedText = (n: number): string =>
    `${n === 1 ? 'A webhook, Slack, Teams, PagerDuty or ServiceNow action was' : `${n} webhook, Slack, Teams, PagerDuty or ServiceNow actions were`} removed from this job: these actions no longer exist. Use an Alert action from the service's own Splunk app instead, and save the job to keep it without them.`;
