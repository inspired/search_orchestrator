import type { JobDefinition, StepStatus } from '../api/types';
import { buildGraph } from '../features/builder/nodeModel';
import { lineStates, looksWaiting, progress, rowLabels, waitingFor } from '../features/run/runFlow';

const def: JobDefinition = {
    name: 'j',
    enabled: true,
    triggers: [{ type: 'cron', cron: '* * * * *' }],
    actions: [{ hook: 'on_failure', type: 'email', to: 'a@b' }],
    steps: [
        { id: 'a', type: 'inline', spl: 'x' },
        { id: 'b', type: 'inline', spl: 'y', name: 'Weekly rollup' },
        { id: 'c', type: 'inline', spl: 'z' },
        { id: 'd', type: 'previous' },
        { id: 'e', type: 'inline', spl: 'w', name: 'E' },
    ],
    edges: [
        { from: 'a', to: 'b', condition: 'on_success' },
        { from: 'a', to: 'c', condition: 'on_failure' },
        { from: 'b', to: 'd', condition: 'always' },
        { from: 'a', to: 'e', condition: 'expression', expression: 'x > 1' },
    ],
} as JobDefinition;
const g = buildGraph(def);
const key = (from: string, to: string, port: string) => `step:${from}-${port}->step:${to}`;
const st = (state: StepStatus['state'], more: Partial<StepStatus> = {}): StepStatus => ({ state, ...more });

describe('lineStates', () => {
    test('pending while the source has not finished', () => {
        const out = lineStates(def, { a: st('running') }, g);
        expect(out[key('a', 'b', 'success')]).toBe('pending');
        expect(out[key('a', 'c', 'failure')]).toBe('pending');
    });
    test('success fires and flows into a running target; the failure line will not fire', () => {
        const out = lineStates(def, { a: st('succeeded'), b: st('running') }, g);
        expect(out[key('a', 'b', 'success')]).toBe('flowing');
        expect(out[key('a', 'c', 'failure')]).toBe('wont');
    });
    test('fired when the target has not started', () => {
        expect(lineStates(def, { a: st('succeeded'), b: st('ready') }, g)[key('a', 'b', 'success')]).toBe('fired');
    });
    test('after a failure the failure line fires and the success line will not', () => {
        const out = lineStates(def, { a: st('failed') }, g);
        expect(out[key('a', 'c', 'failure')]).toBe('fired');
        expect(out[key('a', 'b', 'success')]).toBe('wont');
    });
    test('always fires after a failure and after a skip', () => {
        expect(lineStates(def, { b: st('failed') }, g)[key('b', 'd', 'always')]).toBe('fired');
        expect(lineStates(def, { b: st('skipped', { skip_kind: 'not_taken' }) }, g)[key('b', 'd', 'always')]).toBe('fired');
    });
    test('a target skipped as not taken makes its lines wont', () => {
        const out = lineStates(def, { a: st('succeeded'), b: st('succeeded'), c: st('skipped', { skip_kind: 'not_taken' }) }, g);
        expect(out[key('a', 'c', 'failure')]).toBe('wont');
    });
    test('a run_when skip passes an on_success line, as the engine does', () => {
        const out = lineStates(def, { a: st('skipped', { skip_kind: 'run_when' }), b: st('ready') }, g);
        expect(out[key('a', 'b', 'success')]).toBe('fired');
    });
    test('a not_taken skip does not pass an on_success line', () => {
        const out = lineStates(def, { a: st('skipped', { skip_kind: 'not_taken' }) }, g);
        expect(out[key('a', 'b', 'success')]).toBe('wont');
    });
    test('condition lines follow the target', () => {
        const ck = 'cond:a>e';
        const pend = lineStates(def, { a: st('running') }, g);
        expect(pend[`step:a-if->${ck}`]).toBe('pending');
        const fired = lineStates(def, { a: st('succeeded'), e: st('running') }, g);
        expect(fired[`step:a-if->${ck}`]).toBe('flowing');
        expect(fired[`${ck}-then->step:e`]).toBe('flowing');
        const wont = lineStates(def, { a: st('succeeded'), e: st('skipped', { skip_kind: 'not_taken' }) }, g);
        expect(wont[`step:a-if->${ck}`]).toBe('wont');
        expect(wont[`${ck}-then->step:e`]).toBe('wont');
    });
    test('trigger lines fire once the run has started', () => {
        const tk = 'trigger:0->step:a';
        expect(lineStates(def, {}, g)[tk]).toBe('pending');
        expect(lineStates(def, { a: st('ready') }, g)[tk]).toBe('fired');
        expect(lineStates(def, { a: st('running') }, g)[tk]).toBe('flowing');
    });
    test('action lines fire when the action row exists, else follow the hook', () => {
        const ak = 'job-on_failure->action:job:0';
        const k = Object.keys(lineStates(def, {}, g)).find((x) => x.endsWith('->action:job:0')) as string;
        expect(ak && k).toBeTruthy();
        expect(lineStates(def, {}, g, { 'action:job:0': { state: 'done' } })[k]).toBe('fired');
        expect(lineStates(def, {}, g)[k]).toBe('pending');
    });
});

