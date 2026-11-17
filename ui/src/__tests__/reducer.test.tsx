import { toDefinition } from '../api/client';
import { buildGraph } from '../features/builder/nodeModel';
import { addNodeKey, blankJob, initialState, isDirty, keyAfterConnect, reducer } from '../features/builder/reducer';
import type { JobDefinition } from '../api/types';

const job: JobDefinition = {
    name: 'Rollups',
    enabled: true,
    steps: [
        { id: 'daily', type: 'inline', spl: '| makeresults' },
        { id: 'weekly', type: 'inline', spl: '| loadjob $daily.sid$' },
        { id: 'monthly', type: 'inline', spl: '| loadjob $weekly.sid$' },
    ],
    edges: [
        { from: 'daily', to: 'weekly', condition: 'on_success' },
        { from: 'weekly', to: 'monthly', condition: 'on_success' },
    ],
};

describe('builder reducer', () => {
    test('removeStep removes its edges', () => {
        const s = reducer(initialState(job), { type: 'removeStep', id: 'weekly' });
        expect(s.job.steps.map((x) => x.id)).toEqual(['daily', 'monthly']);
        expect(s.job.edges).toEqual([]);
    });

    test('undo restores', () => {
        let s = initialState(job);
        s = reducer(s, { type: 'removeStep', id: 'weekly' });
        s = reducer(s, { type: 'undo' });
        expect(s.job).toEqual(job);
        s = reducer(s, { type: 'redo' });
        expect(s.job.steps).toHaveLength(2);
    });

    test('connect refuses an edge that would make a cycle', () => {
        const s0 = initialState(job);
        const s = reducer(s0, { type: 'connect', from: 'monthly', to: 'daily' });
        expect(s).toBe(s0);
    });

    test('renaming a step id renames its edges', () => {
        const s = reducer(initialState(job), { type: 'updateStep', id: 'weekly', changes: { id: 'week' } });
        expect(s.job.edges).toEqual([
            { from: 'daily', to: 'week', condition: 'on_success' },
            { from: 'week', to: 'monthly', condition: 'on_success' },
        ]);
    });

    test('renaming a step rewrites its tokens and leaves literal $ alone', () => {
        const withTokens: JobDefinition = {
            name: 'Rollups',
            enabled: true,
            steps: [
                { id: 'daily', type: 'inline', spl: '| makeresults' },
                {
                    id: 'weekly',
                    type: 'inline',
                    spl: '| loadjob $daily.sid$ | where n=$daily.first.n|0$ | rex "foo$" | eval x="$daily$ $dailyx.sid$ $unknown$"',
                    run_when: { kind: 'expression', value: '$daily.resultCount$ > 0' },
                    actions: [{ hook: 'on_failure', type: 'email', to: 'a@b.c', subject: 'rows $daily.resultCount$', params: { p: '$daily.status$' } }],
                },
            ],
            edges: [{ from: 'daily', to: 'weekly', condition: 'expression', expression: '$daily.status$ == "succeeded"' }],
            actions: [{ hook: 'on_success', type: 'event', index: 'main', payload: '$daily.sid$ costs $5' }],
        };
        const s = reducer(initialState(withTokens), { type: 'updateStep', id: 'daily', changes: { id: 'day' } });
        const weekly = s.job.steps[1];
        expect(weekly.spl).toBe('| loadjob $day.sid$ | where n=$day.first.n|0$ | rex "foo$" | eval x="$daily$ $dailyx.sid$ $unknown$"');
        expect(weekly.run_when).toEqual({ kind: 'expression', value: '$day.resultCount$ > 0' });
        expect(weekly.actions?.[0].subject).toBe('rows $day.resultCount$');
        expect(weekly.actions?.[0].params).toEqual({ p: '$day.status$' });
        expect(s.job.edges?.[0].expression).toBe('$day.status$ == "succeeded"');
        expect(s.job.actions?.[0].payload).toBe('$day.sid$ costs $5');
    });

    test('undo history is capped at 100 steps', () => {
        let s = initialState(job);
        for (let i = 0; i < 120; i += 1) {
            s = reducer(s, { type: 'addStep' });
        }
        expect(s.past).toHaveLength(100);
        for (let i = 0; i < 150; i += 1) {
            s = reducer(s, { type: 'undo' });
        }
        expect(s.job.steps).toHaveLength(3 + 20);
    });

    test('switching previous → inline writes loadjob tokens in edge order', () => {
        const prev: JobDefinition = {
            name: 'P',
            enabled: true,
            steps: [
                { id: 'a', type: 'inline', spl: '| makeresults' },
                { id: 'b', type: 'inline', spl: '| makeresults' },
                { id: 'p', name: 'Combined', type: 'previous', spl: '| stats count', retries: 1 },
            ],
            edges: [
                { from: 'b', to: 'p', condition: 'on_success' },
                { from: 'a', to: 'p', condition: 'on_success' },
            ],
        };
        const s = reducer(initialState(prev), { type: 'updateStep', id: 'p', changes: { type: 'inline' } });
        expect(s.job.steps[2]).toEqual({
            id: 'p',
            name: 'Combined',
            type: 'inline',
            spl: '| loadjob $b.sid$ | append [| loadjob $a.sid$] | stats count',
            retries: 1,
        });
        expect(s.job.edges).toEqual(prev.edges);
        // Undo is one step.
        expect(reducer(s, { type: 'undo' }).job).toEqual(prev);
    });

    test('switching inline → previous keeps the search', () => {
        const s = reducer(initialState(job), { type: 'updateStep', id: 'weekly', changes: { type: 'previous' } });
        expect(s.job.steps[1]).toEqual({ id: 'weekly', type: 'previous', spl: '| loadjob $daily.sid$' });
    });

    test('switching to previous drops the time range', () => {
        const timed: JobDefinition = {
            name: 'T',
            enabled: true,
            steps: [{ id: 'w', type: 'inline', spl: '| stats count', earliest: '-7d', latest: 'now', retries: 2 }],
            edges: [],
        };
        const s = reducer(initialState(timed), { type: 'updateStep', id: 'w', changes: { type: 'previous' } });
        expect(s.job.steps[0]).toEqual({ id: 'w', type: 'previous', spl: '| stats count', retries: 2 });
    });

    test('switching previous → inline with no dependencies keeps the search', () => {
        const lone: JobDefinition = { name: 'L', enabled: true, steps: [{ id: 'p', type: 'previous', spl: '| stats count' }], edges: [] };
        const s = reducer(initialState(lone), { type: 'updateStep', id: 'p', changes: { type: 'inline' } });
        expect(s.job.steps[0]).toEqual({ id: 'p', type: 'inline', spl: '| stats count' });
    });
});

