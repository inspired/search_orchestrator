import {
    ApiError,
    cancelPreview,
    listRuns,
    me,
    previewDefaults,
    previewResults,
    previewStatus,
    setJobEnabled,
    startPreview,
    startRun,
    updateJob,
    validateJob,
} from '../api/client';
import { job } from './fixtures';

type FetchCall = [string, RequestInit];

function mockFetch(status: number, body: unknown) {
    const fn = jest.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fn;
    return fn;
}

beforeEach(() => {
    document.cookie = 'splunkweb_csrf_token_8000=tok123';
});

describe('client', () => {
    test('client includes CSRF and surfaces issues', async () => {
        const issues = [{ level: 'error', code: 'bad_cron', message: 'trigger cron: bad field', step: null }];
        const fetch = mockFetch(400, { error: { code: 'job_invalid', message: 'the job has errors', issues } });
        let caught: unknown;
        try {
            await updateJob('daily', job());
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(ApiError);
        const err = caught as ApiError;
        expect(err.code).toBe('job_invalid');
        expect(err.message).toBe('the job has errors');
        expect(err.issues).toEqual(issues);
        expect(err.status).toBe(400);

        const [url, init] = fetch.mock.calls[0] as FetchCall;
        // Through Splunk Web's splunkd proxy, under the locale prefix.
        expect(url).toBe('/en-US/splunkd/__raw/services/orchestrator/jobs/daily?output_mode=json');
        expect(init.method).toBe('PUT');
        expect((init.headers as Record<string, string>)['X-Splunk-Form-Key']).toBe('tok123');
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
        expect(init.credentials).toBe('include');
        // Server-computed fields never go back in the body.
        const sent = JSON.parse(init.body as string);
        expect(sent.name).toBe('Daily summary');
        ['permissions', 'next_run', 'last_run', 'owner'].forEach((k) => expect(sent).not.toHaveProperty(k));
    });

    test('setJobEnabled posts only the flag', async () => {
        const fetch = mockFetch(200, { job: job({ enabled: false }) });
        await setJobEnabled('daily', false);
        const [url, init] = fetch.mock.calls[0] as FetchCall;
        expect(url).toBe('/en-US/splunkd/__raw/services/orchestrator/jobs/daily/enabled?output_mode=json');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ enabled: false });
    });

    test('GET sends filters as query parameters and parses the body', async () => {
        const fetch = mockFetch(200, { runs: [] });
        await expect(listRuns({ state: 'failed', job_id: 'daily' })).resolves.toEqual([]);
        const [url, init] = fetch.mock.calls[0] as FetchCall;
        expect(url).toContain('/services/orchestrator/runs?');
        expect(url).toContain('state=failed');
        expect(url).toContain('job_id=daily');
        expect(url).toContain('output_mode=json');
        expect(init.method).toBe('GET');
        expect(init.body).toBeUndefined();
    });

    test('POST sends JSON and returns the payload', async () => {
        const fetch = mockFetch(201, { run_id: 'daily:manual:1' });
        await expect(startRun('daily', { params: { p: '1' } })).resolves.toEqual({ run_id: 'daily:manual:1' });
        const [url, init] = fetch.mock.calls[0] as FetchCall;
        expect(url).toContain('/services/orchestrator/jobs/daily/runs');
        expect(JSON.parse(init.body as string)).toEqual({ params: { p: '1' } });
    });

    test('validate returns the owner change', async () => {
        mockFetch(200, { valid: true, issues: [], owner_will_change: true, owner: 'root' });
        const out = await validateJob(job());
        expect(out.owner_will_change).toBe(true);
        expect(out.owner).toBe('root');
    });

    test('a non-JSON failure still throws ApiError', async () => {
        mockFetch(502, '<html>Bad gateway</html>');
        await expect(me()).rejects.toMatchObject({ code: 'http_502', status: 502 });
    });

    test('the timeout timer is cleared on a normal response', async () => {
        jest.useFakeTimers();
        try {
            mockFetch(200, { user: 'alice' });
            await me();
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    test('a request that never settles times out after 30 seconds', async () => {
        jest.useFakeTimers();
        try {
            let signal: AbortSignal | undefined;
            (globalThis as unknown as { fetch: unknown }).fetch = jest.fn((_url: string, init: RequestInit) => {
                signal = init.signal as AbortSignal;
                return new Promise((_resolve, reject) => {
                    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                });
            });
            const pending = me();
            const caught = pending.catch((err) => err);
            jest.advanceTimersByTime(29999);
            expect(signal?.aborted).toBe(false);
            jest.advanceTimersByTime(1);
            const err = await caught;
            expect(err).toBeInstanceOf(ApiError);
            expect(err).toMatchObject({ code: 'timeout', status: 0 });
            expect(signal?.aborted).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    test('a slow body read also times out', async () => {
        jest.useFakeTimers();
        try {
            let signal: AbortSignal | undefined;
            (globalThis as unknown as { fetch: unknown }).fetch = jest.fn((_url: string, init: RequestInit) => {
                signal = init.signal as AbortSignal;
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    text: () =>
                        new Promise((_resolve, reject) => {
                            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                        }),
                });
            });
            const caught = me().catch((err) => err);
            await Promise.resolve();
            jest.advanceTimersByTime(30000);
            expect(await caught).toMatchObject({ code: 'timeout' });
        } finally {
            jest.useRealTimers();
        }
    });
    test('preview defaults posts the job without server fields', async () => {
        const fetch = mockFetch(200, { scheduled_time: 1700000000 });
        await expect(previewDefaults(job())).resolves.toEqual({ scheduled_time: 1700000000 });
        const [url, init] = fetch.mock.calls[0] as FetchCall;
        expect(url).toBe('/en-US/splunkd/__raw/services/orchestrator/preview/defaults?output_mode=json');
        expect(init.method).toBe('POST');
        const sent = JSON.parse(init.body as string);
        expect(sent.job.name).toBe('Daily summary');
        expect(sent.job).not.toHaveProperty('permissions');
    });

    test('start preview sends the request and returns started or skipped', async () => {
        const fetch = mockFetch(201, { status: 'started', sid: 'so_preview_x', spl: '| makeresults' });
        const input = { mode: 'live' as const, previews: { a: { sid: 's1' }, b: { skipped: 'run_when' as const } } };
        await expect(
            startPreview({ job: job(), step_id: 'daily', scheduled_time: 100, params: { p: '1' }, input, anyway: true })
        ).resolves.toEqual({ status: 'started', sid: 'so_preview_x', spl: '| makeresults' });
        const [url, init] = fetch.mock.calls[0] as FetchCall;
        expect(url).toBe('/en-US/splunkd/__raw/services/orchestrator/preview?output_mode=json');
        expect(init.method).toBe('POST');
        const sent = JSON.parse(init.body as string);
        expect(sent).toMatchObject({ step_id: 'daily', scheduled_time: 100, params: { p: '1' }, input, anyway: true });
        expect(sent.job).not.toHaveProperty('owner');

        mockFetch(200, { status: 'skipped', skip_kind: 'run_when', reason: 'r' });
        await expect(
            startPreview({ job: job(), step_id: 'daily', scheduled_time: 100, params: {}, input: { mode: 'run', run_id: 'r1' } })
        ).resolves.toEqual({ status: 'skipped', skip_kind: 'run_when', reason: 'r' });
    });

    test('preview errors carry steps and step', async () => {
        mockFetch(409, { error: { code: 'needs_preview', message: 'preview a, b first', issues: [], steps: ['a', 'b'] } });
        const req = { job: job(), step_id: 'c', scheduled_time: 1, params: {}, input: { mode: 'live' as const, previews: {} } };
        const first = await startPreview(req).catch((e) => e);
        expect(first).toBeInstanceOf(ApiError);
        expect(first.code).toBe('needs_preview');
        expect(first.extra.steps).toEqual(['a', 'b']);

        mockFetch(410, { error: { code: 'run_results_expired', message: 'gone', issues: [], step: 'a' } });
        const second = await startPreview(req).catch((e) => e);
        expect(second.status).toBe(410);
        expect(second.extra.step).toBe('a');
    });

    test('preview status, results and cancel use the sid', async () => {
        const sid = 'so_preview_abcdef12.new.daily.r1';
        let fetch = mockFetch(200, { state: 'done', result_count: 3, error: null, truncated: null, run_duration: 0.4, messages: [] });
        await expect(previewStatus(sid, 120)).resolves.toMatchObject({ state: 'done', result_count: 3 });
        let [url, init] = fetch.mock.calls[0] as FetchCall;
        expect(url).toBe(`/en-US/splunkd/__raw/services/orchestrator/preview/${sid}?limit=120&output_mode=json`);
        expect(init.method).toBe('GET');

        fetch = mockFetch(200, { fields: ['n'], rows: [{ n: '1' }], total: 1 });
        await expect(previewResults(sid)).resolves.toEqual({ fields: ['n'], rows: [{ n: '1' }], total: 1 });
        [url] = fetch.mock.calls[0] as FetchCall;
        expect(url).toBe(`/en-US/splunkd/__raw/services/orchestrator/preview/${sid}/results?output_mode=json`);

        fetch = mockFetch(200, { cancelled: true });
        await expect(cancelPreview(sid)).resolves.toEqual({ cancelled: true });
        [url, init] = fetch.mock.calls[0] as FetchCall;
        expect(url).toBe(`/en-US/splunkd/__raw/services/orchestrator/preview/${sid}/cancel?output_mode=json`);
        expect(init.method).toBe('POST');
    });
});
