/* Live step previews for the editor. Previewing a step first previews the upstream steps
 * whose previews are missing or stale (previewLogic.toBeRun), one at a time: start, poll
 * every 2 s until it ends, then the next. Done previews are polled every 5 minutes so the
 * server keeps them. Everything lives in this hook: unmounting discards it and cancels
 * running previews, best effort. Nothing here blocks editing. */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as client from '../../api/client';
import type { JobDefinition, PreviewInput, PreviewRequest, PreviewResults, PreviewStatus, SkipKind } from '../../api/types';
import { BUILTIN_DEFAULTS, isStale, LivePreview, PreviewContext, previewKeys, previousInputs, toBeRun, upstreamOf } from './previewLogic';

export interface PreviewApi {
    startPreview: typeof client.startPreview;
    previewStatus: typeof client.previewStatus;
    previewResults: typeof client.previewResults;
    cancelPreview: typeof client.cancelPreview;
}

const defaultApi: PreviewApi = {
    startPreview: client.startPreview,
    previewStatus: client.previewStatus,
    previewResults: client.previewResults,
    cancelPreview: client.cancelPreview,
};

export const POLL_MS = 2000;
export const KEEP_ALIVE_MS = 5 * 60 * 1000;

/** What a preview read, for the "input: …" line. `at` is in milliseconds. */
export type PreviewInputInfo =
    | { mode: 'live'; steps: { id: string; at: number; skipped?: SkipKind }[] }
    | { mode: 'run'; scheduledTime: number };

export interface PreviewRecord extends LivePreview {
    status?: PreviewStatus;
    results?: PreviewResults;
    error?: string;
    /** The exact search the server ran. */
    spl?: string;
    /** Why a run would skip the step. */
    reason?: string;
    /** Previewed although a run would skip it. */
    anyway?: boolean;
    input?: PreviewInputInfo;
}

export interface PreviewView extends PreviewRecord {
    /** The step, its inputs or the previews it read changed since. */
    stale: boolean;
}

type Outcome = 'done' | 'skipped' | 'failed' | 'missing' | 'cancelled' | 'superseded';

/** Seconds the step may run: its max_runtime, else the job's, else the built-in. */
export function effectiveMaxRuntime(job: JobDefinition, stepId: string): number {
    const step = (job.steps || []).find((s) => s.id === stepId);
    const own = step && step.max_runtime;
    const inherited = job.defaults && job.defaults.max_runtime;
    return own || inherited || BUILTIN_DEFAULTS.max_runtime;
}

/** The server's message, with the issues for an invalid preview. */
export function previewErrorText(err: unknown): string {
    if (err instanceof client.ApiError) {
        const errors = (err.issues || []).filter((i) => i.level === 'error').map((i) => i.message);
        if (err.code === 'invalid' && errors.length) {
            return `${err.message}: ${errors.join(' ')}`;
        }
        return err.message || err.code;
    }
    return (err as Error)?.message || 'The preview could not be started.';
}

/** The poll route says 404 for a sid it can't vouch for, such as a gone preview: the
 * preview is missing, as when the server reports `missing`. */
const gone = (err: unknown) => err instanceof client.ApiError && err.status === 404;

/** A preview whose search ran and failed (not one cancelled or never started): sent to
 * the server by sid, which decides as a run would (an on_failure or always edge still
 * reaches the step; an on_success edge is upstream_failed). */
const ranAndFailed = (p: PreviewRecord | undefined): boolean =>
    Boolean(p && p.state === 'failed' && p.sid && p.status && (p.status.state === 'failed' || p.status.state === 'done'));

const failedUpstream = (id: string) => `${id}'s preview failed; fix it or preview it again`;

