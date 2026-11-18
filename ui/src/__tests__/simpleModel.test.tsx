import type { JobDefinition } from '../api/types';
import { addSearch, addThen, moveSearch, readSimple, removeSearch, removeThen, setJobAction, updateThen } from '../features/simple/simpleModel';

const base = (): JobDefinition => ({
    name: 'j',
    enabled: true,
    triggers: [{ type: 'cron', cron: '0 6 * * *', steps: ['a'] }],
    steps: [
        { id: 'a', name: 'Count', type: 'inline', spl: 'index=_internal', earliest: '-24h', latest: 'now' },
        { id: 'b', name: 'Top', type: 'previous', spl: '| stats count' },
    ],
    edges: [{ from: 'a', to: 'b', condition: 'on_success' }],
    actions: [],
});

describe('readSimple', () => {
    test('reads a chain with its thens, and no reasons', () => {
        let j = addThen(base(), 'a', 'summary_index');
        j = addThen(j, 'a', 'email');
        const r = readSimple(j);
        expect(r.reasons).toEqual([]);
        expect(r.chain.map((c) => c.step.id)).toEqual(['a', 'b']);
        expect(r.chain[0].thens.map((t) => t.kind)).toEqual(['summary_index', 'email']);
    });

    test('names what Simple cannot edit', () => {
        const j = base();
        j.edges = [{ from: 'a', to: 'b', condition: 'on_failure' }];
        j.steps!.push({ id: 'g', type: 'approval', approval: {} });
        j.triggers!.push({ type: 'cron', cron: '0 7 * * *' });
        const reasons = readSimple(j).reasons.join(' | ');
        expect(reasons).toContain('on failure');
        expect(reasons).toContain('approval');
        expect(reasons).toContain('more than one trigger');
    });

    test('side-by-side searches are a reason', () => {
        const j = base();
        j.edges = [];
        expect(readSimple(j).reasons).toContain('searches that run side by side');
    });
});

describe('edits', () => {
    test('add, move and remove searches keep one chain and the trigger on the first', () => {
        const added = addSearch(base());
        expect(readSimple(added.job).chain.map((c) => c.step.id)).toEqual(['a', 'b', added.id]);
        const moved = moveSearch(added.job, 'b', -1);
        expect(readSimple(moved).chain.map((c) => c.step.id)).toEqual(['b', 'a', added.id]);
        expect(moved.triggers![0].steps).toEqual(['b']);
        const removed = removeSearch(moved, 'a');
        expect(readSimple(removed).chain.map((c) => c.step.id)).toEqual(['b', added.id]);
        expect(removed.edges).toEqual([{ from: 'b', to: added.id, condition: 'on_success' }]);
    });

    test('removing a search removes its outputs too', () => {
        const j = addThen(base(), 'a', 'lookup');
        const r = removeSearch(j, 'a');
        expect((r.steps || []).map((s) => s.id)).toEqual(['b']);
    });

    test('only if results: run_when on an output, a flag on an action', () => {
        let j = addThen(addThen(base(), 'a', 'lookup'), 'a', 'email');
        let thens = readSimple(j).chain[0].thens;
        j = updateThen(j, 'a', thens[0], { onlyIfResults: true, output: { kind: 'lookup', name: 'x.csv' } });
        j = updateThen(j, 'a', thens[1], { onlyIfResults: true, action: { to: 'ops@example.com' } });
        thens = readSimple(j).chain[0].thens;
        expect(thens.map((t) => t.onlyIfResults)).toEqual([true, true]);
        const out = j.steps!.find((s) => s.output)!;
        expect(out.run_when).toEqual({ kind: 'expression', value: '$a.resultCount$ > 0' });
        expect(out.spl).toBe('| outputlookup x.csv');
        expect(readSimple(j).reasons).toEqual([]);
        j = removeThen(j, 'a', thens[1]);
        expect(j.steps!.find((s) => s.id === 'a')!.actions).toEqual([]);
    });

    test('job actions for failure and when done', () => {
        let j = setJobAction(base(), -1, { hook: 'on_failure', type: 'email', to: 'ops@example.com' });
        j = setJobAction(j, -1, { hook: 'on_success', type: 'start_job', job: 'weekly' });
        const r = readSimple(j);
        expect([r.failure, r.whenDone]).toEqual([0, 1]);
        expect(readSimple(setJobAction(j, 0, null)).failure).toBe(-1);
    });
});
