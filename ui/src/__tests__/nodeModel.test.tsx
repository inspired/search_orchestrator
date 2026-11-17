import type { JobDefinition } from '../api/types';
import {
    EDGE_CONDITION_FOR_PORT, HOOK_FOR_PORT, buildGraph, canConnect, nodeKindOfAction, nodeKindOfStep, outputPorts, portForHook,
} from '../features/builder/nodeModel';
import { searchCatalog, targetKinds } from '../features/builder/nodeCatalog';
import { FAMILY_OF, FAMILY_STYLE, PORT_STYLE, nodeSize, shapePath } from '../features/builder/nodeStyle';
import { addNodeKey, initialState, reducer } from '../features/builder/reducer';

const job: JobDefinition = {
    name: 'nightly',
    enabled: true,
    triggers: [{ type: 'cron', cron: '0 2 * * *' }],
    steps: [
        { id: 'a', type: 'inline', spl: 'search x', actions: [{ hook: 'on_failure', type: 'email', to: 'x@y' }] },
        { id: 'b', type: 'previous', spl: '| head 1' },
        { id: 'c', type: 'saved_search', saved_search_ref: 's' },
    ],
    edges: [
        { from: 'a', to: 'b', condition: 'on_success' },
        { from: 'a', to: 'c', condition: 'expression', expression: '$a.resultCount$ > 0' },
    ],
    actions: [{ hook: 'on_failure', type: 'webhook', destination: 'ops', preset: 'slack' }],
};

describe('buildGraph', () => {
    const g = buildGraph(job);
    it('orders node keys', () => {
        expect(g.nodes.map((n) => n.key)).toEqual(['trigger:0', 'job', 'step:a', 'step:b', 'step:c', 'cond:a>c', 'action:job:0', 'action:a:0']);
    });
    it('derives links', () => {
        const has = (from: string, port: string | null, to: string, kind: string, data: boolean) =>
            g.links.some((l) => l.from === from && l.port === port && l.to === to && l.kind === kind && l.data === data);
        expect(has('trigger:0', null, 'step:a', 'trigger', false)).toBe(true);
        expect(g.links.filter((l) => l.kind === 'trigger')).toHaveLength(1);
        expect(has('step:a', 'success', 'step:b', 'edge', true)).toBe(true);
        expect(has('step:a', 'if', 'cond:a>c', 'condition', false)).toBe(true);
        expect(has('cond:a>c', 'then', 'step:c', 'condition', false)).toBe(true);
        expect(has('job', 'failure', 'action:job:0', 'action', false)).toBe(true);
        expect(has('step:a', 'failure', 'action:a:0', 'action', false)).toBe(true);
    });
    it('labels nodes', () => {
        expect(nodeKindOfAction(job.actions![0])).toBe('slack');
        expect(nodeKindOfAction(job.steps[0].actions![0])).toBe('email');
        expect(g.nodes[0].label).toBe('Schedule');
        expect(g.nodes[1].label).toBe('Whole job');
    });
    it('copes with a bare job and dangling links', () => {
        const bare = buildGraph({ name: 'x', enabled: true, steps: [{ id: 'a', type: 'inline' }], edges: [{ from: 'a', to: 'zz' }] });
        expect(bare.nodes.map((n) => n.key)).toEqual(['job', 'step:a']);
        expect(bare.links).toEqual([]);
    });
});

describe('ports', () => {
    it('lists output ports', () => {
        expect(outputPorts('search')).toEqual(['success', 'failure', 'always', 'start', 'delayed', 'if']);
        expect(outputPorts('job')).toEqual(['success', 'failure', 'always', 'start', 'delayed', 'late']);
        expect(outputPorts('condition')).toEqual(['then']);
        expect(outputPorts('trigger_cron')).toEqual([]);
        expect(outputPorts('email')).toEqual([]);
    });
    it('maps ports', () => {
        expect(HOOK_FOR_PORT).toEqual({ success: 'on_success', failure: 'on_failure', always: 'on_complete', start: 'on_start', delayed: 'on_delayed', late: 'on_late', approval: 'on_approval_requested', if: null, then: null });
        expect(EDGE_CONDITION_FOR_PORT).toEqual({ success: 'on_success', failure: 'on_failure', always: 'always', start: null, delayed: null, late: null, approval: null, if: 'expression', then: null });
    });
});

