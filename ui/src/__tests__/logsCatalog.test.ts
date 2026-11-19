import { describe as describeLine, eventLabel, explainError } from '../features/logs/catalog';
import { describeRequest, routeName, routeParts } from '../features/logs/requests';
import { explainGap, fold } from '../features/logs/RunStory';
import { tiles } from '../features/logs/Overview';
import type { LogLine } from '../api/logs';

const names = { daily: { name: 'Daily logins', steps: { a: 'Count logins', b: 'Score' } } };
const line = (event: string, fields: Record<string, string> = {}, extra: Partial<LogLine> = {}): LogLine => ({
    event,
    level: 'INFO',
    process: 'engine',
    job_id: 'daily',
    run_id: 'daily:cron:1',
    step_id: fields.step_id,
    fields: { event, ...fields },
    ...extra,
});

describe('log catalog', () => {
    test('run and step events read as sentences with names and tones', () => {
        expect(describeLine(line('run_created', { trigger: 'cron', catchup: 'true' }), names).title).toBe('New run queued on schedule, catching up a missed slot for Daily logins');
        const failed = describeLine(line('run_state', { from: 'running', to: 'failed' }), names);
        expect([failed.title, failed.tone, failed.result]).toEqual(['Run failed: Daily logins', 'error', 'running → failed']);
        expect(describeLine(line('step_state', { step_id: 'a', to: 'skipped', skip_kind: 'not_taken' }), names).title).toBe('Step Count logins skipped: the line into it was not taken');
        const done = describeLine(line('step_attempt', { step_id: 'a', outcome: 'succeeded', result_count: '1204', scan_count: '50000', run_duration: '3.25' }), names);
        expect(done.title).toBe('Search for step Count logins finished: 1 204 results, 50 000 events scanned');
        expect(done.result).toBe('3.3 s');
    });

    test('known failures say why and what to do', () => {
        const d = describeLine(line('step_dispatch_error', { step_id: 'b', error: "Error in 'eval' command: bad", dispatch_errors: '2' }), names);
        expect(d.title).toBe("Could not start the search for step Score: Error in 'eval' command: bad");
        expect(d.why).toMatch(/SPL has an error/);
        expect(d.fix).toMatch(/Preview/);
        expect(describeLine(line('run_rejected', { reason: 'queue_cap', queue_cap: '20' }), names).fix).toMatch(/Queue cap/);
        expect(explainError('HTTP 401 Unauthorized', 'action').fix).toMatch(/destination/);
        expect(explainError('')).toEqual({});
    });

    test('approvals, commands and free-text warnings', () => {
        expect(describeLine(line('approval_decided', { step_id: 'a', decision: 'reject', user: 'bob', comment: 'not now' }), names).title).toBe('bob rejected step Count logins: “not now”');
        const refused = describeLine(line('command', { command: 'pause', result: 'rejected', detail: 'cannot pause a succeeded run' }), names);
        expect(refused.title).toBe('Engine refused to pause the run: cannot pause a succeeded run');
        expect(refused.tone).toBe('warning');
        const free = describeLine({ level: 'WARNING', process: 'engine', message: 'status of search scheduler__x failed: timed out', raw: '' }, names);
        expect(free.title).toBe('Could not read the status of search scheduler__x: timed out');
        expect(free.why).toMatch(/tries again/);
        expect(describeLine({ level: 'ERROR', process: 'engine', message: 'something odd', raw: '' }).tone).toBe('error');
        expect(describeLine(line('brand_new_thing', { error: 'HTTP 503' })).title).toBe('Brand new thing: HTTP 503');
        expect(eventLabel('step_attempt')).toBe('Searches finished');
    });

    test('requests become actions with outcomes', () => {
        expect(routeParts('/servicesNS/nobody/search_orchestrator/orchestrator_jlh/runs/a%3Ab/approve')).toEqual(['runs', 'a:b', 'approve']);
        expect(routeName('/orchestrator/jobs/daily/runs')).toBe('jobs/<id>/runs');
        expect(routeName('/orchestrator/preview/abc123/results')).toBe('preview/<sid>/results');
        const saved = describeRequest({ method: 'PUT', path: '/orchestrator/jobs/daily', status: '200', ms: '1234', user: 'alice' }, names);
        expect([saved.title, saved.result, saved.tone]).toEqual(['alice saved Daily logins', '200 OK · 1.2 s', 'ok']);
        const denied = describeRequest({ method: 'POST', path: '/orchestrator/jobs/daily/runs', status: '403', user: 'dave', error: 'you may not run job' }, names);
        expect(denied.title).toBe('dave started Daily logins now — you may not run job');
        expect(denied.tone).toBe('warning');
        expect(denied.why).toMatch(/capability/);
        expect(describeRequest({ method: 'GET', path: '/orchestrator/runs', status: '500' }, names).tone).toBe('error');
        expect(describeRequest({ method: 'GET', path: '/orchestrator/runs', status: '200', ms: '6000' }, names).tone).toBe('warning');
    });

    test('run story folds repeated checks and explains gaps', () => {
        const checks = [line('search_status', { step_id: 'a', state: 'running' }), line('search_status', { step_id: 'a', state: 'running' }), line('search_status', { step_id: 'a', state: 'done' })];
        const items = fold(checks, names);
        expect(items.map((i) => i.repeats)).toEqual([2, 1]);
        expect(explainGap(line('step_dispatched', { step_id: 'a' }), line('step_attempt', { step_id: 'a' }), 45, names).text).toBe('the search for step Count logins was running');
        expect(explainGap(line('approval_requested', { step_id: 'b' }), line('approval_decided', { step_id: 'b' }), 600, names).text).toBe('waiting for someone to approve step Score');
    });

    test('tiles without data show dashes; a stopped engine is an error', () => {
        expect(tiles(null, null, 0).every((x) => x.value === '—')).toBe(true);
        const stopped = tiles({ engine: { running: false, last_seen: 100 }, totals: { error: 0, warning: 0, info: 0, debug: 0, requests: 0, req_4xx: 0, req_5xx: 0, actions_failed: 0, actions_done: 0, runs_failed: 0, runs_succeeded: 0, steps_failed: 0, engine: 0, rest: 0 }, buckets: [] } as never, null, 400);
        expect(stopped[0]).toMatchObject({ value: 'Stopped', tone: 'error', sub: 'last tick 5m ago' });
    });
});
