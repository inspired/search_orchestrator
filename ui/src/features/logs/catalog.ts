/* What a log line means, in words: every event the app writes (bin/so/logs.py mirrors each
 * audit event; the engine and REST handler add their own) gets a category, a tone, a
 * sentence, who did it, its result and, for known failures, why it happened and what to do.
 * Pure, so it can be tested without rendering. */
import type { LogLine, LogNames } from '../../api/logs';
import { describeRequest } from './requests';

export type Category = 'run' | 'step' | 'condition' | 'action' | 'approval' | 'job' | 'engine' | 'api' | 'splunk' | 'backfill' | 'settings' | 'other';
export type Tone = 'error' | 'warning' | 'ok' | 'info' | 'muted';

export const CATEGORY_LABEL: Record<Category, string> = {
    run: 'Run',
    step: 'Step',
    condition: 'Condition',
    action: 'Action',
    approval: 'Approval',
    job: 'Job',
    engine: 'Engine',
    api: 'Screens and API',
    splunk: 'Splunk call',
    backfill: 'Backfill',
    settings: 'Settings',
    other: 'Other',
};

export interface Described {
    category: Category;
    tone: Tone;
    title: string;
    /** The person, or "engine" / "the app". */
    who: string;
    /** A short outcome, such as "202 accepted · 168 ms". */
    result?: string;
    why?: string;
    fix?: string;
}

type F = Record<string, string | undefined>;

export function jobName(names: LogNames, jobId?: string): string {
    if (!jobId) {
        return '';
    }
    return (names[jobId] && names[jobId].name) || jobId;
}

export function stepName(names: LogNames, jobId?: string, stepId?: string): string {
    if (!stepId) {
        return '';
    }
    const j = jobId ? names[jobId] : undefined;
    return (j && j.steps && j.steps[stepId]) || stepId;
}

const STATE_WORD: Record<string, string> = {
    queued: 'queued',
    running: 'running',
    succeeded: 'succeeded',
    failed: 'failed',
    cancelled: 'cancelled',
    blocked: 'blocked',
    paused: 'paused',
    waiting: 'waiting',
    ready: 'ready to start',
    starting: 'starting',
    retrying: 'going to retry',
    skipped: 'skipped',
    awaiting_approval: 'waiting for approval',
};

const SKIP_WORD: Record<string, string> = {
    not_taken: 'the line into it was not taken',
    run_when: 'its run-when condition was false',
    not_started: 'the trigger does not start it',
    fallback: 'a fallback path was used',
    action: 'only its action ran',
};

const HOOK_WORD: Record<string, string> = {
    on_success: 'when it succeeds',
    on_failure: 'when it fails',
    on_complete: 'when it finishes',
    on_delayed: 'when it is delayed',
    on_late: 'when it misses its deadline',
    on_start: 'when it starts',
    on_approval_requested: 'when it asks for approval',
    on_approval_decided: 'when an approval is decided',
};

const ACTION_WORD: Record<string, string> = {
    email: 'Email',
    webhook: 'Webhook',
    slack: 'Slack message',
    event: 'Event',
    lookup: 'Lookup',
    summary_index: 'Summary index',
    alert_action: 'Alert action',
    start_job: 'Start job',
    fallback: 'Fallback notification',
};

const TRIGGER_WORD: Record<string, string> = {
    cron: 'on schedule',
    manual: 'started by hand',
    completion: 'chained from another job',
    backfill: 'by a backfill',
    start_job: 'by a Start job action',
    alert: 'by an alert',
    selftest: 'by the self-test',
};

const COMMAND_WORD: Record<string, string> = {
    approve: 'decide an approval in',
    pause: 'pause',
    resume: 'resume',
    cancel: 'cancel',
    dismiss: 'dismiss',
    rerun: 're-run',
    cancel_backfill: 'cancel the backfill of',
};

const BULK_WORD: Record<string, string> = { cancel: 'Cancel', rerun: 'Re-run', approve: 'Approve', reject: 'Reject', pause: 'Pause', resume: 'Resume', dismiss: 'Dismiss' };

