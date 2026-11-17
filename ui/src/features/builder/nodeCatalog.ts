/* The kinds of node a person can add, and which ones make sense after a given port. */
import type { NodeKind, PortId } from './nodeModel';
import { STEP_KINDS } from './nodeModel';
import { FAMILY_OF } from './nodeStyle';
import type { Family } from './nodeStyle';

export interface CatalogEntry {
    kind: NodeKind;
    label: string;
    family: Family;
    keywords: string[];
    description: string;
}

const entry = (kind: NodeKind, label: string, keywords: string[], description: string): CatalogEntry => ({
    kind,
    label,
    family: FAMILY_OF[kind],
    keywords,
    description,
});

export const CATALOG: CatalogEntry[] = [
    entry('trigger_cron', 'Schedule', ['cron', 'timer', 'time', 'every'], 'Start the job on a schedule.'),
    entry('trigger_completion', 'After another job', ['chain', 'finished', 'completion', 'follow'], 'Start the job when another job finishes.'),
    entry('search', 'Search', ['spl', 'query', 'splunk'], 'Run a search you write here.'),
    entry('saved_search', 'Saved search', ['report', 'existing', 'spl'], 'Run a saved search or report that already exists.'),
    entry('previous', 'Results of earlier steps', ['earlier', 'previous', 'combine', 'merge', 'join', 'append'], 'Work with the results of steps that ran before.'),
    entry('summary_index', 'Summary index', ['collect', 'write', 'index', 'store'], 'Write the results of earlier steps to a summary index.'),
    entry('lookup', 'Lookup', ['outputlookup', 'csv', 'write', 'store'], 'Write the results of earlier steps to a lookup.'),
    entry('approval', 'Approval', ['approve', 'sign-off', 'gate', 'human', 'manual'], 'Wait until someone approves or rejects before going on.'),
    entry('email', 'Email', ['mail', 'message', 'notify'], 'Send an email when the step or job gets here.'),
    entry('webhook', 'Webhook', ['http', 'post', 'url', 'notify'], 'Send a web request when the step or job gets here.'),
    entry('slack', 'Slack', ['chat', 'message', 'notify', 'channel'], 'Post a message to Slack when the step or job gets here.'),
    entry('teams', 'Microsoft Teams', ['teams', 'chat'], 'Post a card to a Microsoft Teams channel when the step or job gets here.'),
    entry('pagerduty', 'PagerDuty', ['pagerduty', 'page', 'incident', 'on-call'], 'Page the on-call person through PagerDuty when the step or job gets here.'),
    entry('servicenow', 'ServiceNow', ['servicenow', 'ticket', 'incident', 'snow'], 'Open a ServiceNow incident when the step or job gets here.'),
    entry('event', 'Event to an index', ['index', 'hec', 'log', 'write'], 'Write an event to an index when the step or job gets here.'),
    entry('alert_action', 'Alert action', ['alert', 'action', 'notify'], 'Run a Splunk alert action when the step or job gets here.'),
    entry('start_job', 'Start another job', ['chain', 'run', 'job', 'trigger'], 'Start a different job when the step or job gets here.'),
];

const ACTION_KINDS: NodeKind[] = ['email', 'webhook', 'event', 'alert_action', 'start_job', 'slack', 'teams', 'pagerduty', 'servicenow'];

const inCatalog = (kinds: NodeKind[]): NodeKind[] => CATALOG.filter((e) => kinds.includes(e.kind)).map((e) => e.kind);

/** Kinds that can sit at the far end of a line dragged from `port` of a `fromKind` node. */
export function targetKinds(port: PortId | null, fromKind: NodeKind | null): NodeKind[] {
    if (port === null) {
        return CATALOG.map((e) => e.kind);
    }
    const steps = inCatalog(STEP_KINDS);
    const actions = inCatalog(ACTION_KINDS);
    if (fromKind === 'job') {
        return port === 'if' || port === 'then' ? [] : actions;
    }
    switch (port) {
        case 'success':
        case 'failure':
        case 'always':
            return [...steps, ...actions];
        case 'start':
        case 'delayed':
        case 'late':
        case 'approval':
            return actions;
        default:
            return steps;
    }
}

/** Case-insensitive search: label prefix, then label substring, then keyword. */
export function searchCatalog(query: string, kinds?: NodeKind[]): CatalogEntry[] {
    const pool = kinds ? CATALOG.filter((e) => kinds.includes(e.kind)) : CATALOG;
    const q = query.trim().toLowerCase();
    if (!q) {
        return pool;
    }
    const rank = (e: CatalogEntry): number => {
        const label = e.label.toLowerCase();
        if (label.startsWith(q)) {
            return 0;
        }
        if (label.includes(q)) {
            return 1;
        }
        return e.keywords.some((k) => k.toLowerCase().includes(q)) ? 2 : -1;
    };
    return pool
        .map((e, i) => ({ e, i, r: rank(e) }))
        .filter((x) => x.r >= 0)
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map((x) => x.e);
}
