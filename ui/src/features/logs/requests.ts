/* What a request to the app's REST endpoint did, in words: the method and path become the
 * action ("approved step X", "saved job Y"), the status becomes its outcome. */
import type { LogNames } from '../../api/logs';
import type { Described, Tone } from './catalog';

type F = Record<string, string | undefined>;

/** The path below /orchestrator, ids decoded: "/orchestrator_jlh/runs/a%3Ab/approve" → ["runs", "a:b", "approve"]. */
export function routeParts(path?: string): string[] {
    const p = (path || '').split('?')[0];
    const i = p.search(/\/orchestrator[^/]*(\/|$)/);
    const rest = i >= 0 ? p.slice(i).replace(/^\/orchestrator[^/]*\/?/, '') : p.replace(/^\//, '');
    return rest
        .split('/')
        .filter(Boolean)
        .map((s) => {
            try {
                return decodeURIComponent(s);
            } catch (e) {
                return s;
            }
        });
}

/** The route with ids taken out, as the server's breakdown names it: "runs/<id>/approve". */
export function routeName(path?: string): string {
    const parts = routeParts(path);
    if (['jobs', 'runs', 'backfills', 'snippets', 'destinations'].includes(parts[0]) && parts[1]) {
        parts[1] = '<id>';
    }
    if (parts[0] === 'preview' && parts[1] && !['condition', 'output', 'defaults'].includes(parts[1])) {
        parts[1] = '<sid>';
    }
    return parts.join('/');
}

export const STATUS_WORD: Record<string, string> = {
    '200': 'OK',
    '201': 'created',
    '202': 'accepted: the engine applies it on its next tick',
    '400': 'refused: the request was not valid',
    '401': 'not signed in',
    '403': 'not allowed',
    '404': 'not found',
    '409': 'conflict: it changed meanwhile',
    '500': 'server error',
    '502': 'Splunk did not answer properly',
    '503': 'Splunk is busy',
};

function action(method: string, parts: string[], names: LogNames): { text: string; read: boolean } {
    const [a, id, b] = parts;
    const job = (j?: string) => (j && names[j] ? names[j].name : j || 'a job');
    const run = (r?: string) => (r ? `run ${r}` : 'a run');
    const r = (text: string) => ({ text, read: true });
    const w = (text: string) => ({ text, read: false });
    switch (a) {
        case 'jobs':
            if (!id) {
                return method === 'POST' ? w('created a job') : r('listed the jobs');
            }
            if (id === 'validate') {
                return r('checked a job for errors');
            }
            if (b === 'runs') {
                return w(`started ${job(id)} now`);
            }
            if (b === 'enabled') {
                return w(`enabled or disabled ${job(id)}`);
            }
            if (b === 'versions') {
                return r(`looked at the versions of ${job(id)}`);
            }
            if (b === 'restore') {
                return w(`restored an old version of ${job(id)}`);
            }
            if (b === 'backfills') {
                return w(`started a backfill of ${job(id)}`);
            }
            return method === 'PUT' ? w(`saved ${job(id)}`) : method === 'DELETE' ? w(`deleted ${job(id)}`) : r(`opened ${job(id)}`);
        case 'runs':
            if (!id) {
                return r('loaded the runs list');
            }
            if (b === 'approve') {
                return w(`decided an approval in ${run(id)}`);
            }
            if (b === 'rerun') {
                return w(`asked to re-run ${run(id)}`);
            }
            if (['pause', 'resume', 'cancel', 'dismiss'].includes(b || '')) {
                return w(`asked to ${b} ${run(id)}`);
            }
            if (b === 'performance') {
                return r(`loaded CPU and memory for ${run(id)}`);
            }
            return r(`opened ${run(id)}`);
        case 'preview':
            if (id === 'condition') {
                return w('tested a condition');
            }
            if (id === 'output') {
                return w('viewed an output');
            }
            if (id === 'defaults') {
                return r('loaded preview defaults');
            }
            if (!id) {
                return w('previewed a step');
            }
            return b === 'cancel' ? w('stopped a preview') : b === 'results' ? r('read preview results') : r('checked a preview');
        case 'settings':
            return method === 'PUT' ? w('changed the settings') : r('opened the settings');
        case 'destinations':
            return method === 'POST' ? w('saved a webhook destination') : method === 'DELETE' ? w(`deleted destination ${id || ''}`.trim()) : r('listed webhook destinations');
        case 'backfills':
            return b === 'cancel' ? w('cancelled a backfill') : r(id ? 'opened a backfill' : 'listed backfills');
        case 'snippets':
            return method === 'GET' ? r('loaded snippets') : w(method === 'DELETE' ? 'deleted a snippet' : 'saved a snippet');
        case 'logs':
            return r(id ? `loaded the troubleshooting ${id}` : 'searched the troubleshooting logs');
        case 'calendar':
            return r('loaded the calendar');
        case 'me':
            return r('checked their access');
        case 'health':
            return r('loaded the health check');
        case 'alert_actions':
            return r('listed alert actions');
        case 'schedule':
            return r('worked out the next schedule times');
        case 'timerange':
            return r('resolved a time range');
        case 'selftest':
            return w('ran the self-test');
        default:
            return method === 'GET' ? r(`read ${parts.join('/') || 'the app'}`) : w(`${method} ${parts.join('/')}`);
    }
}

export function describeRequest(f: F, names: LogNames, level?: string): Described {
    const method = (f.method || 'GET').toUpperCase();
    const status = f.status || '';
    const st = Number(status);
    const { text } = action(method, routeParts(f.path), names);
    const tone: Tone = st >= 500 || level === 'ERROR' ? 'error' : st >= 400 ? 'warning' : st === 202 ? 'info' : 'ok';
    const ms = Number(f.ms);
    const slow = ms >= 5000;
    const out: Described = {
        category: 'api',
        tone: slow && tone === 'ok' ? 'warning' : tone,
        title: `${f.user || 'Someone'} ${text}`,
        who: f.user || 'unknown',
        result: [status ? `${status} ${STATUS_WORD[status] || ''}`.trim() : '', Number.isNaN(ms) ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`].filter(Boolean).join(' · '),
    };
    if (f.error || f.error_code) {
        out.title += ` — ${f.error || f.error_code}`;
    }
    if (st >= 500) {
        out.why = 'The REST handler failed while doing this (see the error, and any traceback near this line).';
        out.fix = 'Try again; if it repeats, report the error.';
    } else if (st === 403) {
        out.why = 'The user lacks the capability, role or job permission for this.';
        out.fix = 'Grant the orchestrator role or share the job, if they should be allowed.';
    } else if (st === 409) {
        out.why = 'Someone else changed the same thing in the meantime.';
        out.fix = 'Reload and try again.';
    } else if (st === 400 && f.error) {
        out.why = `The app refused the input: ${f.error}`;
    } else if (slow) {
        out.why = `It took ${(ms / 1000).toFixed(1)} s to answer. Requests that search (previews, performance, logs) are slower; others should be fast.`;
        out.fix = 'If ordinary pages are slow, check KV Store and splunkd load (Splunk calls graph at Debug level).';
    }
    return out;
}