export default function usePreviews(job: JobDefinition, ctx: PreviewContext, api: PreviewApi = defaultApi) {
    const [previews, setPreviews] = useState<Record<string, PreviewRecord>>({});
    const store = useRef<Record<string, PreviewRecord>>({});
    const mounted = useRef(true);
    const tokens = useRef<Record<string, number>>({});
    const pending = useRef<Record<string, Promise<Outcome> | undefined>>({});
    const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
    const latest = useRef({ job, ctx, api });
    latest.current = { job, ctx, api };

    const put = (id: string, rec: PreviewRecord) => {
        store.current = { ...store.current, [id]: rec };
        if (mounted.current) {
            setPreviews(store.current);
        }
    };
    const current = (id: string, token: number) => mounted.current && tokens.current[id] === token;
    const patch = (id: string, token: number, changes: Partial<PreviewRecord>) => {
        if (current(id, token) && store.current[id]) {
            put(id, { ...store.current[id], ...changes });
        }
    };
    const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
            const t = setTimeout(() => {
                timers.current.delete(t);
                resolve();
            }, ms);
            timers.current.add(t);
        });
    const ended = (id: string, token: number): Outcome => (mounted.current && tokens.current[id] !== token ? 'superseded' : 'cancelled');

    /** Take over a step: a running preview of it is cancelled, its record restarts. */
    const claim = (id: string, jobSnap: JobDefinition, ctxSnap: PreviewContext): number => {
        const token = (tokens.current[id] || 0) + 1;
        tokens.current[id] = token;
        const old = store.current[id];
        if (old && old.state === 'running' && old.sid) {
            latest.current.api.cancelPreview(old.sid).catch(() => undefined);
        }
        put(id, { key: previewKeys(jobSnap, ctxSnap, store.current)[id] || '', state: 'running', startedAt: Date.now() });
        return token;
    };

    /** The outcome of a step's preview, following it if a newer preview replaced it. */
    const follow = async (id: string, p: Promise<Outcome>): Promise<Outcome> => {
        let outcome = await p;
        let seen = p;
        while (outcome === 'superseded' && pending.current[id] && pending.current[id] !== seen) {
            seen = pending.current[id];
            outcome = await seen;
        }
        return outcome === 'superseded' ? 'cancelled' : outcome;
    };

    const input = (jobSnap: JobDefinition, ctxSnap: PreviewContext, id: string): { request: PreviewInput; info: PreviewInputInfo } => {
        if (ctxSnap.source !== 'live') {
            return { request: { mode: 'run', run_id: ctxSnap.source }, info: { mode: 'run', scheduledTime: ctxSnap.scheduledTime } };
        }
        const sent: Record<string, { sid?: string; skipped?: SkipKind }> = {};
        upstreamOf(jobSnap, id).forEach((u) => {
            const p = store.current[u];
            if (p && p.sid && (p.state === 'done' || ranAndFailed(p))) {
                sent[u] = { sid: p.sid };
            } else if (p && p.state === 'skipped' && p.skipped) {
                sent[u] = { skipped: p.skipped };
            }
        });
        const step = (jobSnap.steps || []).find((s) => s.id === id);
        const direct = Object.keys(sent).filter((u) => previousInputs(jobSnap, id).includes(u) || ((step && step.spl) || '').includes(`$${u}.`));
        const steps = direct.map((u) => ({ id: u, at: store.current[u].startedAt, skipped: sent[u].skipped }));
        return { request: { mode: 'live', previews: sent }, info: { mode: 'live', steps } };
    };

    /** Start the step's preview and poll it to the end. A 409 needs_preview re-runs the
     * named steps once (never a current failed one), then retries. */
    const execute = async (id: string, token: number, jobSnap: JobDefinition, ctxSnap: PreviewContext, anyway: boolean, retry: boolean): Promise<Outcome> => {
        const { api: a } = latest.current;
        const { request, info } = input(jobSnap, ctxSnap, id);
        patch(id, token, { key: previewKeys(jobSnap, ctxSnap, store.current)[id] || '', input: info, startedAt: Date.now() });
        const req: PreviewRequest = { job: jobSnap, step_id: id, scheduled_time: ctxSnap.scheduledTime, params: ctxSnap.params, input: request };
        if (anyway) {
            req.anyway = true;
        }
        let start;
        try {
            start = await a.startPreview(req);
        } catch (err) {
            if (!current(id, token)) {
                return ended(id, token);
            }
            if (retry && err instanceof client.ApiError && err.code === 'needs_preview') {
                const named = Array.isArray(err.extra.steps) ? (err.extra.steps as string[]) : [];
                for (const s of named) {
                    const p = store.current[s];
                    if (p && p.state === 'failed' && !isStale(p, previewKeys(jobSnap, ctxSnap, store.current)[s] || '')) {
                        patch(id, token, { state: 'failed', error: failedUpstream(s) });
                        return 'failed';
                    }
                    // eslint-disable-next-line no-await-in-loop
                    const o = await reuse(s, jobSnap, ctxSnap);
                    if (!current(id, token)) {
                        return ended(id, token);
                    }
                    if (o !== 'done' && o !== 'skipped' && !(o === 'failed' && ranAndFailed(store.current[s]))) {
                        patch(id, token, { state: 'failed', error: failedUpstream(s) });
                        return 'failed';
                    }
                }
                return execute(id, token, jobSnap, ctxSnap, anyway, false);
            }
            patch(id, token, { state: 'failed', error: previewErrorText(err) });
            return 'failed';
        }
        if (!current(id, token)) {
            if (start.status === 'started') {
                a.cancelPreview(start.sid).catch(() => undefined);
            }
            return ended(id, token);
        }
        if (start.status === 'skipped') {
            patch(id, token, { state: 'skipped', skipped: start.skip_kind, reason: start.reason });
            return 'skipped';
        }
        const { sid } = start;
        patch(id, token, { sid, spl: start.spl, anyway: Boolean(start.anyway) });
        const limit = effectiveMaxRuntime(jobSnap, id);
        for (;;) {
            let st: PreviewStatus;
            try {
                // eslint-disable-next-line no-await-in-loop
                st = await a.previewStatus(sid, limit);
            } catch (err) {
                if (gone(err)) {
                    patch(id, token, { state: 'missing' });
                    return current(id, token) ? 'missing' : ended(id, token);
                }
                patch(id, token, { state: 'failed', error: previewErrorText(err) });
                return current(id, token) ? 'failed' : ended(id, token);
            }
            if (!current(id, token)) {
                return ended(id, token);
            }
            const kind = ((jobSnap.steps || []).find((s) => s.id === id) || {}).type;
            if (st.state === 'done' && st.truncated && kind === 'previous') {
                // As a run decides (engine.py): a cut-down input is a failed step.
                patch(id, token, { state: 'failed', status: st, error: `a subsearch was cut short: ${st.truncated}` });
                return 'failed';
            }
            if (st.state === 'done') {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const results = await a.previewResults(sid);
                    patch(id, token, { state: 'done', status: st, results });
                } catch (err) {
                    patch(id, token, { state: 'failed', status: st, error: previewErrorText(err) });
                    return current(id, token) ? 'failed' : ended(id, token);
                }
                return current(id, token) ? 'done' : ended(id, token);
            }
            if (st.state === 'failed') {
                const msg = (st.messages || []).find((m) => m.type === 'ERROR' || m.type === 'FATAL');
                patch(id, token, { state: 'failed', status: st, error: st.error || st.truncated || (msg && msg.text) || 'The preview failed.' });
                return 'failed';
            }
            if (st.state === 'missing') {
                patch(id, token, { state: 'missing', status: st });
                return 'missing';
            }
            patch(id, token, { status: st });
            // eslint-disable-next-line no-await-in-loop
            await sleep(POLL_MS);
            if (!current(id, token)) {
                return ended(id, token);
            }
        }
    };

    function run(id: string, jobSnap: JobDefinition, ctxSnap: PreviewContext, anyway: boolean): Promise<Outcome> {
        const token = claim(id, jobSnap, ctxSnap);
        const p = execute(id, token, jobSnap, ctxSnap, anyway, true);
        pending.current[id] = p;
        return p;
    }

    /** A running, current preview of the step: awaited, not restarted. */
    const runningNow = (id: string, jobSnap: JobDefinition, ctxSnap: PreviewContext): boolean => {
        const p = store.current[id];
        return Boolean(
            p && p.state === 'running' && pending.current[id] && !isStale(p, previewKeys(jobSnap, ctxSnap, store.current)[id] || '')
        );
    };

    /** The step's outcome: a running current preview is followed, otherwise it is previewed. */
    function reuse(id: string, jobSnap: JobDefinition, ctxSnap: PreviewContext): Promise<Outcome> {
        const p = pending.current[id];
        if (p && runningNow(id, jobSnap, ctxSnap)) {
            return follow(id, p);
        }
        return follow(id, run(id, jobSnap, ctxSnap, false));
    }

    /** Previews missing or stale upstream steps first (and waits for running ones), then
     * the step. `anyway` applies to the step only, never to its upstream steps. */
    const preview = (stepId: string, opts: { anyway?: boolean } = {}): Promise<void> => {
        const { job: jobSnap, ctx: ctxSnap } = latest.current;
        const anyway = Boolean(opts.anyway);
        const keys = previewKeys(jobSnap, ctxSnap, store.current);
        const live = ctxSnap.source === 'live';
        const order = live ? toBeRun(jobSnap, stepId, store.current, (id) => keys[id] || '') : [stepId];
        const toRun = order.slice(0, -1);
        const before = live ? upstreamOf(jobSnap, stepId).filter((u) => toRun.includes(u) || runningNow(u, jobSnap, ctxSnap)) : [];
        const token = claim(stepId, jobSnap, ctxSnap);
        const chain = (async (): Promise<Outcome> => {
            for (const up of before) {
                // eslint-disable-next-line no-await-in-loop
                const o = await reuse(up, jobSnap, ctxSnap);
                if (!current(stepId, token)) {
                    return ended(stepId, token);
                }
                if (o !== 'done' && o !== 'skipped' && !(o === 'failed' && ranAndFailed(store.current[up]))) {
                    patch(stepId, token, {
                        state: 'failed',
                        error: o === 'cancelled' ? `${up}'s preview was cancelled; preview it again` : failedUpstream(up),
                    });
                    return 'failed';
                }
            }
            return execute(stepId, token, jobSnap, ctxSnap, anyway, true);
        })();
        pending.current[stepId] = chain;
        return chain.then(() => undefined);
    };

    const cancel = (stepId: string) => {
        tokens.current[stepId] = (tokens.current[stepId] || 0) + 1;
        delete pending.current[stepId];
        const p = store.current[stepId];
        if (p && p.state === 'running') {
            if (p.sid) {
                latest.current.api.cancelPreview(p.sid).catch(() => undefined);
            }
            put(stepId, { ...p, state: 'failed', error: 'Preview cancelled.' });
        }
    };

    // Keep done previews alive on the server, and notice ones it no longer has.
    useEffect(() => {
        const timer = setInterval(() => {
            Object.keys(store.current).forEach((id) => {
                const p = store.current[id];
                if (p.state === 'done' && p.sid) {
                    latest.current.api
                        .previewStatus(p.sid, effectiveMaxRuntime(latest.current.job, id))
                        .then((st) => {
                            if (st.state === 'missing' && store.current[id] === p) {
                                put(id, { ...p, state: 'missing', status: st });
                            }
                        })
                        .catch((err) => {
                            if (gone(err) && store.current[id] === p) {
                                put(id, { ...p, state: 'missing' });
                            }
                        });
                }
            });
        }, KEEP_ALIVE_MS);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Leaving the editor discards the previews and cancels running ones.
    useEffect(() => {
        mounted.current = true;
        const pendingTimers = timers.current;
        return () => {
            mounted.current = false;
            pendingTimers.forEach((t) => clearTimeout(t));
            pendingTimers.clear();
            Object.keys(store.current).forEach((id) => {
                const p = store.current[id];
                if (p.state === 'running' && p.sid) {
                    latest.current.api.cancelPreview(p.sid).catch(() => undefined);
                }
            });
            store.current = {};
            tokens.current = {};
            pending.current = {};
        };
    }, []);

    const views = useMemo(() => {
        const keys = previewKeys(job, ctx, previews);
        const out: Record<string, PreviewView> = {};
        Object.keys(previews).forEach((id) => {
            out[id] = { ...previews[id], stale: isStale(previews[id], keys[id] || '') };
        });
        return out;
    }, [job, ctx, previews]);

    return { previews: views, preview, cancel };
}

/** The short plain-text note a previewed step shows on the graph. */
export function previewNote(p: PreviewView | undefined): { text: string; failed: boolean } | null {
    if (!p) {
        return null;
    }
    if (p.state === 'running') {
        return { text: 'previewing…', failed: false };
    }
    if (p.stale || p.state === 'missing') {
        return { text: 'out of date', failed: false };
    }
    if (p.state === 'failed') {
        return { text: 'preview failed', failed: true };
    }
    if (p.state === 'skipped') {
        return { text: 'would be skipped', failed: false };
    }
    const n = p.status ? p.status.result_count : p.results ? p.results.total : 0;
    return { text: `✓ ${n} row${n === 1 ? '' : 's'}`, failed: false };
}
