import { ApiError, listRuns, me, startRun, updateJob, validateJob } from '../api/client';
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
});
