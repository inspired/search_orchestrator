import { act, renderHook } from '@testing-library/react';
import { ApiError } from '../api/client';
import type { JobDefinition, PreviewRequest } from '../api/types';
import type { PreviewContext } from '../features/builder/previewLogic';
import usePreviews, { PreviewApi, previewErrorText } from '../features/builder/usePreviews';

const job: JobDefinition = {
    name: 'j',
    enabled: true,
    steps: [
        { id: 'a', type: 'inline', spl: '| makeresults' },
        { id: 'b', type: 'previous', spl: '| stats count' },
    ],
    edges: [{ from: 'a', to: 'b', condition: 'on_success' }],
};
const ctx: PreviewContext = { scheduledTime: 1762300800, params: {}, source: 'live' };

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i += 1) {
            await Promise.resolve();
        }
    });
}

/** Lets the poll loop run: resolved promises, then the 2 s timer, a few times. */
async function settle(rounds = 4) {
    for (let i = 0; i < rounds; i += 1) {
        await flush();
        act(() => jest.advanceTimersByTime(2000));
    }
    await flush();
}

function fakeApi(over: Partial<PreviewApi> = {}): PreviewApi & Record<keyof PreviewApi, jest.Mock> {
    let n = 0;
    return {
        startPreview: jest.fn((req: PreviewRequest) => {
            n += 1;
            return Promise.resolve({ status: 'started' as const, sid: `sid-${req.step_id}-${n}`, spl: `spl ${req.step_id}` });
        }),
        previewStatus: jest.fn(() => Promise.resolve({ state: 'done' as const, result_count: 3, run_duration: 0.4, messages: [] })),
        previewResults: jest.fn(() => Promise.resolve({ fields: ['x'], rows: [{ x: 1 }], total: 1 })),
        cancelPreview: jest.fn(() => Promise.resolve({ cancelled: true })),
        ...over,
    } as unknown as PreviewApi & Record<keyof PreviewApi, jest.Mock>;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('usePreviews', () => {
    test('previewing b with no preview of a starts a, then b with a as input', async () => {
        const api = fakeApi();
        const { result } = renderHook(() => usePreviews(job, ctx, api));
        act(() => {
            result.current.preview('b');
        });
        await settle();
        const calls = api.startPreview.mock.calls.map((c) => c[0] as PreviewRequest);
        expect(calls.map((c) => c.step_id)).toEqual(['a', 'b']);
        expect(calls[1].input).toEqual({ mode: 'live', previews: { a: { sid: 'sid-a-1' } } });
        expect(calls[1].scheduled_time).toBe(ctx.scheduledTime);
        expect(result.current.previews.a.state).toBe('done');
        expect(result.current.previews.b.state).toBe('done');
        expect(result.current.previews.b.results).toEqual({ fields: ['x'], rows: [{ x: 1 }], total: 1 });
        expect(result.current.previews.b.spl).toBe('spl b');
        expect(result.current.previews.b.stale).toBe(false);
    });

    test('polls every 2 s with the step max runtime as the limit', async () => {
        let polls = 0;
        const api = fakeApi({
            previewStatus: jest.fn(() => {
                polls += 1;
                return Promise.resolve(
                    polls < 3
                        ? { state: 'running' as const, result_count: 0, messages: [] }
                        : { state: 'done' as const, result_count: 2, run_duration: 1, messages: [] }
                );
            }),
        });
        const { result } = renderHook(() => usePreviews({ ...job, defaults: { max_runtime: 300 } }, ctx, api));
        act(() => {
            result.current.preview('a');
        });
        await flush();
        expect(result.current.previews.a.state).toBe('running');
        await settle(5);
        expect(api.previewStatus).toHaveBeenCalledTimes(3);
        expect(api.previewStatus).toHaveBeenCalledWith('sid-a-1', 300);
        expect(result.current.previews.a.state).toBe('done');
    });

    test('a 409 needs_preview re-runs the named steps once, then retries', async () => {
        let n = 0;
        const api = fakeApi({
            startPreview: jest.fn((req: PreviewRequest) => {
                n += 1;
                if (req.step_id === 'b' && n === 2) {
                    return Promise.reject(new ApiError(409, 'needs_preview', 'preview a first', [], { steps: ['a'] }));
                }
                return Promise.resolve({ status: 'started' as const, sid: `sid-${req.step_id}-${n}`, spl: 'x' });
            }),
        });
        const { result } = renderHook(() => usePreviews(job, ctx, api));
        act(() => {
            result.current.preview('b');
        });
        await settle(8);
        const steps = api.startPreview.mock.calls.map((c) => (c[0] as PreviewRequest).step_id);
        expect(steps).toEqual(['a', 'b', 'a', 'b']);
        const last = api.startPreview.mock.calls[3][0] as PreviewRequest;
        expect(last.input).toEqual({ mode: 'live', previews: { a: { sid: 'sid-a-3' } } });
        expect(result.current.previews.b.state).toBe('done');
    });

    test('a second needs_preview fails the step instead of looping', async () => {
        const api = fakeApi({
            startPreview: jest.fn((req: PreviewRequest) =>
                req.step_id === 'b'
                    ? Promise.reject(new ApiError(409, 'needs_preview', 'preview a first', [], { steps: ['a'] }))
                    : Promise.resolve({ status: 'started' as const, sid: 'sid-a', spl: 'x' })
            ),
        });
        const { result } = renderHook(() => usePreviews(job, ctx, api));
        act(() => {
            result.current.preview('b');
        });
        await settle(8);
        expect(api.startPreview).toHaveBeenCalledTimes(4);
        expect(result.current.previews.b.state).toBe('failed');
        expect(result.current.previews.b.error).toBe('preview a first');
    });

    test('cancel calls cancelPreview and stops polling', async () => {
        const api = fakeApi({
            previewStatus: jest.fn(() => Promise.resolve({ state: 'running' as const, result_count: 0, messages: [] })),
        });
        const { result } = renderHook(() => usePreviews(job, ctx, api));
        act(() => {
            result.current.preview('a');
        });
        await settle(2);
        act(() => {
            result.current.cancel('a');
        });
        await flush();
        expect(api.cancelPreview).toHaveBeenCalledWith('sid-a-1');
        expect(result.current.previews.a.state).toBe('failed');
        expect(result.current.previews.a.error).toBe('Preview cancelled.');
        const polls = api.previewStatus.mock.calls.length;
        await settle(3);
        expect(api.previewStatus.mock.calls.length).toBe(polls);
    });

    test('starting a step with a running preview cancels the old one first', async () => {
        const api = fakeApi({
            previewStatus: jest.fn(() => Promise.resolve({ state: 'running' as const, result_count: 0, messages: [] })),
        });
        const { result } = renderHook(() => usePreviews(job, ctx, api));
        act(() => {
            result.current.preview('a');
        });
        await settle(1);
        act(() => {
            result.current.preview('a');
        });
        await flush();
        expect(api.cancelPreview).toHaveBeenCalledWith('sid-a-1');
        expect(api.startPreview).toHaveBeenCalledTimes(2);
        expect(result.current.previews.a.sid).toBe('sid-a-2');
    });

    test('a skipped step is sent downstream as skipped; Preview anyway sends anyway', async () => {
        const api = fakeApi({
            startPreview: jest.fn((req: PreviewRequest) =>
                req.step_id === 'a' && !req.anyway
                    ? Promise.resolve({ status: 'skipped' as const, skip_kind: 'run_when' as const, reason: 'Runs on Mondays.' })
                    : Promise.resolve({ status: 'started' as const, sid: `sid-${req.step_id}`, spl: 'x', anyway: req.anyway })
            ),
        });
        const { result } = renderHook(() => usePreviews(job, ctx, api));
        act(() => {
            result.current.preview('b');
        });
        await settle();
        expect(result.current.previews.a.state).toBe('skipped');
        expect(result.current.previews.a.skipped).toBe('run_when');
        expect(result.current.previews.a.reason).toBe('Runs on Mondays.');
        expect((api.startPreview.mock.calls[1][0] as PreviewRequest).input).toEqual({ mode: 'live', previews: { a: { skipped: 'run_when' } } });
        act(() => {
            result.current.preview('a', { anyway: true });
        });
        await settle();
        const last = api.startPreview.mock.calls[2][0] as PreviewRequest;
        expect(last.step_id).toBe('a');
        expect(last.anyway).toBe(true);
        expect(api.startPreview).toHaveBeenCalledTimes(3);
        expect(result.current.previews.a.anyway).toBe(true);
    });

    test('an edit makes the preview and its downstream stale', async () => {
        const api = fakeApi();
        const { result, rerender } = renderHook(({ j }) => usePreviews(j, ctx, api), { initialProps: { j: job } });
        act(() => {
            result.current.preview('b');
        });
        await settle();
        expect(result.current.previews.b.stale).toBe(false);
        rerender({ j: { ...job, steps: [{ ...job.steps[0], spl: '| makeresults count=2' }, job.steps[1]] } });
        expect(result.current.previews.a.stale).toBe(true);
        expect(result.current.previews.b.stale).toBe(true);
    });

    test('a run as input previews only the step and sends the run id', async () => {
        const api = fakeApi();
        const { result } = renderHook(() => usePreviews(job, { ...ctx, source: 'j:1' }, api));
        act(() => {
            result.current.preview('b');
        });
        await settle();
        expect(api.startPreview).toHaveBeenCalledTimes(1);
        expect((api.startPreview.mock.calls[0][0] as PreviewRequest).input).toEqual({ mode: 'run', run_id: 'j:1' });
    });

    test('a start error becomes a failed preview with the server message', async () => {
        const api = fakeApi({
            startPreview: jest.fn(() => Promise.reject(new ApiError(410, 'run_results_expired', "daily's results from that run have expired", [], { step: 'daily' }))),
        });
        const { result } = renderHook(() => usePreviews(job, { ...ctx, source: 'j:1' }, api));
        act(() => {
            result.current.preview('a');
        });
        await settle();
        expect(result.current.previews.a.state).toBe('failed');
        expect(result.current.previews.a.error).toBe("daily's results from that run have expired");
    });

    test('done previews are polled every 5 minutes; a gone one becomes missing', async () => {
        let gone = false;
        const api = fakeApi({
            previewStatus: jest.fn(() =>
                Promise.resolve(gone ? { state: 'missing' as const, result_count: 0, messages: [] } : { state: 'done' as const, result_count: 3, messages: [] })
            ),
        });
        const { result } = renderHook(() => usePreviews(job, ctx, api));
        act(() => {
            result.current.preview('a');
        });
        await settle();
        const before = api.previewStatus.mock.calls.length;
        gone = true;
        act(() => jest.advanceTimersByTime(5 * 60 * 1000));
        await flush();
        expect(api.previewStatus.mock.calls.length).toBe(before + 1);
        expect(result.current.previews.a.state).toBe('missing');
    });

    test('a 404 from a running poll marks the preview missing, never the raw error', async () => {
        const api = fakeApi({
            previewStatus: jest.fn(() => Promise.reject(new ApiError(404, 'not_found', "no preview 'so_preview_x'"))),
        });
        const { result } = renderHook(() => usePreviews(job, ctx, api));
        act(() => {
            result.current.preview('a');
        });
        await settle();
        expect(result.current.previews.a.state).toBe('missing');
        expect(result.current.previews.a.error).toBeUndefined();
    });

    test('a 404 from a keep-alive poll marks the preview missing', async () => {
        let gone = false;
        const api = fakeApi({
            previewStatus: jest.fn(() =>
                gone
                    ? Promise.reject(new ApiError(404, 'not_found', "no preview 'so_preview_x'"))
                    : Promise.resolve({ state: 'done' as const, result_count: 3, messages: [] })
            ),
        });
        const { result } = renderHook(() => usePreviews(job, ctx, api));
        act(() => {
            result.current.preview('a');
        });
        await settle();
        expect(result.current.previews.a.state).toBe('done');
        gone = true;
        act(() => jest.advanceTimersByTime(5 * 60 * 1000));
        await flush();
        expect(result.current.previews.a.state).toBe('missing');
        expect(result.current.previews.a.error).toBeUndefined();
    });

    test('a failed upstream is sent by sid and the server decides: on_failure branch previews', async () => {
        const branch: JobDefinition = {
            name: 'j',
            enabled: true,
            steps: [
                { id: 'a', type: 'inline', spl: '| makeresults' },
                { id: 'h', type: 'inline', spl: '| makeresults' },
            ],
            edges: [{ from: 'a', to: 'h', condition: 'on_failure' }],
        };
        const api = fakeApi({
            previewStatus: jest.fn((sid: string) =>
                Promise.resolve(
                    sid.startsWith('sid-a')
                        ? { state: 'failed' as const, result_count: 0, error: 'boom', messages: [] }
                        : { state: 'done' as const, result_count: 1, messages: [] }
                )
            ),
        });
        const { result } = renderHook(() => usePreviews(branch, ctx, api));
        act(() => {
            result.current.preview('h');
        });
        await settle(6);
        const calls = api.startPreview.mock.calls.map((c) => c[0] as PreviewRequest);
        expect(calls.map((c) => c.step_id)).toEqual(['a', 'h']);
        expect(calls[1].input).toEqual({ mode: 'live', previews: { a: { sid: 'sid-a-1' } } });
        expect(result.current.previews.a.state).toBe('failed');
        expect(result.current.previews.h.state).toBe('done');
        // Previewing h again reuses a's current failed preview.
        act(() => {
            result.current.preview('h');
        });
        await settle(4);
        const again = api.startPreview.mock.calls.map((c) => c[0] as PreviewRequest);
        expect(again.map((c) => c.step_id)).toEqual(['a', 'h', 'h']);
        expect(again[2].input).toEqual({ mode: 'live', previews: { a: { sid: 'sid-a-1' } } });
    });

    test('a failed upstream behind on_success shows the server upstream_failed', async () => {
        const msg = 'a failed, so a run would not reach this step; fix it or preview it again';
        const api = fakeApi({
            startPreview: jest.fn((req: PreviewRequest) =>
                req.step_id === 'b'
                    ? Promise.reject(new ApiError(409, 'upstream_failed', msg, [], { step: 'a' }))
                    : Promise.resolve({ status: 'started' as const, sid: 'sid-a-1', spl: 'x' })
            ),
            previewStatus: jest.fn(() => Promise.resolve({ state: 'failed' as const, result_count: 0, error: 'boom', messages: [] })),
        });
        const { result } = renderHook(() => usePreviews(job, ctx, api));
        act(() => {
            result.current.preview('b');
        });
        await settle(6);
        expect((api.startPreview.mock.calls[1][0] as PreviewRequest).input).toEqual({ mode: 'live', previews: { a: { sid: 'sid-a-1' } } });
        expect(result.current.previews.b.state).toBe('failed');
        expect(result.current.previews.b.error).toBe(msg);
    });

    test('unmount cancels running previews', async () => {
        const api = fakeApi({
            previewStatus: jest.fn(() => Promise.resolve({ state: 'running' as const, result_count: 0, messages: [] })),
        });
        const { result, unmount } = renderHook(() => usePreviews(job, ctx, api));
        act(() => {
            result.current.preview('a');
        });
        await settle(1);
        unmount();
        expect(api.cancelPreview).toHaveBeenCalledWith('sid-a-1');
    });
    test('Preview anyway previews stale upstream steps first and sends anyway only for the step', async () => {
        const three: JobDefinition = {
            name: 'j',
            enabled: true,
            steps: [
                { id: 'a', type: 'inline', spl: '| makeresults' },
                { id: 'c', type: 'previous', spl: '| stats count', run_when: { kind: 'cron', value: '* * * * 1' } },
            ],
            edges: [{ from: 'a', to: 'c', condition: 'on_success' }],
        };
        let n = 0;
        const api = fakeApi({
            startPreview: jest.fn((req: PreviewRequest) => {
                n += 1;
                if (req.step_id === 'c' && !req.anyway) {
                    return Promise.resolve({ status: 'skipped' as const, skip_kind: 'run_when' as const, reason: 'Mondays' });
                }
                return Promise.resolve({ status: 'started' as const, sid: `sid-${req.step_id}-${n}`, spl: 'x', anyway: req.anyway });
            }),
        });
        const { result, rerender } = renderHook(({ j }) => usePreviews(j, ctx, api), { initialProps: { j: three } });
        act(() => {
            result.current.preview('c');
        });
        await settle();
        expect(result.current.previews.c.state).toBe('skipped');
        const edited = { ...three, steps: [{ ...three.steps[0], spl: '| makeresults count=2' }, three.steps[1]] };
        rerender({ j: edited });
        act(() => {
            result.current.preview('c', { anyway: true });
        });
        await settle();
        const calls = api.startPreview.mock.calls.map((c) => c[0] as PreviewRequest);
        expect(calls.slice(2).map((c) => [c.step_id, Boolean(c.anyway)])).toEqual([
            ['a', false],
            ['c', true],
        ]);
        expect(calls[3].input).toEqual({ mode: 'live', previews: { a: { sid: 'sid-a-3' } } });
        expect(result.current.previews.c.state).toBe('done');
        expect(result.current.previews.c.stale).toBe(false);
    });

    test('a truncated From previous steps preview is failed', async () => {
        const api = fakeApi({
            previewStatus: jest.fn(() =>
                Promise.resolve({ state: 'done' as const, result_count: 5, truncated: 'append stopped at 50000 rows', messages: [] })
            ),
        });
        const { result } = renderHook(() => usePreviews(job, ctx, api));
        act(() => {
            result.current.preview('b');
        });
        await settle();
        expect(result.current.previews.a.state).toBe('done');
        expect(result.current.previews.b.state).toBe('failed');
        expect(result.current.previews.b.error).toBe('a subsearch was cut short: append stopped at 50000 rows');
    });

    test('two chains sharing a running upstream step dispatch it once', async () => {
        const fork: JobDefinition = {
            name: 'j',
            enabled: true,
            steps: [
                { id: 'a', type: 'inline', spl: '| makeresults' },
                { id: 'b', type: 'previous', spl: '| stats count' },
                { id: 'c', type: 'previous', spl: '| stats sum(x)' },
            ],
            edges: [
                { from: 'a', to: 'b', condition: 'on_success' },
                { from: 'a', to: 'c', condition: 'on_success' },
            ],
        };
        let polls = 0;
        let n = 0;
        const api = fakeApi({
            startPreview: jest.fn((req: PreviewRequest) => {
                n += 1;
                if (req.step_id !== 'a' && !('a' in ((req.input as { previews?: object }).previews || {}))) {
                    return Promise.reject(new ApiError(409, 'needs_preview', 'preview a first', [], { steps: ['a'] }));
                }
                return Promise.resolve({ status: 'started' as const, sid: `sid-${req.step_id}-${n}`, spl: 'x' });
            }),
            previewStatus: jest.fn(() => {
                polls += 1;
                return Promise.resolve(
                    polls < 3 ? { state: 'running' as const, result_count: 0, messages: [] } : { state: 'done' as const, result_count: 1, messages: [] }
                );
            }),
        });
        const { result } = renderHook(() => usePreviews(fork, ctx, api));
        act(() => {
            result.current.preview('b');
        });
        await flush();
        act(() => {
            result.current.preview('c');
        });
        await settle(8);
        const aStarts = api.startPreview.mock.calls.filter((c) => (c[0] as PreviewRequest).step_id === 'a');
        expect(aStarts).toHaveLength(1);
        expect(api.cancelPreview).not.toHaveBeenCalled();
        expect(result.current.previews.b.state).toBe('done');
        expect(result.current.previews.c.state).toBe('done');
    });

    test('previewErrorText adds the issues once, not again when the message names them', () => {
        const issue = (message: string) => ({ level: 'error' as const, code: 'x', message, step: null });
        expect(previewErrorText(new ApiError(400, 'invalid', 'the step has errors', [issue('a: bad')]))).toBe('the step has errors: a: bad');
        const cycle = 'the job has a cycle: x → y → x';
        expect(previewErrorText(new ApiError(400, 'invalid', `${cycle}; fix it before previewing`, [issue(cycle)]))).toBe(
            `${cycle}; fix it before previewing`
        );
    });

    const diamond: JobDefinition = {
        name: 'j',
        enabled: true,
        steps: [
            { id: 'a', type: 'inline', spl: '| makeresults' },
            { id: 'b', type: 'previous', spl: '| stats count' },
            { id: 'c', type: 'previous', spl: '| stats sum(x)' },
            { id: 'd', type: 'previous', spl: '| stats max(x)' },
        ],
        edges: [
            { from: 'a', to: 'b', condition: 'on_success' },
            { from: 'b', to: 'c', condition: 'on_success' },
            { from: 'b', to: 'd', condition: 'on_success' },
        ],
    };

    /** a stays running for its first `slow` polls; the rest are done at once. The server
     * says needs_preview for a step whose direct input it isn't sent. */
    function slowA(slow = 4) {
        let n = 0;
        let aPolls = 0;
        return fakeApi({
            startPreview: jest.fn((req: PreviewRequest) => {
                n += 1;
                const sent = (req.input as { previews?: Record<string, unknown> }).previews || {};
                const need = (diamond.edges || []).filter((e) => e.to === req.step_id && !(e.from in sent)).map((e) => e.from);
                if (need.length) {
                    return Promise.reject(new ApiError(409, 'needs_preview', `preview ${need.join(', ')} first`, [], { steps: need }));
                }
                return Promise.resolve({ status: 'started' as const, sid: `sid-${req.step_id}-${n}`, spl: 'x' });
            }),
            previewStatus: jest.fn((sid: string) => {
                if (sid.startsWith('sid-a-')) {
                    aPolls += 1;
                    if (aPolls <= slow) {
                        return Promise.resolve({ state: 'running' as const, result_count: 0, messages: [] });
                    }
                }
                return Promise.resolve({ state: 'done' as const, result_count: 1, messages: [] });
            }),
        });
    }

    const startsOf = (api: ReturnType<typeof fakeApi>, id: string) => api.startPreview.mock.calls.filter((c) => (c[0] as PreviewRequest).step_id === id);

    test.each([
        ['c then d', 'c', 'd', true],
        ['b then c', 'b', 'c', true],
        ['c then d at once', 'c', 'd', false],
        ['b then c at once', 'b', 'c', false],
        ['c then b', 'c', 'b', true],
    ])('a running upstream still waiting on its own upstream is awaited by a second chain (%s)', async (_n, first, second, gap) => {
        const api = slowA();
        const { result } = renderHook(() => usePreviews(diamond, ctx, api));
        act(() => {
            result.current.preview(first);
        });
        if (gap) {
            await flush();
        }
        act(() => {
            result.current.preview(second);
        });
        await settle(10);
        // One start each, and none refused for a missing input (no restart of b either).
        expect(startsOf(api, 'a')).toHaveLength(1);
        expect(startsOf(api, 'b')).toHaveLength(1);
        expect(startsOf(api, 'b')[0][0].input).toEqual({ mode: 'live', previews: { a: { sid: 'sid-a-1' } } });
        expect(api.cancelPreview).not.toHaveBeenCalled();
        [first, second].forEach((id) => expect(result.current.previews[id].state).toBe('done'));
        expect(result.current.previews.b.state).toBe('done');
    });

    test('the input line lists what the server says the preview read, skipped ones as skipped', async () => {
        const chain: JobDefinition = {
            name: 'j',
            enabled: true,
            steps: [
                { id: 'a', type: 'inline', spl: '| makeresults' },
                { id: 'b', type: 'inline', spl: '| makeresults', run_when: { kind: 'cron', value: '* * * * 1' } },
                { id: 'c', type: 'inline', spl: '| makeresults | eval n="$a.resultCount$" s="$b.sid|none$"' },
            ],
            edges: [
                { from: 'a', to: 'b', condition: 'on_success' },
                { from: 'b', to: 'c', condition: 'on_success' },
            ],
        };
        let n = 0;
        const api = fakeApi({
            startPreview: jest.fn((req: PreviewRequest) => {
                n += 1;
                const sid = `sid-${req.step_id}-${n}`;
                if (req.step_id === 'c') {
                    return Promise.resolve({
                        status: 'started' as const,
                        sid,
                        spl: 'x',
                        input: [
                            { step: 'a', state: 'succeeded' as const, sid: 'sid-a-1' },
                            { step: 'b', state: 'skipped' as const, skip_kind: 'run_when' as const },
                        ],
                    });
                }
                return Promise.resolve({ status: 'started' as const, sid, spl: 'x' });
            }),
        });
        const { result } = renderHook(() => usePreviews(chain, ctx, api));
        act(() => {
            result.current.preview('b', { anyway: true });
        });
        await settle();
        act(() => {
            result.current.preview('c');
        });
        await settle();
        const { input } = result.current.previews.c;
        expect(input && input.mode === 'live' && input.steps.map((s) => [s.id, s.skipped || null])).toEqual([
            ['a', null],
            ['b', 'run_when'],
        ]);
        expect(input && input.mode === 'live' && input.steps[0].at).toBe(result.current.previews.a.startedAt);
    });
});