describe('canConnect', () => {
    it('allows and rejects', () => {
        expect(canConnect(job, 'step:b', 'success', 'step:c')).toEqual({ ok: true });
        const start = canConnect(job, 'step:a', 'start', 'step:b');
        expect(start).toEqual({ ok: false, reason: 'Starts and Is delayed lines can only go to an action' });
        // The outcome words match the + handle's.
        expect(canConnect(job, 'step:a', 'if', 'action:job:0')).toEqual({ ok: false, reason: 'Only Succeeds, Fails, Finishes either way, Starts and Is delayed lines can go to an action' });
        expect(JSON.stringify(canConnect(job, 'step:a', 'success', 'step:a'))).toContain('loop');
        expect(JSON.stringify(canConnect(job, 'step:b', 'success', 'step:a'))).toContain('loop');
        expect(canConnect(job, 'step:a', 'success', 'action:job:0')).toEqual({ ok: true });
        expect(canConnect(job, 'trigger:0', 'success', 'step:a').ok).toBe(false);
        expect(canConnect(job, 'job', 'if', 'step:a').ok).toBe(false);
        expect(canConnect(job, 'step:a', 'success', 'job').ok).toBe(false);
        expect(canConnect(job, 'step:a', 'success', 'trigger:0').ok).toBe(false);
        expect(canConnect(job, 'cond:a>c', 'then', 'step:b')).toEqual({ ok: true });
    });
});

describe('readable details', () => {
    const detailOf = (j: Partial<JobDefinition>, key: string) =>
        buildGraph({ name: 'x', enabled: true, steps: [], ...j }).nodes.find((n) => n.key === key)!.detail;
    it('labels step types', () => {
        const steps: JobDefinition['steps'] = [
            { id: 'a', type: 'inline' },
            { id: 'b', type: 'saved_search', saved_search_ref: 'ref1' },
            { id: 'c', type: 'saved_search' },
            { id: 'd', type: 'previous' },
            { id: 'e', type: 'previous', output: { kind: 'summary_index', index: 'si' } },
            { id: 'f', type: 'inline', output: { kind: 'lookup', name: 'lk' } },
        ];
        const d = (id: string) => detailOf({ steps }, `step:${id}`);
        expect(d('a')).toBe('Search');
        expect(d('b')).toBe('Saved search: ref1');
        expect(d('c')).toBe('Saved search');
        expect(d('d')).toBe('Results of earlier steps');
        expect(d('e')).toBe('Summary index: si');
        expect(d('f')).toBe('Lookup: lk');
    });
    it('words completion triggers', () => {
        const t = (tr: object) => detailOf({ triggers: [tr as never] }, 'trigger:0');
        expect(t({ type: 'completion', job: 'up', on: 'success' })).toBe('When up succeeds');
        expect(t({ type: 'completion', job: 'up', on: 'complete' })).toBe('When up finishes');
        expect(t({ type: 'completion', job: '', on: 'success' })).toBe('Pick a job');
    });
});

describe('channel nodes', () => {
    it('maps the Teams, PagerDuty and ServiceNow presets to their own kinds and labels', () => {
        expect(nodeKindOfAction({ hook: 'on_failure', type: 'webhook', preset: 'pagerduty' })).toBe('pagerduty');
        expect(nodeKindOfAction({ hook: 'on_failure', type: 'webhook', preset: 'teams' })).toBe('teams');
        expect(nodeKindOfAction({ hook: 'on_failure', type: 'webhook', preset: 'servicenow' })).toBe('servicenow');
        expect(nodeKindOfAction({ hook: 'on_failure', type: 'webhook', preset: 'generic' })).toBe('webhook');
        const g = buildGraph({
            name: 'x',
            enabled: true,
            steps: [],
            actions: [
                { hook: 'on_failure', type: 'webhook', preset: 'teams', destination: 'ops-teams' },
                { hook: 'on_failure', type: 'webhook', preset: 'pagerduty', destination: 'pd' },
                { hook: 'on_failure', type: 'webhook', preset: 'servicenow', destination: 'snow' },
            ],
        });
        const actions = g.nodes.filter((n) => n.action);
        expect(actions.map((n) => [n.label, n.detail])).toEqual([
            ['Microsoft Teams', 'ops-teams'],
            ['PagerDuty', 'pd'],
            ['ServiceNow', 'snow'],
        ]);
        actions.forEach((n) => expect(FAMILY_OF[n.kind]).toBe('notify'));
    });

    it('adding a ServiceNow node from a step’s ✗ Fails makes a bare webhook action without options', () => {
        const s0 = initialState(job);
        const from = { key: 'step:a', port: 'failure' as const };
        expect(addNodeKey(s0.job, 'servicenow', from)).toBe('action:a:1');
        const s = reducer(s0, { type: 'addNode', kind: 'servicenow', from });
        expect(s.job.steps[0].actions?.[1]).toEqual({ type: 'webhook', preset: 'servicenow', hook: 'on_failure', destination: '' });
        const pd = reducer(s0, { type: 'addNode', kind: 'pagerduty' });
        expect(pd.job.actions?.[1]).toEqual({ type: 'webhook', preset: 'pagerduty', hook: 'on_failure', destination: '' });
        const teams = reducer(s0, { type: 'addNode', kind: 'teams' });
        expect(teams.job.actions?.[1]).toEqual({ type: 'webhook', preset: 'teams', hook: 'on_failure', destination: '' });
    });
});