describe('progress', () => {
    test('succeeded, failed and skipped count as finished', () => {
        expect(progress(def, { a: st('succeeded'), b: st('failed'), c: st('skipped'), d: st('running') })).toEqual({ finished: 3, total: 5 });
    });
});

describe('waitingFor', () => {
    const d2 = {
        ...def,
        steps: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, type: 'inline', spl: 'x', name: id.toUpperCase() })),
        edges: ['a', 'b', 'c', 'd'].map((f) => ({ from: f, to: 'e', condition: 'always' })),
    } as JobDefinition;
    test('names unfinished upstream steps', () => {
        expect(waitingFor(def, { a: st('succeeded'), b: st('running'), d: st('waiting') }, 'd')).toBe('Waiting for Weekly rollup');
        expect(waitingFor(d2, { a: st('succeeded'), b: st('succeeded'), c: st('running'), d: st('running'), e: st('waiting') }, 'e')).toBe('Waiting for C and D');
        expect(waitingFor(d2, { a: st('running'), e: st('ready') }, 'e')).toBe('Waiting for A, B and 2 more');
    });
    test('null when not waiting or nothing is unfinished', () => {
        expect(waitingFor(def, { b: st('running'), d: st('running') }, 'd')).toBeNull();
        expect(waitingFor(def, { b: st('succeeded'), d: st('ready') }, 'd')).toBeNull();
    });
});

describe('rowLabels', () => {
    test('data links from finished steps with a result count', () => {
        const d3 = { ...def, steps: [{ id: 'a', type: 'inline', spl: 'x' }, { id: 'p', type: 'previous' }], edges: [{ from: 'a', to: 'p' }] } as JobDefinition;
        const gg = buildGraph(d3);
        const out = rowLabels(d3, { a: st('succeeded', { result_count: 1204 }) }, gg, 'en-US');
        expect(Object.values(out)).toEqual(['1,204 rows →']);
        expect(Object.values(rowLabels(d3, { a: st('succeeded', { result_count: 1 }) }, gg, 'en-US'))).toEqual(['1 row →']);
        expect(rowLabels(d3, { a: st('running', { result_count: 5 }) }, gg, 'en-US')).toEqual({});
        expect(rowLabels(d3, { a: st('succeeded') }, gg, 'en-US')).toEqual({});
    });
});

describe('a step awaiting approval', () => {
    const gated = {
        name: 'g',
        enabled: true,
        triggers: [{ type: 'cron', cron: '* * * * *' }],
        steps: [
            { id: 'a', type: 'inline', spl: 'x' },
            { id: 'gate', type: 'approval', approval: {} },
            { id: 'b', type: 'inline', spl: 'y' },
        ],
        edges: [
            { from: 'a', to: 'gate', condition: 'on_success' },
            { from: 'gate', to: 'b', condition: 'expression', expression: '$gate.first.by$ != ""' },
        ],
    } as JobDefinition;
    const gg = buildGraph(gated);

    test('looks like a waiting step', () => {
        expect(looksWaiting('awaiting_approval')).toBe(true);
        expect(looksWaiting('waiting')).toBe(true);
        expect(looksWaiting('running')).toBe(false);
        expect(looksWaiting('succeeded')).toBe(false);
    });

    test('the line into it is pending, never flowing', () => {
        const out = lineStates(gated, { a: st('succeeded'), gate: st('awaiting_approval') }, gg);
        expect(out[key('a', 'gate', 'success')]).toBe('pending');
        expect(Object.values(out)).not.toContain('flowing');
    });

    test('a trigger line into it is pending', () => {
        const solo = { ...gated, steps: [{ id: 'gate', type: 'approval' }], edges: [] } as JobDefinition;
        expect(lineStates(solo, { gate: st('awaiting_approval') }, buildGraph(solo))['trigger:0->step:gate']).toBe('pending');
    });
});