describe('applyTemplate', () => {
    it('replaces the job as one undo step', () => {
        const blank = initialState({ name: '', enabled: true, steps: [], edges: [] });
        const next = reducer(blank, { type: 'applyTemplate', job });
        expect(next.job).toBe(job);
        expect(next.past).toHaveLength(1);
        expect(reducer(next, { type: 'undo' }).job.steps).toEqual([]);
    });
});

describe('unsaved changes', () => {
    const loaded = () => reducer(initialState(blankJob()), { type: 'load', job });

    test('a loaded job is clean', () => {
        expect(isDirty(loaded())).toBe(false);
    });

    test('an edit makes it dirty and undoing back makes it clean again', () => {
        let s = reducer(loaded(), { type: 'setJobField', field: 'name', value: 'Other' });
        expect(isDirty(s)).toBe(true);
        s = reducer(s, { type: 'undo' });
        expect(isDirty(s)).toBe(false);
        s = reducer(s, { type: 'redo' });
        expect(isDirty(s)).toBe(true);
    });

    test('saved marks the current job clean and keeps the history', () => {
        let s = reducer(loaded(), { type: 'setJobField', field: 'name', value: 'Other' });
        s = reducer(s, { type: 'saved', job: s.job });
        expect(isDirty(s)).toBe(false);
        expect(s.past).toHaveLength(1);
        expect(s.job.name).toBe('Other');
    });

    test('server-only fields do not count as a change', () => {
        const s = reducer(loaded(), { type: 'saved', job: { ...job, owner: 'alice' } as JobDefinition });
        expect(isDirty(s)).toBe(false);
    });

    test('a template applied to a new job is unsaved', () => {
        const s = reducer(initialState(blankJob()), { type: 'applyTemplate', job });
        expect(isDirty(s)).toBe(true);
    });

    test('a template preload is unsaved when the saved job is blank', () => {
        expect(isDirty(initialState(job, blankJob()))).toBe(true);
        expect(isDirty(initialState(job))).toBe(false);
    });
});

