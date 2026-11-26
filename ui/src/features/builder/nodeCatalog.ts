/* The kinds of node a person can add, and which ones make sense after a given port. */
import type { Action, JobDefinition } from '../../api/types';
import type { NodeKind, PortId } from './nodeModel';
import { STEP_KINDS, nodeKindOfAction, nodeKindOfStep } from './nodeModel';
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
    entry('event', 'Event to an index', ['index', 'hec', 'log', 'write'], 'Write an event to an index when the step or job gets here.'),
    entry('alert_action', 'Alert action', ['alert', 'action', 'notify'], 'Run a Splunk alert action when the step or job gets here.'),
    entry('start_job', 'Start another job', ['chain', 'run', 'job', 'trigger'], 'Start a different job when the step or job gets here.'),
];

/** Still in development: shown with a Beta tag, as they may not work yet. */
export const BETA_KINDS: NodeKind[] = ['approval'];
export const BETA_NOTE = 'Still in development; it may not work yet.';

export const isBeta = (kind: string): boolean => (BETA_KINDS as string[]).includes(kind);

/** Always on; every other kind an admin can turn off in Settings > Building blocks. */
export const ALWAYS_ON: NodeKind[] = ['trigger_cron', 'search'];

let turnedOff: ReadonlySet<string> = new Set();

/** The kinds an admin turned off (from /me): the builder stops offering them. Jobs that
 * already use one keep it. */
export function setTurnedOff(kinds: string[] | undefined | null): void {
    turnedOff = new Set((kinds || []).filter((k) => !ALWAYS_ON.includes(k as NodeKind)));
}

export function isTurnedOff(kind: string): boolean {
    return turnedOff.has(kind);
}

/** The catalog without the kinds that are turned off. */
export function activeCatalog(): CatalogEntry[] {
    return CATALOG.filter((e) => !isTurnedOff(e.kind));
}

/** Every node kind a job uses (as the server's blocks.kinds_of). */
export function kindsOfJob(job: Partial<JobDefinition>): Set<NodeKind> {
    const out = new Set<NodeKind>();
    (job.triggers || []).forEach((t) => out.add(t.type === 'cron' ? 'trigger_cron' : 'trigger_completion'));
    const actions: Action[] = [...(job.actions || [])];
    (job.steps || []).forEach((s) => {
        out.add(nodeKindOfStep(s));
        actions.push(...(s.actions || []));
    });
    actions.forEach((a) => out.add(nodeKindOfAction(a)));
    return out;
}

/** Labels of the turned-off kinds a job uses, in catalog order. */
export function turnedOffIn(job: Partial<JobDefinition>, off: string[] = [...turnedOff]): string[] {
    const used = kindsOfJob(job);
    return CATALOG.filter((e) => off.includes(e.kind) && used.has(e.kind)).map((e) => e.label);
}

const ACTION_KINDS: NodeKind[] = ['email', 'event', 'alert_action', 'start_job'];

const inCatalog = (kinds: NodeKind[]): NodeKind[] => activeCatalog().filter((e) => kinds.includes(e.kind)).map((e) => e.kind);

/** Kinds that can sit at the far end of a line dragged from `port` of a `fromKind` node. */
export function targetKinds(port: PortId | null, fromKind: NodeKind | null): NodeKind[] {
    if (port === null) {
        return activeCatalog().map((e) => e.kind);
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
    const pool = kinds ? activeCatalog().filter((e) => kinds.includes(e.kind)) : activeCatalog();
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
