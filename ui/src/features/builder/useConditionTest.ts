/* Test condition for one dependency: asks the server (a simple comparison is answered at
 * once; an eval or search condition runs a search, polled every POLL_MS), keeps the answer,
 * and says when the edge, time, parameters or input changed since it was tested. Unmounting
 * or cancelling stops a running search, best effort. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { testCondition } from '../../api/conditionTest';
import { ApiError, cancelPreview, previewStatus } from '../../api/client';
import type { JobDefinition, PreviewInput } from '../../api/types';
import type { PreviewContext } from './previewLogic';
import { POLL_MS } from './usePreviews';

export interface ConditionTestView {
    state: 'idle' | 'running' | 'done' | 'needs_preview' | 'error';
    result?: boolean;
    why?: string;
    /** The text checked: the comparison with its tokens filled, or the search. */
    text?: string;
    spl?: string;
    count?: number;
    error?: string;
    needs?: string[];
    stale: boolean;
}

/** Seconds a condition search may run before the server cancels it. */
const LIMIT_S = 300;

type Answer = Omit<ConditionTestView, 'stale'>;

export default function useConditionTest(
    job: JobDefinition,
    from: string,
    to: string,
    ctx: PreviewContext,
    inputFor: (stepId: string) => PreviewInput
): { view: ConditionTestView; test: () => void; cancel: () => void } {
    const [answer, setAnswer] = useState<Answer>({ state: 'idle' });
    const [tested, setTested] = useState('');
    const token = useRef(0);
    const sid = useRef<string | undefined>(undefined);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const edge = (job.edges || []).find((e) => e.from === from && e.to === to);
    const key = JSON.stringify([edge && edge.expression, edge && edge.expression_kind, edge && edge.earliest, edge && edge.latest, ctx.scheduledTime, ctx.params, inputFor(from)]);

    const stop = useCallback(() => {
        token.current += 1;
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = undefined;
        }
        if (sid.current) {
            cancelPreview(sid.current).catch(() => undefined);
            sid.current = undefined;
        }
    }, []);

    useEffect(() => stop, [stop]);

    const test = () => {
        stop();
        const mine = token.current;
        const live = () => token.current === mine;
        const finish = (next: Answer) => {
            sid.current = undefined;
            setAnswer(next);
        };
        setTested(key);
        setAnswer({ state: 'running' });
        const poll = (id: string, spl: string) => {
            previewStatus(id, LIMIT_S).then(
                (st) => {
                    if (!live()) {
                        return;
                    }
                    if (st.state === 'running') {
                        timer.current = setTimeout(() => poll(id, spl), POLL_MS);
                    } else if (st.state === 'done') {
                        finish({ state: 'done', result: st.result_count > 0, count: st.result_count, spl, text: spl, why: '' });
                    } else {
                        const msg = (st.messages || []).find((m) => m.type === 'ERROR' || m.type === 'FATAL');
                        const error = st.error || (st.state === 'missing' ? 'The search is gone. Test again.' : (msg && msg.text) || 'The search failed.');
                        finish({ state: 'done', result: false, spl, text: spl, error, why: '' });
                    }
                },
                (err: unknown) => {
                    if (live()) {
                        const gone = err instanceof ApiError && err.status === 404;
                        finish({ state: 'done', result: false, spl, text: spl, why: '', error: gone ? 'The search is gone. Test again.' : (err as Error).message });
                    }
                }
            );
        };
        testCondition({ job, from, to, scheduled_time: ctx.scheduledTime, params: ctx.params, input: inputFor(from) }).then(
            (reply) => {
                if (!live()) {
                    if (reply.status === 'started') {
                        cancelPreview(reply.sid).catch(() => undefined);
                    }
                    return;
                }
                if (reply.status === 'done') {
                    finish({ state: 'done', result: reply.result, why: reply.why, text: reply.filled, error: reply.error });
                    return;
                }
                sid.current = reply.sid;
                poll(reply.sid, reply.spl);
            },
            (err: unknown) => {
                if (!live()) {
                    return;
                }
                if (err instanceof ApiError && err.code === 'needs_preview') {
                    const steps = err.extra.steps;
                    finish({ state: 'needs_preview', needs: Array.isArray(steps) ? (steps as string[]) : [from] });
                } else {
                    finish({ state: 'error', error: (err as Error).message || 'The condition could not be tested.' });
                }
            }
        );
    };

    const cancel = () => {
        stop();
        setAnswer({ state: 'idle' });
    };

    return { view: { ...answer, stale: answer.state !== 'idle' && answer.state !== 'running' && tested !== key }, test, cancel };
}
