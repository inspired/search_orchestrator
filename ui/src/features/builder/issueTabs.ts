/* Which tab and which node fix an issue, and how many errors each tab holds. */
import type { Issue, JobDefinition } from '../../api/types';
import type { TabId } from './JobTabs';
import { JOB_KEY, condKey, stepKey, triggerKey } from './nodeModel';

const TRIGGER_CODES = ['bad_cron', 'bad_trigger', 'job_chain_cycle'];
const ACTION_CODES = ['bad_action', 'unknown_destination', 'no_failure_notification'];
const EXPRESSION_CODES = ['bad_expression', 'unknown_token'];
const SETTINGS_CODES = ['bad_timezone', 'timezone_fallback'];

export function tabForIssue(issue: Issue): TabId {
    if (SETTINGS_CODES.includes(issue.code)) {
        return 'settings';
    }
    if (issue.code === 'bad_param') {
        return 'params';
    }
    return 'steps';
}

/** The expression edge into `step` an expression issue is about: the one its message names
 * ("dependency a->c: ..."), else one whose expression is empty. */
function conditionFor(job: JobDefinition, issue: Issue, step: string): string | null {
    const edges = (job.edges || []).filter((e) => e.to === step && e.condition === 'expression');
    const named = /^dependency (.+?)->(.+?):/.exec(issue.message || '');
    const edge =
        (named && edges.find((e) => e.from === named[1] && e.to === named[2])) || edges.find((e) => !(e.expression || '').trim());
    return edge ? condKey(edge.from, edge.to) : null;
}

/** The node that fixes an issue, or null when no node does (parameters, time zone, ...). */
export function nodeForIssue(job: JobDefinition, issue: Issue): string | null {
    if (issue.step) {
        const cond = EXPRESSION_CODES.includes(issue.code) ? conditionFor(job, issue, issue.step) : null;
        return cond || stepKey(issue.step);
    }
    if (TRIGGER_CODES.includes(issue.code)) {
        return (job.triggers || []).length ? triggerKey(0) : null;
    }
    if (ACTION_CODES.includes(issue.code)) {
        return JOB_KEY;
    }
    return null;
}

export function issueCounts(issues: Issue[]): Partial<Record<TabId, number>> {
    const out: Partial<Record<TabId, number>> = {};
    issues.forEach((i) => {
        if (i.level === 'error') {
            const tab = tabForIssue(i);
            out[tab] = (out[tab] || 0) + 1;
        }
    });
    return out;
}
