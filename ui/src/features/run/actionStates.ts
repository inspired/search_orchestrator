/* How each action node of a run's definition went, from the run's action rows. */
import type { ActionRun, JobDefinition } from '../../api/types';
import { statusIcon } from '../../components/StatusText';
import { actionKey } from '../builder/nodeModel';

export interface ActionState {
    state: string;
    attempts?: number;
    error?: string;
}

interface Entry {
    index?: number;
    state?: string;
    attempts?: number;
    error?: string | null;
}

/** The node key of each global action index: job actions first, then each step's in step order. */
function keysByIndex(definition: JobDefinition): string[] {
    const keys: string[] = [];
    (definition.actions || []).forEach((_a, i) => keys.push(actionKey('job', i)));
    (definition.steps || []).forEach((s) => (s.actions || []).forEach((_a, i) => keys.push(actionKey(s.id, i))));
    return keys;
}

/** Action state by node key. Several rows can reach one node (re-runs): the newest wins. */
export function actionStates(definition: JobDefinition, rows: ActionRun[]): Record<string, ActionState> {
    const keys = keysByIndex(definition);
    const out: Record<string, ActionState> = {};
    const stamp: Record<string, number> = {};
    rows.forEach((row, pos) => {
        if (row.kind === 'fallback' || !Array.isArray(row.actions)) {
            return;
        }
        const at = typeof row.created_at === 'number' ? row.created_at : 0;
        (row.actions as Entry[]).forEach((e) => {
            const key = typeof e.index === 'number' ? keys[e.index] : undefined;
            if (!key) {
                return;
            }
            const when = at * 1e6 + pos; // created_at first, list position breaks ties
            if (key in stamp && stamp[key] > when) {
                return;
            }
            stamp[key] = when;
            out[key] = { state: String(e.state || 'pending'), attempts: e.attempts, error: e.error || undefined };
        });
    });
    return out;
}

/** The plain-text status shown on an action node. */
export function actionStatusText(s: ActionState): string {
    if (s.state === 'done') {
        return 'Sent';
    }
    if (s.state === 'failed') {
        return 'Failed';
    }
    return (s.attempts || 0) > 0 ? 'Retrying' : 'Not sent yet';
}


/** The icon beside an action node's status, the same as for step states: sent is succeeded,
 * retrying is delayed (a clock), not sent yet is waiting. */
export function actionStatusIcon(s: ActionState): ReturnType<typeof statusIcon> {
    if (s.state === 'done') {
        return statusIcon('succeeded');
    }
    if (s.state === 'failed') {
        return statusIcon('failed');
    }
    return (s.attempts || 0) > 0 ? statusIcon('waiting', true) : statusIcon('waiting');
}
