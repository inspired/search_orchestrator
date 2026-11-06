import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollState<T> {
    data: T | undefined;
    error: Error | undefined;
    loading: boolean;
    /** Fetch again now. */
    refresh: () => void;
}

function hidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Calls `fn` once, then every `intervalMs` while `active` is true and the tab is visible.
 * A hidden tab pauses polling; it fetches again as soon as the tab is shown.
 */
export default function usePoll<T>(fn: () => Promise<T>, intervalMs = 5000, active = true): PollState<T> {
    const [data, setData] = useState<T>();
    const [error, setError] = useState<Error>();
    const [loading, setLoading] = useState(true);
    const fnRef = useRef(fn);
    fnRef.current = fn;
    const mounted = useRef(true);
    const seq = useRef(0);

    const load = useCallback(() => {
        const mine = ++seq.current;
        fnRef
            .current()
            .then((value) => {
                if (mounted.current && mine === seq.current) {
                    setData(value);
                    setError(undefined);
                }
            })
            .catch((err: Error) => {
                if (mounted.current && mine === seq.current) {
                    setError(err);
                }
            })
            .finally(() => {
                if (mounted.current && mine === seq.current) {
                    setLoading(false);
                }
            });
    }, []);

    useEffect(() => {
        mounted.current = true;
        load();
        return () => {
            mounted.current = false;
        };
    }, [load]);

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        const timer = setInterval(() => {
            if (!hidden()) {
                load();
            }
        }, intervalMs);
        const onVisible = () => {
            if (!hidden()) {
                load();
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [active, intervalMs, load]);

    return { data, error, loading, refresh: load };
}