describe('builder reducer: layout and node edits', () => {
    const laid = (): JobDefinition => ({
        name: 'L',
        enabled: true,
        steps: [
            { id: 'a', type: 'inline', spl: 'x', actions: [{ hook: 'on_failure', type: 'email', to: 'x', subject: 's' }] },
            { id: 'c', type: 'inline', spl: 'y' },
        ],
        edges: [{ from: 'a', to: 'c', condition: 'expression', expression: '1=1' }],
        actions: [
            { hook: 'on_success', type: 'email', to: 'p' },
            { hook: 'on_success', type: 'email', to: 'q' },
        ],
        triggers: [{ type: 'cron', cron: '* * * * *' }, { type: 'cron', cron: '0 * * * *' }],
        layout: {
            nodes: {
                'step:a': { x: 1, y: 1 },
                'step:c': { x: 2, y: 2 },
                'action:a:0': { x: 3, y: 3 },
                'cond:a>c': { x: 4, y: 4 },
                'action:job:0': { x: 5, y: 5 },
                'action:job:1': { x: 6, y: 6 },
                'trigger:0': { x: 7, y: 7 },
                'trigger:1': { x: 8, y: 8 },
            },
        },
    });

    test('an old job has no layout and is not dirty', () => {
        const s = initialState(job);
        expect(isDirty(s)).toBe(false);
        expect('layout' in toDefinition(s.job)).toBe(false);
    });

    test('moveNodes undoes exactly; tidyLayout removes layout', () => {
        const s0 = initialState(laid());
        const s1 = reducer(s0, { type: 'moveNodes', positions: { 'step:a': { x: 9, y: 9 } } });
        expect(s1.job.layout?.nodes['step:a']).toEqual({ x: 9, y: 9 });
        expect(reducer(s1, { type: 'undo' }).job).toEqual(s0.job);
        const s2 = reducer(s1, { type: 'moveNodes', positions: { 'step:c': { x: 0, y: 0 } } });
        expect(reducer(s2, { type: 'undo' }).job.layout?.nodes['step:c']).toEqual({ x: 2, y: 2 });
        const t = reducer(s0, { type: 'tidyLayout' });
        expect('layout' in t.job).toBe(false);
        expect(reducer(t, { type: 'undo' }).job).toEqual(s0.job);
    });

    test('removeStep drops its keys and one undo restores', () => {
        const s0 = initialState(laid());
        const s1 = reducer(s0, { type: 'removeStep', id: 'a' });
        const keys = Object.keys(s1.job.layout?.nodes || {});
        expect(keys.filter((k) => /^(step:a|action:a:|cond:a>)/.test(k))).toEqual([]);
        expect(reducer(s1, { type: 'undo' }).job).toEqual(s0.job);
    });

    test('renaming a step moves its keys', () => {
        const s = reducer(initialState(laid()), { type: 'updateStep', id: 'a', changes: { id: 'load' } });
        const n = s.job.layout?.nodes || {};
        expect(n['step:load']).toEqual({ x: 1, y: 1 });
        expect(n['action:load:0']).toEqual({ x: 3, y: 3 });
        expect(n['cond:load>c']).toEqual({ x: 4, y: 4 });
        expect(n['step:a']).toBeUndefined();
    });

    test('moveAction to the job moves the action and its position', () => {
        const s = reducer(initialState(laid()), { type: 'moveAction', scope: 'a', index: 0, toScope: 'job', hook: 'on_complete' });
        expect(s.job.actions?.[2]).toEqual({ hook: 'on_complete', type: 'email', to: 'x', subject: 's' });
        expect(s.job.steps[0].actions).toEqual([]);
        expect(s.job.layout?.nodes['action:a:0']).toBeUndefined();
        expect(s.job.layout?.nodes['action:job:2']).toEqual({ x: 3, y: 3 });
    });

    test('moveAction in the same scope only changes the hook', () => {
        const s = reducer(initialState(laid()), { type: 'moveAction', scope: 'job', index: 0, toScope: 'job', hook: 'on_failure' });
        expect(s.job.actions?.[0].hook).toBe('on_failure');
        expect(s.job.layout?.nodes['action:job:0']).toEqual({ x: 5, y: 5 });
    });

    test('updateAction with a field set to undefined deletes that field', () => {
        const s = reducer(initialState(laid()), { type: 'updateAction', scope: 'a', index: 0, changes: { subject: undefined, to: 'y' } });
        const a = s.job.steps[0].actions?.[0] as Record<string, unknown>;
        expect(a).toEqual({ hook: 'on_failure', type: 'email', to: 'y' });
        expect('subject' in a).toBe(false);
    });

    test('removeAction and removeTrigger shift later keys', () => {
        const s = reducer(initialState(laid()), { type: 'removeAction', scope: 'job', index: 0 });
        expect(s.job.layout?.nodes['action:job:0']).toEqual({ x: 6, y: 6 });
        expect(s.job.layout?.nodes['action:job:1']).toBeUndefined();
        const t = reducer(initialState(laid()), { type: 'removeTrigger', index: 0 });
        expect(t.job.layout?.nodes['trigger:0']).toEqual({ x: 8, y: 8 });
        expect(t.job.layout?.nodes['trigger:1']).toBeUndefined();
    });

    test('disconnecting an expression edge drops its cond key; empty layout is deleted', () => {
        const j: JobDefinition = { ...laid(), layout: { nodes: { 'cond:a>c': { x: 1, y: 1 } } } };
        const s = reducer(initialState(j), { type: 'disconnect', from: 'a', to: 'c' });
        expect('layout' in s.job).toBe(false);
    });

    test('addNode email from a failure port, with position, and addNodeKey agrees', () => {
        const s0 = initialState(laid());
        const from = { key: 'step:a', port: 'failure' as const };
        const key = addNodeKey(s0.job, 'email', from);
        const s = reducer(s0, { type: 'addNode', kind: 'email', at: { x: 5, y: 6 }, from });
        expect(s.job.steps[0].actions?.[1]).toEqual({ hook: 'on_failure', type: 'email', to: '' });
        expect(key).toBe('action:a:1');
        expect(s.job.layout?.nodes[key]).toEqual({ x: 5, y: 6 });
        expect(reducer(s, { type: 'undo' }).job).toEqual(s0.job);
    });

    test('addNode at a point also saves the shown positions; without a point it saves none', () => {
        const s0 = initialState(job);
        const shown = { 'step:daily': { x: 1, y: 2 }, 'step:weekly': { x: 3, y: 4 } };
        const s = reducer(s0, { type: 'addNode', kind: 'email', at: { x: 5, y: 6 }, shown });
        expect(s.job.layout?.nodes).toEqual({ ...shown, 'action:job:0': { x: 5, y: 6 } });
        expect(reducer(s, { type: 'undo' }).job).toEqual(s0.job);
        expect('layout' in reducer(s0, { type: 'addNode', kind: 'email', shown }).job).toBe(false);
    });

    test('keyAfterConnect follows an action moved by a line, and the actions after it', () => {
        const j: JobDefinition = {
            ...job,
            actions: [
                { hook: 'on_failure', type: 'email', to: 'a@x.com' },
                { hook: 'on_failure', type: 'email', to: 'b@x.com' },
            ],
        };
        const line = { from: 'step:daily', port: 'failure' as const, to: 'action:job:0' };
        expect(keyAfterConnect(j, line, 'action:job:0')).toBe('action:daily:0');
        expect(keyAfterConnect(j, line, 'action:job:1')).toBe('action:job:0');
        expect(keyAfterConnect(j, line, 'step:daily')).toBe('step:daily');
        // Same scope, other outcome: keys stay.
        expect(keyAfterConnect(j, { from: 'job', port: 'success', to: 'action:job:0' }, 'action:job:0')).toBe('action:job:0');
    });

    test('addNode defaults: slack, trigger, step key', () => {
        const s0 = initialState(job);
        const sl = reducer(s0, { type: 'addNode', kind: 'slack' });
        expect(sl.job.actions?.[0]).toEqual({ hook: 'on_failure', type: 'webhook', preset: 'slack', destination: '' });
        const st = reducer(s0, { type: 'addNode', kind: 'start_job' });
        expect(st.job.actions?.[0].hook).toBe('on_success');
        const tr = reducer(s0, { type: 'addNode', kind: 'trigger_cron' });
        expect(tr.job.triggers).toEqual([{ type: 'cron', cron: '0 6 * * *', enabled: true }]);
        expect(addNodeKey(s0.job, 'search')).toBe('step:step_4');
        expect('layout' in sl.job).toBe(false);
    });

    test('addNode summary_index and lookup create output steps, ids and keys agree', () => {
        const s0 = initialState(laid());
        const from = { key: 'step:a', port: 'success' as const };
        const key = addNodeKey(s0.job, 'summary_index', from);
        expect(key).toBe('step:summary');
        const s1 = reducer(s0, { type: 'addNode', kind: 'summary_index', from });
        const step = s1.job.steps.find((x) => x.id === 'summary');
        expect(step).toEqual({
            id: 'summary',
            name: '',
            type: 'previous',
            spl: '| collect index= marker="so_run=$run.id$"',
            output: { kind: 'summary_index', index: '', add_run_id: true },
        });
        expect(s1.job.edges).toContainEqual({ from: 'a', to: 'summary', condition: 'on_success' });
        expect(addNodeKey(s1.job, 'summary_index')).toBe('step:summary_2');
        const s2 = reducer(s1, { type: 'addNode', kind: 'lookup', at: { x: 1, y: 2 } });
        expect(s2.job.steps.find((x) => x.id === 'lookup')).toMatchObject({ type: 'previous', spl: '| outputlookup', output: { kind: 'lookup', name: '' } });
        expect(s2.job.layout?.nodes['step:lookup']).toEqual({ x: 1, y: 2 });
        expect(addNodeKey(s2.job, 'lookup')).toBe('step:lookup_2');
    });

    test('updateStep with output undefined drops the key', () => {
        const s1 = reducer(initialState(laid()), { type: 'addNode', kind: 'lookup' });
        const s2 = reducer(s1, { type: 'updateStep', id: 'lookup', changes: { output: undefined } });
        expect('output' in s2.job.steps.find((x) => x.id === 'lookup')!).toBe(false);
    });

    test('addNode search from the if port adds an expression edge', () => {
        const s = reducer(initialState(laid()), { type: 'addNode', kind: 'search', from: { key: 'step:a', port: 'if' } });
        expect(s.job.edges?.[1]).toEqual({ from: 'a', to: 'step_3', condition: 'expression', expression: '' });
    });

    test('connectPort that canConnect rejects returns the same state', () => {
        const s0 = initialState(laid());
        expect(reducer(s0, { type: 'connectPort', from: 'step:c', port: 'success', to: 'step:c' })).toBe(s0);
    });

    test('connectPort adds an edge and rehooks an action', () => {
        const j = laid();
        j.edges = [];
        const s = reducer(initialState(j), { type: 'connectPort', from: 'step:a', port: 'success', to: 'step:c' });
        expect(s.job.edges).toEqual([{ from: 'a', to: 'c', condition: 'on_success' }]);
        const r = reducer(initialState(j), { type: 'connectPort', from: 'step:c', port: 'always', to: 'action:job:0' });
        expect(r.job.steps[1].actions?.[0]).toMatchObject({ hook: 'on_complete', to: 'p' });
        expect(r.job.layout?.nodes['action:c:0']).toEqual({ x: 5, y: 5 });
    });
});

