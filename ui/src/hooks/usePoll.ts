import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollState<T> {
    data: T | undefined;
    error: Error | undefined;
    loading: boolean;
    /** Fetch again now (after the request in flight, if there is one). */
    refresh: () => void;
}

function hidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Calls `fn` once, then every `intervalMs` while `active` is true and the tab is visible.
 * A hidden tab pauses polling; it fetches again as soon as the tab is shown.
 *
 * Only one request runs at a time: a tick (or the tab being shown) while a request is in
 * flight is skipped. `refresh()` while a request is in flight discards that request's
 * result and fetches again once it settles, so a changed `fn` (such as new filters) never
 * shows stale data and never overlaps.
 */
export default function usePoll<T>(fn: () => Promise<T>, intervalMs = 5000, active = true): PollState<T> {
    const [data, setData] = useState<T>();
    const [error, setError] = useState<Error>();
    const [loading, setLoading] = useState(true);
    const fnRef = useRef(fn);
    fnRef.current = fn;
    const mounted = useRef(false);
    const inFlight = useRef(false);
    const again = useRef(false);

    const load = useCallback(() => {
        if (inFlight.current || !mounted.current) {
            return;
        }
        inFlight.current = true;
        let settled: Promise<void>;
        try {
            settled = fnRef.current().then(
                (value) => {
                    if (mounted.current && !again.current) {
                        setData(value);
                        setError(undefined);
                    }
                },
                (err: Error) => {
                    if (mounted.current && !again.current) {
                        setError(err);
                    }
                }
            );
        } catch (err) {
            settled = Promise.resolve().then(() => {
                if (mounted.current && !again.current) {
                    setError(err as Error);
                }
            });
        }
        settled.then(() => {
            inFlight.current = false;
            if (!mounted.current) {
                return;
            }
            if (again.current) {
                again.current = false;
                load();
            } else {
                setLoading(false);
            }
        });
    }, []);

    const refresh = useCallback(() => {
        if (inFlight.current) {
            again.current = true;
        } else {
            load();
        }
    }, [load]);

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

    return { data, error, loading, refresh };
}
