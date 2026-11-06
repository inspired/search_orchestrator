import type { JobDefinition, StepDef } from '../api/types';
import {
    generatedInput,
    isStale,
    LivePreview,
    PreviewContext,
    previewKey,
    toBeRun,
    upstreamOf,
} from '../features/builder/previewLogic';

const job = (steps: StepDef[], edges: JobDefinition['edges'] = [], over: Partial<JobDefinition> = {}): JobDefinition => ({
    name: 'j',
    enabled: true,
    steps,
    edges,
    ...over,
});

const ctx: PreviewContext = { scheduledTime: 1000, params: {}, source: 'live' };

/** Every step's current key, each built from its upstream's current keys and sids. */
function keysOf(j: JobDefinition, c: PreviewContext, previews: Record<string, LivePreview>) {
    const memo: Record<string, string> = {};
    const keyOf = (id: string): string => {
        if (!(id in memo)) {
            const ups: Record<string, { key: string; sid?: string }> = {};
            upstreamOf(j, id).forEach((u) => {
                ups[u] = { key: keyOf(u), sid: previews[u]?.sid };
            });
            memo[id] = previewKey(j, id, c, ups);
        }
        return memo[id];
    };
    return keyOf;
}

const chain = () =>
    job(
        [
            { id: 'a', type: 'inline', spl: '| makeresults' },
            { id: 'b', type: 'inline', spl: '| loadjob $a.sid$' },
            { id: 'c', type: 'inline', spl: '| makeresults | eval n=$b.resultCount|0$' },
            { id: 'x', type: 'inline', spl: '| makeresults' },
        ],
        [{ from: 'a', to: 'b', condition: 'on_success' }]
    );