describe('changeOutcome', () => {
    const j: JobDefinition = {
        ...blankJob(),
        name: 'j',
        steps: [
            { id: 'a', type: 'inline', spl: 'x', actions: [{ hook: 'on_success', type: 'email', to: 'x@y' }] },
            { id: 'b', type: 'inline', spl: 'y' },
            { id: 'c', type: 'inline', spl: 'z' },
        ],
        edges: [
            { from: 'a', to: 'b', condition: 'on_success' },
            { from: 'a', to: 'c', condition: 'expression', expression: '1=1' },
        ],
        layout: { nodes: { 'step:a': { x: 0, y: 0 }, 'cond:a>c': { x: 5, y: 5 } } },
    };
    const link = (from: string, to: string) => buildGraph(j).links.find((l) => l.from === from && l.to === to)!.key;

    it('sets a condition on an edge', () => {
        const s = reducer(initialState(j), { type: 'changeOutcome', link: link('step:a', 'step:b'), outcome: 'failure' });
        expect(s.job.edges![0]).toEqual({ from: 'a', to: 'b', condition: 'on_failure' });
    });
    it('moves an action to another hook', () => {
        const s = reducer(initialState(j), { type: 'changeOutcome', link: link('step:a', 'action:a:0'), outcome: 'always' });
        expect(s.job.steps[0].actions![0].hook).toBe('on_complete');
    });
    it('turns a condition leg into a plain edge', () => {
        const s = reducer(initialState(j), { type: 'changeOutcome', link: link('step:a', 'cond:a>c'), outcome: 'success' });
        expect(s.job.edges![1]).toEqual({ from: 'a', to: 'c', condition: 'on_success' });
        expect(s.job.layout?.nodes['cond:a>c']).toBeUndefined();
    });
    it('is a no-op for if on a condition leg and for the same outcome', () => {
        const st = initialState(j);
        expect(reducer(st, { type: 'changeOutcome', link: link('step:a', 'cond:a>c'), outcome: 'if' })).toBe(st);
        expect(reducer(st, { type: 'changeOutcome', link: link('step:a', 'step:b'), outcome: 'success' })).toBe(st);
    });
    it('if on an edge writes an empty expression', () => {
        const s = reducer(initialState(j), { type: 'changeOutcome', link: link('step:a', 'step:b'), outcome: 'if' });
        expect(s.job.edges![0]).toEqual({ from: 'a', to: 'b', condition: 'expression', expression: '' });
    });
});