describe('approval nodes', () => {
    const gated: JobDefinition = {
        name: 'gated',
        enabled: true,
        steps: [
            { id: 'a', type: 'inline', spl: 'search x' },
            {
                id: 'gate',
                name: 'Sign-off',
                type: 'approval',
                approval: { message: 'ok?' },
                actions: [{ hook: 'on_approval_requested', type: 'email', to: 'ops@x' }],
            },
        ],
        edges: [{ from: 'a', to: 'gate', condition: 'on_success' }],
    };

    it('an approval step is a node of its own kind, with its own outcomes', () => {
        expect(nodeKindOfStep({ id: 'gate', type: 'approval' })).toBe('approval');
        expect(outputPorts('approval')).toEqual(['success', 'failure', 'always', 'start', 'delayed', 'approval', 'if']);
        expect(HOOK_FOR_PORT.approval).toBe('on_approval_requested');
        expect(portForHook('on_approval_requested')).toBe('approval');
        expect(FAMILY_OF.approval).toBe('approval');
    });

    it('draws an octagon in the gate colour, with a ⚑ Asks for approval port', () => {
        expect(FAMILY_STYLE.approval).toEqual({ shape: 'octagon', colorToken: 'categoricalA4Strong', label: 'Approval' });
        expect(PORT_STYLE.approval).toEqual({ glyph: '⚑', label: 'Asks for approval', colorToken: 'contentColorMuted' });
        const { w, h } = nodeSize('approval');
        const d = shapePath('octagon', w, h);
        expect(d.startsWith('M')).toBe(true);
        expect(d.trim().endsWith('Z')).toBe(true);
        expect(d.match(/[ML]/g)).toHaveLength(8);
        expect(d).not.toBe(shapePath('rounded', w, h));
    });

    it('draws the Asks for approval action on its approval port', () => {
        const g = buildGraph(gated);
        expect(g.nodes.find((n) => n.key === 'step:gate')!.kind).toBe('approval');
        const line = g.links.find((l) => l.from === 'step:gate' && l.to === 'action:gate:0')!;
        expect(line.port).toBe('approval');
    });

    it('Asks for approval leads only to actions', () => {
        expect(canConnect(gated, 'step:gate', 'approval', 'action:gate:0').ok).toBe(true);
        const toStep = canConnect(gated, 'step:gate', 'approval', 'step:a');
        expect(toStep.ok).toBe(false);
        expect(canConnect(gated, 'step:a', 'approval', 'action:gate:0').ok).toBe(false);
    });

    it('adding an approval node makes a step the server accepts: no search, time range, retries or runtime', () => {
        const s0 = initialState(gated);
        const from = { key: 'step:a', port: 'success' as const };
        expect(addNodeKey(s0.job, 'approval', from)).toBe('step:approval');
        const s = reducer(s0, { type: 'addNode', kind: 'approval', from });
        expect(s.job.steps[2]).toEqual({ id: 'approval', type: 'approval', name: 'Approval', approval: {} });
        expect(s.job.edges).toContainEqual({ from: 'a', to: 'approval', condition: 'on_success' });
    });

    it('renaming a step renames its tokens in an approval message', () => {
        const job2: JobDefinition = { ...gated, steps: [gated.steps[0], { ...gated.steps[1], approval: { message: 'Rows: $a.resultCount$' } }] };
        const s = reducer(initialState(job2), { type: 'updateStep', id: 'a', changes: { id: 'daily' } });
        expect(s.job.steps[1].approval).toEqual({ message: 'Rows: $daily.resultCount$' });
    });

    it('is in the catalog under approve, sign-off, gate, human and manual', () => {
        ['approve', 'sign-off', 'gate', 'human', 'manual'].forEach((q) => expect(searchCatalog(q).map((e) => e.kind)).toContain('approval'));
        expect(targetKinds('success', 'search')).toContain('approval');
        expect(targetKinds('approval', 'approval')).not.toContain('approval');
        expect(targetKinds('approval', 'approval')).toContain('email');
    });
});