describe('previewLogic', () => {
    test('upstreamOf follows edges and tokens', () => {
        const j = chain();
        expect(upstreamOf(j, 'c')).toEqual(['a', 'b']);
        expect(upstreamOf(j, 'b')).toEqual(['a']);
        expect(upstreamOf(j, 'a')).toEqual([]);
        expect(upstreamOf(j, 'x')).toEqual([]);
    });

    test('upstreamOf ignores run tokens, unknown steps and longer ids', () => {
        const j = job([
            { id: 'a', type: 'inline', spl: '| makeresults' },
            { id: 'ab', type: 'inline', spl: '| makeresults' },
            { id: 'c', type: 'inline', spl: '| x $run.param.a$ $ab.sid$ $zz.sid$ $a$ $a.bogus$ $run.id$' },
        ]);
        expect(upstreamOf(j, 'c')).toEqual(['ab']);
    });

    test('upstreamOf orders topologically, ties in step order', () => {
        const j = job(
            [
                { id: 'p', type: 'previous', spl: '| stats count' },
                { id: 'b', type: 'inline', spl: '| loadjob $a.sid$' },
                { id: 'a', type: 'inline', spl: '| makeresults' },
                { id: 'z', type: 'inline', spl: '| makeresults' },
            ],
            [
                { from: 'b', to: 'p' },
                { from: 'z', to: 'p' },
            ]
        );
        // Matches preview.closure on the same definition.
        expect(upstreamOf(j, 'p')).toEqual(['a', 'b', 'z']);
    });

    test('generatedInput for none, one and two deps', () => {
        const steps: StepDef[] = [
            { id: 'a', type: 'inline', spl: '| makeresults' },
            { id: 'b', type: 'inline', spl: '| makeresults' },
            { id: 'p', type: 'previous', spl: '| stats count' },
        ];
        expect(generatedInput(job(steps), 'p')).toBe('(no previous steps yet)');
        expect(generatedInput(job(steps, [{ from: 'a', to: 'p' }]), 'p')).toBe('| loadjob ‹a›');
        expect(generatedInput(job(steps, [{ from: 'b', to: 'p' }, { from: 'a', to: 'p' }]), 'p')).toBe(
            '| loadjob ‹b› | append [| loadjob ‹a›]'
        );
    });

    test('test_edit_during_preview_marks_stale', () => {
        const j1 = chain();
        const previews: Record<string, LivePreview> = {};
        const k1 = keysOf(j1, ctx, previews);
        previews.a = { key: k1('a'), sid: 'sid_a', state: 'done', startedAt: 1 };
        const k1b = keysOf(j1, ctx, previews);
        previews.b = { key: k1b('b'), sid: 'sid_b', state: 'running', startedAt: 2 };
        expect(isStale(previews.b, k1b('b'))).toBe(false);

        const j2 = { ...j1, steps: j1.steps.map((s) => (s.id === 'a' ? { ...s, spl: '| makeresults count=2' } : s)) };
        const k2 = keysOf(j2, ctx, previews);
        expect(k2('a')).not.toBe(k1b('a'));
        expect(isStale(previews.a, k2('a'))).toBe(true);
        // b is still running, but what it read from has changed.
        expect(isStale(previews.b, k2('b'))).toBe(true);
    });

    test('a new upstream sid changes the key', () => {
        const j = chain();
        const one = keysOf(j, ctx, { a: { key: 'K', sid: 's1', state: 'done', startedAt: 1 } });
        const two = keysOf(j, ctx, { a: { key: 'K', sid: 's2', state: 'done', startedAt: 1 } });
        expect(one('b')).not.toBe(two('b'));
    });

    test('toBeRun previews missing and stale upstream first, in order', () => {
        const j = chain();
        const previews: Record<string, LivePreview> = {};
        expect(toBeRun(j, 'c', previews, keysOf(j, ctx, previews))).toEqual(['a', 'b', 'c']);

        previews.a = { key: keysOf(j, ctx, previews)('a'), sid: 'sa', state: 'done', startedAt: 1 };
        previews.b = { key: keysOf(j, ctx, previews)('b'), sid: 'sb', state: 'done', startedAt: 1 };
        expect(toBeRun(j, 'c', previews, keysOf(j, ctx, previews))).toEqual(['c']);

        // The server no longer has a's search job: a, and b which reads it, again.
        const gone = { ...previews, a: { ...previews.a, state: 'missing' as const } };
        expect(toBeRun(j, 'c', gone, keysOf(j, ctx, gone))).toEqual(['a', 'b', 'c']);

        // A stale b (the schedule time changed) is run again; so is a, which b reads.
        const later = { ...ctx, scheduledTime: 2000 };
        expect(toBeRun(j, 'c', previews, keysOf(j, later, previews))).toEqual(['a', 'b', 'c']);
    });

    test('changing an unrelated step or the schedule keeps keys', () => {
        const j = chain();
        const before = keysOf(j, ctx, {});
        const edited = {
            ...j,
            triggers: [{ type: 'cron', cron: '0 1 * * *' }],
            steps: j.steps.map((s) => (s.id === 'x' ? { ...s, spl: '| makeresults count=9' } : s.id === 'b' ? { ...s, name: 'Bee' } : s)),
        };
        const after = keysOf(edited, ctx, {});
        ['a', 'b', 'c'].forEach((id) => expect(after(id)).toBe(before(id)));
        expect(after('x')).not.toBe(before('x'));
    });

    test('keys resolve inherited defaults and read only referenced params', () => {
        const steps: StepDef[] = [{ id: 'a', type: 'inline', spl: '| makeresults | eval h=$run.param.host$' }];
        const params = [
            { name: 'host', default: 'web' },
            { name: 'other', default: 'x' },
        ];
        const base = previewKey(job(steps, [], { params }), 'a', ctx, {});
        // A job default equal to the builtin, or an explicit step value equal to it, is the same.
        expect(previewKey(job(steps, [], { params, defaults: { retries: 0 } }), 'a', ctx, {})).toBe(base);
        expect(previewKey(job([{ ...steps[0], retries: 0 }], [], { params }), 'a', ctx, {})).toBe(base);
        expect(previewKey(job(steps, [], { params, defaults: { retries: 2 } }), 'a', ctx, {})).not.toBe(base);
        // The default 'web' and an explicit 'web' are the same input.
        expect(previewKey(job(steps, [], { params }), 'a', { ...ctx, params: { host: 'web' } }, {})).toBe(base);
        expect(previewKey(job(steps, [], { params }), 'a', { ...ctx, params: { other: 'y' } }, {})).toBe(base);
        expect(previewKey(job(steps, [], { params }), 'a', { ...ctx, params: { host: 'db' } }, {})).not.toBe(base);
        expect(previewKey(job(steps, [], { params }), 'a', { ...ctx, source: 'run1' }, {})).not.toBe(base);
    });
});
