/* Which tab and which node fix an issue, and how many errors each tab holds. */
import type { Action, Issue, JobDefinition } from '../../api/types';
import type { TabId } from './JobTabs';
import { JOB_KEY, actionKey, condKey, stepKey, triggerKey } from './nodeModel';

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
 * ("dependency a->c: ..."), else, for a message about a dependency, one whose expression is
 * empty. Any other message is about the step itself. */
function conditionFor(job: JobDefinition, issue: Issue, step: string): string | null {
    const message = issue.message || '';
    if (!message.startsWith('dependency')) {
        return null;
    }
    const edges = (job.edges || []).filter((e) => e.to === step && e.condition === 'expression');
    const named = /^dependency (.+?)->(.+?):/.exec(message);
    const edge =
        (named && edges.find((e) => e.from === named[1] && e.to === named[2])) || edges.find((e) => !(e.expression || '').trim());
    return edge ? condKey(edge.from, edge.to) : null;
}

/** The field each action type cannot leave empty (mirrors the server's check). */
const REQUIRED_FIELD: Record<string, string> = {
    email: 'to',
    webhook: 'destination',
    event: 'index',
    alert_action: 'action',
    start_job: 'job',
};

const blank = (v: unknown) => typeof v !== 'string' || v === '';
/** Whether `message` names `value`, quoted as the server quotes it, or as a whole word. */
const names = (message: string, value: unknown): boolean => {
    if (typeof value !== 'string' || !value) {
        return false;
    }
    if (message.includes(`'${value}'`) || message.includes(`"${value}"`)) {
        return true;
    }
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\w-])${escaped}($|[^\\w-])`).test(message);
};

const actionsIn = (job: JobDefinition, scope: string): Action[] =>
    (scope === 'job' ? job.actions : (job.steps || []).find((s) => s.id === scope)?.actions) || [];

/** Which action, in the issue's step or the whole job, an action issue is about: the one whose
 * destination the message names, else the first of the kind the message names with its
 * required field empty, else the first with any required field empty. */
function actionIndexFor(job: JobDefinition, issue: Issue): number | null {
    if (issue.code !== 'bad_action' && issue.code !== 'unknown_destination') {
        return null;
    }
    const list = actionsIn(job, issue.step || 'job');
    const message = issue.message || '';
    const isObj = (a: unknown): a is Action => typeof a === 'object' && a !== null;
    let at = list.findIndex((a) => isObj(a) && a.type === 'webhook' && names(message, a.destination));
    if (at < 0 && /malformed/.test(message)) {
        at = list.findIndex((a) => !isObj(a));
    }
    if (at < 0) {
        const kind = /^the (\w+) action needs/.exec(message);
        if (kind) {
            at = list.findIndex((a) => isObj(a) && a.type === kind[1] && blank(a[REQUIRED_FIELD[a.type]]));
        }
    }
    if (at < 0) {
        const bad = /^unknown action type (\S+)/.exec(message);
        if (bad) {
            at = list.findIndex((a) => isObj(a) && names(bad[1], a.type) && !REQUIRED_FIELD[a.type]);
        }
    }
    if (at < 0) {
        at = list.findIndex((a) => isObj(a) && REQUIRED_FIELD[a.type] !== undefined && blank(a[REQUIRED_FIELD[a.type]]));
    }
    return at < 0 ? null : at;
}

/** The issues (from `issues`) that lead to the action at `index` in `scope`. */
export function issuesForAction(job: JobDefinition, issues: Issue[], scope: string, index: number): Issue[] {
    return issues.filter((i) => (i.step || 'job') === scope && actionIndexFor(job, i) === index);
}

/** The trigger a trigger issue is about: the one whose job or cron its message names, else
 * one of the kind the message is about, else the first. */
function triggerFor(job: JobDefinition, issue: Issue): number {
    const list = job.triggers || [];
    const message = issue.message || '';
    let at = list.findIndex((t) => (t.type === 'completion' ? names(message, t.job) : names(message, t.cron)));
    if (at < 0 && /^a completion trigger needs a job/.test(message)) {
        at = list.findIndex((t) => t.type === 'completion' && blank(t.job));
    }
    if (at < 0 && /^a completion trigger/.test(message)) {
        at = list.findIndex((t) => t.type === 'completion');
    }
    if (at < 0 && issue.code === 'bad_cron') {
        at = list.findIndex((t) => t.type === 'cron');
    }
    return at < 0 ? 0 : at;
}

/** The node that fixes an issue, or null when no node does (parameters, time zone, ...). */
export function nodeForIssue(job: JobDefinition, issue: Issue): string | null {
    const action = actionIndexFor(job, issue);
    if (action !== null) {
        return actionKey(issue.step || 'job', action);
    }
    if (issue.step) {
        const cond = EXPRESSION_CODES.includes(issue.code) ? conditionFor(job, issue, issue.step) : null;
        return cond || stepKey(issue.step);
    }
    if (TRIGGER_CODES.includes(issue.code)) {
        return (job.triggers || []).length ? triggerKey(triggerFor(job, issue)) : null;
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