function secs(ms?: string): string {
    const n = Number(ms);
    if (!ms || Number.isNaN(n)) {
        return '';
    }
    return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`;
}

function num(v?: string): string {
    const n = Number(v);
    return v === undefined || Number.isNaN(n) ? '' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** The job editor's names for the Missed runs setting (catchup). */
const MISSED_RUNS: Record<string, string> = {
    all: 'Run each missed time (up to 7)',
    latest: 'Run only the latest missed time',
    none: 'Skip missed times',
};

function slotTime(epoch?: string): string {
    const n = Number(epoch);
    if (!epoch || Number.isNaN(n)) {
        return '?';
    }
    return new Date(n * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function spanText(seconds: number): string {
    const s = Math.round(seconds);
    if (s < 3600) {
        return `${Math.round(s / 60)} min`;
    }
    if (s < 2 * 86400) {
        const h = Math.floor(s / 3600);
        const m = Math.round((s % 3600) / 60);
        return `${h}h${m ? ` ${m}m` : ''}`;
    }
    return `${Math.round(s / 86400)} days`;
}

/** Why a failure happened and what to do, from its error text. */
export function explainError(error?: string, context: 'action' | 'search' | 'any' = 'any'): { why?: string; fix?: string } {
    const e = error || '';
    if (!e) {
        return {};
    }
    const rules: Array<[RegExp, string, string]> = [
        [/sendemail|smtp|while sending mail/i, 'Splunk could not send the email: its mail server is not set up or not reachable.', 'Set the mail host in Splunk (Settings → Server settings → Email settings) and check that Splunk can reach it.'],
        [/HTTP 401|unauthori[sz]ed/i, 'The other side rejected the credentials.', 'Check the destination’s URL token or headers in Settings → Webhook destinations.'],
        [/HTTP 403|forbidden|not allowed|permission/i, 'The account used is not allowed to do this.', 'Check the job owner’s roles and capabilities, or the target’s permissions.'],
        [/HTTP 404|not found|does not exist|unknown index/i, 'The target does not exist (a URL, saved search, lookup or index).', context === 'action' ? 'Check the action’s target: the destination URL, lookup name or index.' : 'Check the name in the step or action; it may have been renamed or deleted.'],
        [/HTTP 429|rate limit/i, 'The other side is rate limiting.', 'Send fewer messages, or let the retries finish.'],
        [/HTTP 5\d\d/i, 'The other side failed while handling it. This is usually temporary.', 'The app retries; if it keeps failing, check the receiving service.'],
        [/timed? ?out|timeout/i, 'No answer came in time.', 'Usually temporary. If it repeats, check that Splunk or the target is not overloaded.'],
        [/connection (error|refused|reset)|could not be reached|name or service not known/i, 'The app could not connect.', 'Check the host name and that the service is up and reachable from Splunk.'],
        [/concurren|quota|too many searches|max(imum)? number of/i, 'Splunk’s search limit for the user or the server was reached.', 'Lower Searches at once in Settings, or raise the role’s search quota.'],
        [/Error in '|Unknown search command|parse|syntax/i, 'The step’s SPL has an error.', 'Open the job and use Preview on the step to see Splunk’s message.'],
        [/expired|reaped|no longer exists/i, 'The search job was removed before the engine read it (it expired or was deleted).', 'Raise Keep step results in Settings, or check for something deleting search jobs.'],
        [/finalized/i, 'Someone stopped the search early outside the app, so its results may be incomplete.', 'Re-run the step.'],
        [/chain depth/i, 'Jobs starting jobs went deeper than the chain limit (a loop is likely).', 'Check the Start job actions and completion triggers for a loop.'],
        [/cut short|truncated/i, 'A subsearch hit its limit, so the input was cut short.', 'Narrow the earlier step, or raise the subsearch limits.'],
    ];
    for (const [re, why, fix] of rules) {
        if (re.test(e)) {
            return { why, fix };
        }
    }
    return {};
}

const MESSAGE_RULES: Array<[RegExp, Category, Tone, (m: RegExpMatchArray) => string, string?, string?]> = [
    [/lease lost/i, 'engine', 'warning', () => 'Another engine took over during the tick', 'On a cluster another member got the engine lease, so this one stopped mid-tick.', 'Nothing to do unless it repeats often; then check that only one engine input is enabled.'],
    [/tick skipped \((\w+)\): (.*)/i, 'engine', 'warning', (m) => `Engine skipped a tick: ${m[2]}`, 'Splunk did not answer the engine (KV Store or search).', 'Usually temporary. If it repeats, check splunkd and KV Store health.'],
    [/status of search (\S+) failed: (.*)/i, 'step', 'warning', (m) => `Could not read the status of search ${m[1]}: ${m[2]}`, 'Splunk did not answer when the engine checked the search. It tries again next tick.', 'Only act if it repeats for the same search.'],
    [/results of search (\S+) failed: (.*)/i, 'step', 'warning', (m) => `Could not read the first row of search ${m[1]}: ${m[2]}`, 'The engine reads the first row for tokens; Splunk did not answer.', 'It tries again next tick.'],
    [/cancel of search (\S+) kept failing/i, 'step', 'error', (m) => `Gave up cancelling search ${m[1]}`, 'Splunk kept refusing the cancel.', 'Check Activity → Jobs in Splunk and stop the search by hand.'],
    [/(\w+) of search (\S+) failed: (.*)/i, 'step', 'warning', (m) => `Could not ${m[1]} search ${m[2]}: ${m[3]}`],
    [/history of (\S+) failed: (.*)/i, 'step', 'warning', (m) => `Could not look up earlier searches of ${m[1]}: ${m[2]}`, 'After a restart the engine looks for searches it may already have started.', 'It tries again next tick.'],
    [/run (\S+) skipped this tick: (.*)/i, 'run', 'warning', (m) => `Run ${m[1]} was skipped this tick: ${m[2]}`, 'Something failed while advancing this run; the others continued.', 'It tries again next tick; check the error if it repeats.'],
    [/run (\S+) skipped this tick/i, 'run', 'error', (m) => `Run ${m[1]} was skipped this tick because of an error`, 'An unexpected error happened while advancing the run (see the traceback).', 'Report the traceback; the engine tries again next tick.'],
    [/command (\S+) failed/i, 'engine', 'error', (m) => `A command from the screens (${m[1]}) failed`, 'The engine could not apply a pause, resume, cancel, re-run or approval (see the traceback).', 'Try the action again; report the traceback if it repeats.'],
    [/audit event lost/i, 'engine', 'error', () => 'An audit event could not be written to the audit index', 'The index may be missing, or the writer could not reach splunkd.', 'Check that the orchestrator index exists (Settings → Indexes).'],
    [/session key/i, 'engine', 'warning', (m) => m.input || 'Session key problem', 'The engine’s Splunk session expired.', 'The engine reloads it by itself; splunkd restarts the engine if that fails.'],
    [/request failed/i, 'api', 'error', () => 'A request failed with an internal error', 'An unexpected error in the REST handler (see the traceback).', 'Report the traceback.'],
];

function describeMessage(line: LogLine): Described {
    const msg = line.message || line.raw || '';
    for (const [re, category, tone, title, why, fix] of MESSAGE_RULES) {
        const m = msg.match(re);
        if (m) {
            return { category, tone: line.level === 'ERROR' ? 'error' : tone, title: title(m), who: line.process === 'rest' ? 'the app' : 'engine', why, fix };
        }
    }
    const tone: Tone = line.level === 'ERROR' || line.level === 'CRITICAL' ? 'error' : line.level === 'WARNING' ? 'warning' : 'muted';
    return { category: line.process === 'rest' ? 'api' : 'engine', tone, title: msg.split('\n')[0] || '(empty line)', who: line.process === 'rest' ? 'the app' : 'engine' };
}

/** The meaning of one line. */
export function describe(line: LogLine, names: LogNames = {}): Described {
    const f: F = (line.fields || {}) as F;
    const ev = line.event || f.event;
    if (!ev) {
        return describeMessage(line);
    }
    const job = jobName(names, line.job_id || f.job_id);
    const step = stepName(names, line.job_id || f.job_id, line.step_id || f.step_id);
    const user = f.user;
    const engine = 'engine';
    const err = f.error;
    const levelTone: Tone = line.level === 'ERROR' ? 'error' : line.level === 'WARNING' ? 'warning' : 'info';
    const d = (category: Category, tone: Tone, title: string, extra: Partial<Described> = {}): Described => ({
        category,
        tone: line.level === 'ERROR' ? 'error' : tone,
        title,
        who: user || (line.process === 'engine' ? engine : 'the app'),
        ...extra,
    });

    switch (ev) {
        case 'request':
            return describeRequest(f, names, line.level);
        case 'tick':
            return d('engine', 'muted', `Engine tick: ${num(f.active_runs) || 0} active run${f.active_runs === '1' ? '' : 's'}, ${num(f.jobs) || 0} jobs`, { result: secs(f.ms) });
        case 'search_status': {
            const state = f.state || 'unknown';
            return d('step', state === 'failed' ? 'warning' : 'muted', `Checked the search of step ${step}: ${state}${f.result_count ? `, ${num(f.result_count)} results so far` : ''}`);
        }
        case 'splunkd_call':
            return d('splunk', f.error ? 'warning' : 'muted', `Splunk call ${f.method || ''} ${f.path || ''}`.trim(), {
                result: [f.status, secs(f.ms)].filter(Boolean).join(' · ') + (f.error ? ` · ${f.error}` : ''),
            });
        case 'engine_started':
            return d('engine', 'ok', `Engine started on ${f.holder || 'this server'} (ticks every ${f.tick_seconds || 5} s)`);
        case 'engine_stopped':
            return d('engine', 'warning', 'Engine stopped', { why: 'splunkd stopped or restarted the engine input.', fix: 'It starts again with splunkd; if not, check Settings → Data inputs → orchestrator_engine.' });
        case 'standby':
            return d('engine', 'info', 'This engine is on standby: another one holds the lease', { why: 'Only one engine works at a time (on a cluster, the lease holder).' });
        case 'lease_acquired':
            return d('engine', 'ok', `Engine took the lease on ${f.holder || 'this server'} and is now working`);
        case 'heartbeat':
            return d('engine', 'muted', `Engine is alive: ${num(f.ticks)} ticks in the last 5 minutes, the slowest ${num(f.slowest_ms)} ms`, { result: `${num(f.active_runs)} active runs`, why: 'The engine says this every 5 minutes. The app health alert Search Orchestrator - Engine not running fires when it stops.' });
        case 'waiting_for_kvstore':
            return d('engine', 'info', 'Engine waits for KV Store to finish starting', { why: 'Right after Splunk starts, KV Store answers \u201cinitializing\u201d for a minute or so; the engine tries again every tick.' });
        case 'ticks_resumed':
            return d('engine', 'ok', `Engine is working again after ${num(f.skipped)} skipped tick${f.skipped === '1' ? '' : 's'} (${spanText(Number(f.seconds) || 0)})`, { result: f.reason });
        case 'lease_not_released':
            return d('engine', 'muted', `Engine could not hand back its lease while stopping; it expires in ${f.expires_in || 90} s`, { why: 'splunkd was already shutting down. The next engine takes over when the lease expires (at once if it is the same server).' });
        case 'tick_failed':
            return d('engine', 'error', 'An engine tick failed', { why: 'An unexpected error stopped this tick (see the traceback). The next tick runs as usual.', fix: 'Report the traceback if it repeats.' });
        case 'request_failed':
            return d('api', 'error', `Request ${f.method || ''} ${f.path || ''} failed with an internal error`.trim(), { why: 'An unexpected error in the REST handler (see the traceback).', fix: 'Report the traceback.' });

        case 'run_created':
            return d('run', 'info', `New run queued ${TRIGGER_WORD[f.trigger || ''] || `(${f.trigger || 'unknown trigger'})`}${f.catchup === 'true' ? ', catching up a missed slot' : ''}${job ? ` for ${job}` : ''}`);
        case 'schedule_skipped':
            return d('run', 'warning', `Scheduled run of ${job} at ${slotTime(f.scheduled_time)} skipped: the job is disabled`, {
                why: 'A disabled job does not run its schedule, and does not catch the slot up when enabled again.',
                fix: 'Enable the job on the Jobs page. To run the skipped time, use Backfill.',
            });
        case 'schedule_missed': {
            const n = `${f.at_least === 'true' ? 'at least ' : ''}${num(f.missed)}`;
            const gap = f.seconds ? spanText(Number(f.seconds)) : 'a while';
            return d('run', 'warning', `${job} missed ${n} scheduled run${f.missed === '1' ? '' : 's'}: nothing checked the schedule for ${gap}`, {
                result: f.caught_up && f.caught_up !== '0' ? `${f.caught_up} caught up` : 'none caught up',
                why: `The engine was stopped or on standby from ${slotTime(f.since)}. When it came back, the job’s Missed runs setting (${MISSED_RUNS[f.policy || 'all'] || f.policy}) ran ${f.policy === 'latest' ? 'only the latest one' : f.policy === 'none' ? 'none of them' : `the latest ${f.catchup_cap || 7}`}.`,
                fix: 'Check why the engine stopped (Engine value and graph). Use Backfill to run the missed times, or change Missed runs on the job’s Settings tab.',
            });
        }
        case 'run_waiting': {
            const by = f.by_run ? ` ${f.by_run}` : '';
            if (f.reason === 'held') {
                return d('run', 'warning', `Run of ${job} waits: a failed run${by} is holding the job`, {
                    why: 'The job holds its later runs after a run gives up, so nothing runs out of order.',
                    fix: 'Open the failed run and Re-run or Dismiss it.',
                });
            }
            if (f.reason === 'waiting_for_run') {
                return d('run', 'info', `Run of ${job} waits for run${by} to finish (${STATE_WORD[f.by_state || ''] || f.by_state || 'running'})`, {
                    why: 'A job runs one run at a time; the next one starts when this one ends.',
                });
            }
            return d('run', 'info', `Run of ${job} waits its turn behind run${by}`, { why: 'Queued runs of a job start one after another, oldest scheduled time first.' });
        }
        case 'step_waiting':
            return d('step', 'warning', `Step ${step} is ready but waits for a free search slot`, {
                result: `${f.running_for_job || '?'}/${f.max_searches_per_job || '?'} for the job · ${f.running || '?'}/${f.max_searches || '?'} in all`,
                why: 'The search limits in Settings are full: Searches at once, or Searches at once per job.',
                fix: 'It starts when a search ends. If this happens often, raise the limits in Settings.',
            });
        case 'completion_not_fired':
            if (f.reason === 'disabled') {
                return d('run', 'warning', `${jobName(names, f.target_job)} was not started after this run: it is disabled`, { fix: 'Enable it on the Jobs page if it should follow this job.' });
            }
            return d('run', 'info', `${jobName(names, f.target_job)} was not started: it starts when this job ${f.on === 'failure' ? 'fails' : f.on === 'complete' ? 'finishes' : 'succeeds'}, and this run ${f.outcome || 'ended'}`);
        case 'run_requested':
            return d('run', 'info', `${user || 'Someone'} started ${job || 'a job'} by hand`);
        case 'run_rejected':
            if (f.reason === 'queue_cap') {
                return d('run', 'warning', `No new run for ${job}: its queue is full (${f.queue_cap || '?'} runs waiting)`, {
                    why: 'More runs were waiting for this job than Queue cap per job allows, so the new one was dropped.',
                    fix: 'Let the waiting runs finish, find why they wait (a held run?), or raise Queue cap per job in Settings.',
                });
            }
            return d('run', 'warning', `No new run for ${job}: the schedule’s parameters are invalid${err ? ` (${err})` : ''}`, {
                why: 'A scheduled run uses the parameters’ defaults, and one is missing or not allowed.',
                fix: 'Give every parameter a valid default in the job.',
            });
        case 'run_state': {
            const to = f.to || '';
            const tone: Tone = to === 'failed' ? 'error' : to === 'succeeded' ? 'ok' : to === 'blocked' ? 'warning' : 'info';
            const words: Record<string, string> = { running: 'Run started', succeeded: 'Run succeeded', failed: f.gave_up === 'true' ? 'Run gave up' : 'Run failed', cancelled: 'Run cancelled', blocked: 'Run is blocked', paused: 'Run paused', queued: 'Run queued again' };
            return d('run', tone, `${words[to] || `Run is now ${STATE_WORD[to] || to}`}${job ? `: ${job}` : ''}`, {
                result: f.from ? `${STATE_WORD[f.from] || f.from} → ${STATE_WORD[to] || to}` : undefined,
                ...(f.gave_up === 'true' ? { why: 'A step kept waiting longer than its give-up time.', fix: 'See which step waited in the run, and its give-up setting.' } : {}),
            });
        }
        case 'run_held':
            return d('run', 'warning', `Run is holding ${job}: later runs wait until it is re-run or dismissed`, {
                why: 'The job is set to hold its later runs when one fails, so nothing runs out of order.',
                fix: 'Open the run and Re-run it, or Dismiss it to let the next runs go.',
            });
        case 'hold_alert':
            return d('run', 'warning', `Reminder: a failed run has held ${job} for ${f.days || '?'} day(s)`, { fix: 'Re-run or dismiss the run.' });
        case 'run_late':
            return d('run', 'warning', `Run of ${job} missed its deadline (still ${STATE_WORD[f.state || ''] || f.state || 'running'})`, {
                why: 'The job has a deadline and the run had not finished by then.',
                fix: 'Check which step is slow (Performance tab), or move the deadline.',
            });
        case 'run_dismissed':
            return d('run', 'info', `${user || 'Someone'} dismissed the failed run, so the next runs can go`);
        case 'runs_pruned':
            return d('engine', 'muted', `Removed ${num(f.count)} old run records (older than ${f.retention_days || '?'} days)`);

        case 'step_state': {
            const to = f.to || '';
            const tone: Tone = to === 'failed' ? 'error' : to === 'succeeded' ? 'ok' : to === 'awaiting_approval' ? 'warning' : to === 'skipped' ? 'muted' : 'info';
            let title = `Step ${step} is now ${STATE_WORD[to] || to}`;
            if (to === 'running') {
                title = `Step ${step} started`;
            } else if (to === 'succeeded') {
                title = `Step ${step} succeeded`;
            } else if (to === 'failed') {
                title = `Step ${step} failed${err ? `: ${err}` : ''}`;
            } else if (to === 'skipped') {
                title = `Step ${step} skipped${f.skip_kind && SKIP_WORD[f.skip_kind] ? `: ${SKIP_WORD[f.skip_kind]}` : ''}`;
            }
            return d('step', tone, title, { result: f.attempt && f.attempt !== '1' ? `attempt ${f.attempt}` : undefined, ...(to === 'failed' ? explainError(err, 'search') : {}) });
        }
        case 'step_dispatched':
            return d('step', 'info', `Search for step ${step} started`, { result: f.attempt && f.attempt !== '1' ? `attempt ${f.attempt}` : undefined });
        case 'step_attempt': {
            if (f.outcome === 'failed') {
                return d('step', 'error', `Search for step ${step} failed${err ? `: ${err}` : ''}`, explainError(err, 'search'));
            }
            const parts = [f.result_count !== undefined ? `${num(f.result_count)} results` : '', f.scan_count ? `${num(f.scan_count)} events scanned` : ''].filter(Boolean);
            return d('step', 'ok', `Search for step ${step} finished${parts.length ? `: ${parts.join(', ')}` : ''}`, { result: f.run_duration ? `${Number(f.run_duration).toFixed(1)} s` : undefined });
        }
        case 'step_dispatch_error':
            return d('step', 'error', `Could not start the search for step ${step}${err ? `: ${err}` : ''}`, {
                result: f.dispatch_errors ? `try ${f.dispatch_errors}` : undefined,
                ...(explainError(err, 'search').why ? explainError(err, 'search') : { why: 'Splunk refused to start the step’s saved search.', fix: 'Preview the step in the job to see Splunk’s message; the engine tries again.' }),
            });
        case 'step_delayed':
            return d('step', 'warning', `Step ${step} is delayed: still ${STATE_WORD[f.state || ''] || f.state || 'running'} past its delay limit`, {
                why: 'It has taken longer than the job’s Delayed after setting.',
                fix: 'Check whether the search is slow (Performance) or waits for a search slot.',
            });
        case 'step_adopted':
            return d('step', 'info', `Found step ${step}’s search already running after a restart, and picked it up`);
        case 'possible_orphan_search':
            return d('step', 'warning', `A search for step ${step} may have started but was never tracked`, {
                why: 'The engine stopped between starting the search and saving that it did.',
                fix: `Look in Activity → Jobs for ${f.hidden_search || 'the step search'} and stop it if it is still running.`,
            });

        case 'condition_dispatched':
            return d('condition', 'info', `Checking the condition on the line ${stepName(names, line.job_id, f.from_step)} → ${step}`);
        case 'condition_evaluated':
            return d('condition', f.result === 'true' ? 'ok' : 'muted', `Condition on ${stepName(names, line.job_id, f.from_step)} → ${step}: ${f.result === 'true' ? 'met, the line is taken' : 'not met, the line is not taken'}`, {
                result: f.result_count !== undefined ? `${num(f.result_count)} rows` : undefined,
            });
        case 'condition_failed':
            return d('condition', 'error', `Condition on ${stepName(names, line.job_id, f.from_step)} → ${step} could not be checked${err ? `: ${err}` : ''}`, explainError(err, 'search'));
        case 'condition_cancelled':
            return d('condition', 'muted', `Condition check on ${stepName(names, line.job_id, f.from_step)} → ${step} cancelled: the run ended first`);
        case 'condition_tested':
            return d('condition', 'muted', `${user || 'Someone'} tested a condition in the editor${job ? ` (${job})` : ''}`);

        case 'action_submitted':
            return d('action', 'info', `Actions queued to run ${HOOK_WORD[f.hook || ''] || f.hook || ''}${f.scope === 'step' && step ? ` (step ${step})` : ''}`);
        case 'action_done':
            return d('action', 'ok', `${ACTION_WORD[f.action_type || ''] || f.action_type || 'Action'} sent ${HOOK_WORD[f.hook || ''] || ''}${f.scope === 'step' && step ? ` for step ${step}` : ''}`.trim(), {
                result: f.attempts && f.attempts !== '1' ? `after ${f.attempts} tries` : undefined,
            });
        case 'action_retry':
            return d('action', 'warning', `${ACTION_WORD[f.action_type || ''] || 'Action'} failed, will retry${err ? `: ${err}` : ''}`, { result: f.attempts ? `try ${f.attempts}` : undefined, ...explainError(err, 'action') });
        case 'action_failed':
            return d('action', 'error', `${ACTION_WORD[f.action_type || ''] || 'Action'} failed${f.attempts ? ` after ${f.attempts} tries` : ''}${err ? `: ${err}` : ''}`, {
                ...(explainError(err, 'action').why ? explainError(err, 'action') : { why: 'The action kept failing, so the app gave up on it.', fix: 'Check the action’s settings; the fallback notification is sent if one is set.' }),
            });
        case 'chain_depth_exceeded':
            return d('action', 'error', `Did not start ${jobName(names, f.target_job)}: the chain of jobs starting jobs is too deep (limit ${f.limit || 10})`, explainError('chain depth'));
        case 'completion_fired':
            return d('run', 'info', `Started ${jobName(names, f.target_job)} because this run ${f.outcome || 'finished'}`);

        case 'step_scan_limit':
            return f.action === 'stop'
                ? d('step', 'error', `Search for step ${step || f.step_id || ''} stopped: it scanned ${num(f.scanned)} events, more than its limit of ${num(f.limit)}`, { why: 'The Events scanned limit (Settings, or the step\u2019s own) is set to stop searches that go over it.', fix: 'Narrow the search (index, sourcetype, time range), or raise the step\u2019s Events scanned limit.' })
                : d('step', 'warning', `Search for step ${step || f.step_id || ''} scanned ${num(f.scanned)} events, more than its limit of ${num(f.limit)}`, { why: 'The Events scanned limit is set to warn: the search was left to finish.', fix: 'Narrow the search, or raise the step\u2019s Events scanned limit if this is expected.' });
        case 'job_followed':
            return d('job', 'info', `${user || 'Someone'} follows ${job || 'the job'} (${(f.on || '').split(',').filter(Boolean).join(', ')}, by ${f.notify || 'email'})`);
        case 'job_unfollowed':
            return d('job', 'info', `${user || 'Someone'} stopped following ${job || 'the job'}`);
        case 'bulk_run_action': {
            const failed = Number(f.failed) || 0;
            return d('run', failed ? 'warning' : 'info', `${user || 'Someone'} chose ${BULK_WORD[f.action || ''] || f.action} for ${num(f.count)} runs at once on the Runs page${failed ? `; ${failed} could not be changed` : ''}`, failed ? { why: 'Each run is checked as if changed on its own: a run in the wrong state, or one the user may not run, is left as it is.' } : {});
        }
        case 'command_requested':
            return d('run', 'info', `${user || 'Someone'} asked the engine to ${COMMAND_WORD[f.command || ''] || f.command || 'act on'} the run${step ? ` (step ${step})` : ''}`, { result: 'applied on the next tick' });
        case 'command': {
            const ok = f.result !== 'rejected';
            const what = COMMAND_WORD[f.command || ''] || f.command || 'act on';
            const done: Record<string, string> = {
                approve: `Engine applied ${user ? `${user}\u2019s` : 'the'} approval decision${step ? ` for step ${step}` : ''}`,
                pause: 'Engine paused the run',
                resume: 'Engine resumed the run',
                cancel: 'Engine cancelled the run',
                dismiss: 'Engine dismissed the run',
                rerun: `Engine started the re-run${step ? ` from step ${step}` : ''}`,
                cancel_backfill: 'Engine cancelled the backfill',
            };
            const okTitle = (done[f.command || ''] || `Engine applied ${f.command || 'the command'}`) + (user && f.command !== 'approve' ? ` (asked by ${user})` : '');
            return d('run', ok ? 'ok' : 'warning', ok ? okTitle : `Engine refused to ${what} the run${f.detail ? `: ${f.detail}` : ''}`, {
                result: f.result,
                who: engine,
                ...(ok ? {} : { why: f.detail ? `The run’s state did not allow it: ${f.detail}.` : 'The run’s state did not allow it.', fix: 'Reload the run to see its current state.' }),
            });
        }
        case 'approval_requested':
            return d('approval', 'warning', `Step ${step} is waiting for approval${f.message ? `: “${f.message}”` : ''}`);
        case 'approval_decided': {
            const ok = f.decision === 'approve' || f.decision === 'approved';
            const by = f.by_timeout === 'true' ? 'Timed out:' : `${user || 'Someone'}`;
            return d('approval', ok ? 'ok' : 'warning', `${by} ${ok ? 'approved' : 'rejected'} step ${step}${f.comment ? `: “${f.comment}”` : ''}`);
        }
        case 'approval_ignored':
            return d('approval', 'muted', `An approval decision for step ${step} was ignored: the step was not waiting, or was already decided`);

        case 'job_saved':
            return d('job', 'info', `${user || 'Someone'} ${f.created === 'true' ? 'created' : 'saved'} ${job}`);
        case 'job_owner_changed':
            return d('job', 'info', `${job} changed owner from ${f.from || '?'} to ${f.to || '?'}`, { why: 'Saving someone else’s job makes you its owner; its searches then run as you.' });
        case 'job_enabled':
            return d('job', 'info', `${user || 'Someone'} ${f.enabled === 'true' ? 'enabled' : 'disabled'} ${job}`);
        case 'job_deleted':
            return d('job', 'warning', `${user || 'Someone'} deleted ${job}`);
        case 'job_version_saved':
            return d('job', 'muted', `Version ${f.version || ''} of ${job} saved${f.summary ? `: ${f.summary}` : ''}`);
        case 'job_versions_pruned':
            return d('job', 'muted', `Removed ${num(f.count)} old versions of ${job}`);
        case 'job_version_failed':
            return d('job', 'warning', `${job} was saved, but its version could not be stored${err ? `: ${err}` : ''}`, { fix: 'Save the job again to store a version.' });
        case 'job_restored':
            return d('job', 'info', `${user || 'Someone'} restored ${job} to version ${f.to_version || '?'}`);
        case 'hidden_search_delete_failed':
            return d('job', 'warning', `Could not delete the old step search ${f.name || ''}${err ? `: ${err}` : ''}`, { why: 'Saving or deleting a job removes the step searches it no longer uses.', fix: `Delete ${f.name || 'it'} by hand under Settings → Searches, reports and alerts (owner ${f.owner || '?'}).` });
        case 'preview_dispatched':
            return d('job', 'muted', `${user || 'Someone'} previewed step ${step}${job ? ` in ${job}` : ''}`);
        case 'output_viewed':
            return d('job', 'muted', `${user || 'Someone'} viewed the output${f.kind ? ` (${f.kind})` : ''}`);
        case 'permission_denied':
            return d('api', 'warning', `${user || 'Someone'} was not allowed to ${(f.action || 'do that').replace(/_/g, ' ')}`, { why: 'The user lacks the capability, role or job permission for this.', fix: 'Grant the orchestrator role or share the job, if they should be allowed.' });

        case 'settings_changed':
            return d('settings', 'info', `${user || 'Someone'} changed settings: ${(f.keys || '').replace(/[[\]"]/g, '').replace(/,/g, ', ')}`);
        case 'destination_saved':
            return d('settings', 'info', `${user || 'Someone'} ${f.created === 'true' ? 'added' : 'updated'} webhook destination ${f.destination || ''}${f.host ? ` (${f.host})` : ''}`);
        case 'destination_deleted':
            return d('settings', 'info', `${user || 'Someone'} deleted webhook destination ${f.destination || ''}`);
        case 'destination_secret_delete_failed':
            return d('settings', 'warning', `Could not delete the stored secret of destination ${f.destination || ''}${err ? `: ${err}` : ''}`, { fix: 'Try deleting the destination again.' });
        case 'snippet_saved':
            return d('job', 'muted', `${user || 'Someone'} ${f.created === 'true' ? 'saved' : 'renamed'} a snippet`);
        case 'snippet_deleted':
            return d('job', 'muted', `${user || 'Someone'} deleted a snippet`);
        case 'backfill_created':
            return d('backfill', 'info', `${user || 'Someone'} started a backfill of ${job}`);
        case 'backfill_cancelled':
            return d('backfill', 'warning', `Backfill of ${job} cancelled`);
        case 'backfill_done':
            return d('backfill', 'ok', `Backfill of ${job} finished`);
        case 'selftest':
            return d('engine', f.failed && f.failed !== '[]' ? 'warning' : 'info', `Self-test ${f.scenario || ''}${f.failed && f.failed !== '[]' ? ` found problems: ${f.failed}` : ' ran'}`);
        case 'selftest_probe':
            return d('engine', 'muted', 'Self-test probe');
        default:
            return d('other', levelTone, ev.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) + (err ? `: ${err}` : ''), explainError(err));
    }
}

/** A short, plain name for an event, for the Events graph and the filter. */
export function eventLabel(event: string): string {
    if (event.includes(',')) {
        return event.split(',').map(eventLabel).join(' or ');
    }
    const labels: Record<string, string> = {
        request: 'Screen and API requests',
        tick: 'Engine ticks',
        search_status: 'Search status checks',
        splunkd_call: 'Splunk calls',
        run_created: 'Runs created',
        run_state: 'Run state changes',
        step_state: 'Step state changes',
        step_dispatched: 'Searches started',
        step_attempt: 'Searches finished',
        step_dispatch_error: 'Searches that could not start',
        action_submitted: 'Actions queued',
        action_done: 'Actions sent',
        action_retry: 'Action retries',
        action_failed: 'Actions failed',
        condition_evaluated: 'Conditions checked',
        approval_requested: 'Approvals requested',
        approval_decided: 'Approvals decided',
        command_requested: 'Commands from the screens',
        bulk_run_action: 'Actions on many runs',
        step_scan_limit: 'Searches over the events scanned limit',
        job_followed: 'Jobs followed',
        job_unfollowed: 'Jobs unfollowed',
        heartbeat: 'Engine heartbeats',
        command: 'Commands applied',
        job_saved: 'Jobs saved',
        preview_dispatched: 'Previews',
        schedule_skipped: 'Schedules skipped (job disabled)',
        schedule_missed: 'Schedules missed (engine not checking)',
        run_waiting: 'Runs waiting in the queue',
        step_waiting: 'Steps waiting for a search slot',
        completion_not_fired: 'Downstream jobs not started',
        '(no event)': 'Free-text warnings and errors',
    };
    return labels[event] || event.replace(/_/g, ' ');
}
