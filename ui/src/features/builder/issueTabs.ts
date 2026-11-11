/* Which tab fixes an issue, and how many errors each tab holds. */
import type { Issue } from '../../api/types';
import type { TabId } from './JobTabs';

const TRIGGER_CODES = ['bad_cron', 'bad_trigger', 'bad_timezone', 'timezone_fallback', 'job_chain_cycle'];
const ACTION_CODES = ['bad_action', 'unknown_destination', 'no_failure_notification'];

export function tabForIssue(issue: Issue): TabId {
    if (issue.step) {
        return 'steps';
    }
    if (TRIGGER_CODES.includes(issue.code)) {
        return 'triggers';
    }
    if (issue.code === 'bad_param') {
        return 'params';
    }
    if (ACTION_CODES.includes(issue.code)) {
        return 'actions';
    }
    return 'steps';
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
