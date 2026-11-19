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

describe('lines from a live instance', () => {
    const real = (raw: Record<string, string>): LogLine => ({ event: raw.event, level: 'WARNING', process: 'engine', job_id: raw.job_id, run_id: raw.run_id, step_id: raw.step_id, fields: raw });

    test('an email that cannot reach a mail server points at Splunk email settings', () => {
        const d = describeLine(
            real({ event: 'action_failed', action_type: 'email', attempts: '4', hook: 'on_approval_requested', error: 'action search failed: command="sendemail", [Errno 111] Connection refused while sending mail to: you@example.com' }),
            names
        );
        expect(d.title).toMatch(/^Email failed after 4 tries: action search failed/);
        expect(d.why).toMatch(/mail server/);
        expect(d.fix).toMatch(/Email settings/);
    });

    test('a Start job action whose job is gone, a retry and an applied approval', () => {
        const gone = describeLine(real({ event: 'action_failed', action_type: 'start_job', attempts: '1', error: "job 'example_hourly_errors' does not exist" }), names);
        expect(gone.title).toBe("Start job failed after 1 tries: job 'example_hourly_errors' does not exist");
        expect(gone.why).toMatch(/does not exist/);
        const retry = describeLine(real({ event: 'action_retry', action_type: 'email', attempts: '2', hook: 'on_complete', error: 'x' }), names);
        expect(retry.tone).toBe('warning');
        expect(describeLine(real({ event: 'action_submitted', hook: 'on_approval_requested', scope: 'job' }), names).title).toBe('Actions queued to run when it asks for approval');
        const applied = describeLine({ ...real({ event: 'command', command: 'approve', result: 'ok', user: 'admin', step_id: 'a', job_id: 'daily' }), level: 'INFO', job_id: 'daily', step_id: 'a' }, names);
        expect(applied.title).toBe('Engine applied admin’s approval decision for step Count logins');
        expect(applied.tone).toBe('ok');
    });
});

describe('why a job did not start', () => {
    const ev = (event: string, fields: Record<string, string>): LogLine => ({ event, level: 'INFO', process: 'engine', job_id: 'daily', fields: { event, ...fields } });

    test('skipped and missed schedules say why and what to do', () => {
        const skipped = describeLine(ev('schedule_skipped', { reason: 'disabled', scheduled_time: '1763542800' }), names);
        expect(skipped.title).toMatch(/^Scheduled run of Daily logins at .* skipped: the job is disabled$/);
        expect(skipped.fix).toMatch(/Backfill/);
        const missed = describeLine(ev('schedule_missed', { missed: '30', at_least: 'false', seconds: '2595600', since: '1763542800', policy: 'latest', caught_up: '1', catchup_cap: '7' }), names);
        expect(missed.title).toBe('Daily logins missed 30 scheduled runs: nothing checked the schedule for 30 days');
        expect(missed.why).toMatch(/Missed runs setting \(Run only the latest missed time\) ran only the latest one/);
        expect(missed.result).toBe('1 caught up');
    });

    test('waits in the queue, for a search slot, and downstream jobs', () => {
        expect(describeLine(ev('run_waiting', { reason: 'held', by_run: 'daily:cron:1' }), names).fix).toMatch(/Re-run or Dismiss/);
        expect(describeLine(ev('run_waiting', { reason: 'waiting_for_run', by_run: 'daily:cron:1', by_state: 'running' }), names).title).toBe('Run of Daily logins waits for run daily:cron:1 to finish (running)');
        const slot = describeLine({ ...ev('step_waiting', { reason: 'search_slots', running: '10', max_searches: '10', running_for_job: '2', max_searches_per_job: '4' }), step_id: 'a' }, names);
        expect(slot.title).toBe('Step Count logins is ready but waits for a free search slot');
        expect(slot.result).toBe('2/4 for the job · 10/10 in all');
        expect(describeLine(ev('completion_not_fired', { target_job: 'daily', reason: 'outcome', on: 'failure', outcome: 'succeeded' }), names).title).toBe('Daily logins was not started: it starts when this job fails, and this run succeeded');
        expect(eventLabel('schedule_skipped,schedule_missed')).toBe('Schedules skipped (job disabled) or Schedules missed (engine not checking)');
    });
});

describe('heartbeats and actions on many runs', () => {
    const ev = (event: string, fields: Record<string, string>, user?: string): LogLine => ({ event, level: 'INFO', process: user ? 'rest' : 'engine', fields: { event, ...fields, ...(user ? { user } : {}) } });

    test('the heartbeat reads as alive and is quiet', () => {
        const beat = describeLine(ev('heartbeat', { ticks: '60', slowest_ms: '42', active_runs: '2', jobs: '5' }), names);
        expect([beat.title, beat.tone, beat.result]).toEqual(['Engine is alive: 60 ticks in the last 5 minutes, the slowest 42 ms', 'muted', '2 active runs']);
        expect(eventLabel('heartbeat')).toBe('Engine heartbeats');
    });

    test('bulk actions say how many and whether some were left', () => {
        expect(describeLine(ev('bulk_run_action', { action: 'rerun', count: '4', failed: '0' }, 'alice'), names).title).toBe('alice chose Re-run for 4 runs at once on the Runs page');
        const partly = describeLine(ev('bulk_run_action', { action: 'cancel', count: '3', failed: '1' }, 'alice'), names);
        expect([partly.tone, partly.title]).toEqual(['warning', 'alice chose Cancel for 3 runs at once on the Runs page; 1 could not be changed']);
    });
});

describe('app health alerts in Settings', () => {
    test('the app id comes from the page URL, so the test copy links to its own alerts', () => {
        const { appId } = jest.requireActual('../features/settings/HealthPanel');
        expect(appId('/en-US/app/search_orchestrator_jlh/settings')).toBe('search_orchestrator_jlh');
        expect(appId('/')).toBe('search_orchestrator');
    });
});
