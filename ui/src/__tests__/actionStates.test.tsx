import type { ActionRun, JobDefinition } from '../api/types';
import { statusIcon } from '../components/StatusText';
import { actionStates, actionStatusIcon, actionStatusText } from '../features/run/actionStates';

const def: JobDefinition = {
    name: 'j',
    enabled: true,
    triggers: [],
    actions: [{ hook: 'on_failure', type: 'email', to: 'a@b' }],
    steps: [
        { id: 'a', type: 'inline', spl: 'x', actions: [{ hook: 'on_success', type: 'email', to: 'a@b' }] },
        { id: 'b', type: 'inline', spl: 'y' },
    ],
    edges: [],
};
const row = (over: Record<string, unknown>): ActionRun => ({ run_id: 'r', ...over } as ActionRun);

describe('actionStates', () => {
    test('maps the global index to job and step action keys', () => {
        const out = actionStates(def, [
            row({ scope: 'job', hook: 'on_failure', actions: [{ index: 0, state: 'failed', attempts: 3, error: 'boom' }] }),
            row({ scope: 'step', step_id: 'a', hook: 'on_success', actions: [{ index: 1, state: 'done', attempts: 1 }] }),
        ]);
        expect(out['action:job:0']).toEqual({ state: 'failed', attempts: 3, error: 'boom' });
        expect(out['action:a:0'].state).toBe('done');
    });
    test('the newest occurrence wins', () => {
        const out = actionStates(def, [
            row({ created_at: 200, actions: [{ index: 1, state: 'done', attempts: 1 }] }),
            row({ created_at: 100, actions: [{ index: 1, state: 'failed', attempts: 3 }] }),
        ]);
        expect(out['action:a:0'].state).toBe('done');
    });
    test('skips fallback rows and names the states', () => {
        expect(actionStates(def, [row({ kind: 'fallback', actions: [{ index: 0, state: 'done' }] })])).toEqual({});
        expect(actionStatusText({ state: 'pending', attempts: 2 })).toBe('Retrying');
        expect(actionStatusText({ state: 'pending', attempts: 0 })).toBe('Not sent yet');
    });
});

describe('actionStatusIcon', () => {
    test('uses the step state icons: sent, failed, retrying (clock), not sent yet (waiting)', () => {
        expect(actionStatusIcon({ state: 'done' })).toBe(statusIcon('succeeded'));
        expect(actionStatusIcon({ state: 'failed' })).toBe(statusIcon('failed'));
        expect(actionStatusIcon({ state: 'pending', attempts: 2 })).toBe(statusIcon('waiting', true));
        expect(actionStatusIcon({ state: 'pending' })).toBe(statusIcon('waiting'));
    });
});

import { actionLiveText } from '../features/run/actionStates';

describe('actionLiveText', () => {
    test('done, failed, retry countdown, sending and not sent', () => {
        expect(actionLiveText({ state: 'done' }, 100)).toBe('Sent');
        expect(actionLiveText({ state: 'failed' }, 100)).toBe('Failed');
        expect(actionLiveText({ state: 'pending', attempts: 1, next_at: 129.2 }, 100)).toBe('Retrying in 30 s');
        expect(actionLiveText({ state: 'pending', attempts: 1, next_at: 90 }, 100)).toBe('Sending…');
        expect(actionLiveText({ state: 'pending', attempts: 0, next_at: 0 }, 100)).toBe('Not sent yet');
    });
});
