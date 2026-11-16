import type { JobDefinition } from '../api/types';
import { buildGraph } from '../features/builder/nodeModel';
import { blankJob, initialState, reducer } from '../features/builder/reducer';
import { canSplice, spliceMessage } from '../features/builder/splice';

const job: JobDefinition = {
    ...blankJob(),
    name: 'j',
    triggers: [{ type: 'cron', cron: '0 2 * * *', enabled: true }],
    steps: [
        { id: 'a', name: 'Filter hosts', type: 'inline', spl: 'search x', actions: [{ hook: 'on_success', type: 'email', to: 'x@y' }] },
        { id: 'b', name: 'Weekly rollup', type: 'previous', spl: '| head 1' },
        { id: 'n', name: 'New one', type: 'inline', spl: 'search y' },
        { id: 'c', type: 'inline', spl: 'search z' },
    ],
    edges: [
        { from: 'a', to: 'b', condition: 'on_failure' },
        { from: 'b', to: 'c', condition: 'expression', expression: 'x' },
    ],
};
const lk = (j: JobDefinition, from: string, to: string) =>
    buildGraph(j).links.find((l) => l.from === from && l.to === to)!.key;

describe('canSplice', () => {
    it('accepts a search with no lines on a step line', () => {
        expect(canSplice(job, 'step:n', lk(job, 'step:a', 'step:b'))).toEqual({ ok: true });
    });
    it('refuses actions, triggers and the job', () => {
        const l = lk(job, 'step:a', 'step:b');
        ['action:a:0', 'trigger:0', 'job'].forEach((k) => {
            expect(canSplice(job, k, l)).toEqual({ ok: false, reason: 'Only searches can be put on a line' });
        });
    });
    it('refuses a node with lines', () => {
        const r = canSplice(job, 'step:c', lk(job, 'step:a', 'step:b'));
        expect(r).toEqual({ ok: false, reason: 'Disconnect this node first, then drop it on the line' });
    });
    it('refuses a condition line', () => {
        const r = canSplice(job, 'step:n', lk(job, 'step:b', 'cond:b>c'));
        expect(r).toEqual({ ok: false, reason: "Lines with a condition can't be split; remove the condition first" });
    });
    it('refuses a node that already has lines, so a line can never loop', () => {
        const j: JobDefinition = { ...job, edges: [{ from: 'a', to: 'b', condition: 'on_success' }, { from: 'n', to: 'a', condition: 'on_success' }] };
        expect(canSplice(j, 'step:n', lk(j, 'step:a', 'step:b'))).toEqual({
            ok: false,
            reason: 'Disconnect this node first, then drop it on the line',
        });
    });
    it('refuses a line from a node to an action', () => {
        const r = canSplice(job, 'step:n', lk(job, 'step:a', 'action:a:0'));
        expect(r).toEqual({ ok: false, reason: 'Only a line between two steps can be split' });
    });
});

describe('splice', () => {
    it('puts the node on the line and undo restores everything', () => {
        const start = initialState({ ...job, layout: { nodes: { 'step:a': { x: 1, y: 2 } } } });
        const link = lk(start.job, 'step:a', 'step:b');
        const s = reducer(start, { type: 'splice', node: 'step:n', link, at: { x: 300, y: 40 }, shown: { 'step:a': { x: 1, y: 2 }, 'step:b': { x: 600, y: 0 } } });
        expect(s.job.edges).toEqual([
            { from: 'a', to: 'n', condition: 'on_failure' },
            { from: 'n', to: 'b', condition: 'on_success' },
            { from: 'b', to: 'c', condition: 'expression', expression: 'x' },
        ]);
        expect(s.job.layout?.nodes['step:n']).toEqual({ x: 300, y: 40 });
        expect(s.job.layout?.nodes['step:b']).toEqual({ x: 600, y: 0 });
        const u = reducer(s, { type: 'undo' });
        expect(u.job).toEqual(start.job);
    });
    it('does nothing when it cannot splice', () => {
        const start = initialState(job);
        expect(reducer(start, { type: 'splice', node: 'step:c', link: lk(job, 'step:a', 'step:b') })).toBe(start);
    });
    it('writes the message', () => {
        expect(spliceMessage(job, 'step:n', lk(job, 'step:a', 'step:b'))).toBe(
            'Weekly rollup now runs after New one succeeds. Undo brings back the old line.'
        );
    });
});