describe('addNode rightOf', () => {
    it('places the node right of its source and keeps others put', () => {
        const j2: JobDefinition = { ...blankJob(), name: 'j', steps: [{ id: 'a', type: 'inline', spl: 'x' }] };
        const s = reducer(initialState(j2), {
            type: 'addNode', kind: 'search', rightOf: 'step:a', from: { key: 'step:a', port: 'success' },
            shown: { 'step:a': { x: 100, y: 50 } },
        });
        expect(s.job.layout?.nodes['step:step_2']).toEqual({ x: 360, y: 50 });
        expect(s.job.layout?.nodes['step:a']).toEqual({ x: 100, y: 50 });
    });

    test('addNode right of a node uses compact sizes when asked', () => {
        const s0 = initialState(job);
        const shown = { 'step:daily': { x: 0, y: 0 }, 'step:weekly': { x: 260, y: 60 }, 'step:monthly': { x: 520, y: 0 } };
        const spot = (compact: boolean) =>
            reducer(s0, { type: 'addNode', kind: 'search', rightOf: 'step:daily', shown, compact }).job.layout?.nodes['step:s1'] ||
            Object.entries(reducer(s0, { type: 'addNode', kind: 'search', rightOf: 'step:daily', shown, compact }).job.layout?.nodes || {}).find(([k]) => !shown[k as keyof typeof shown])?.[1];
        expect(spot(true)).toEqual({ x: 260, y: 0 });
        expect(spot(false)?.y).toBeGreaterThan(60);
    });
});
