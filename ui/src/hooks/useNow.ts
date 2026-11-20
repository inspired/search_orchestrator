import { useEffect, useState } from 'react';

const seconds = () => Math.floor(Date.now() / 1000);

/**
 * The time in epoch seconds, ticking once a second while `active` (one shared client tick for a
 * page's timers and countdowns). It stops when `active` turns false, and is read afresh whenever
 * `key` changes (for example each poll's data).
 */
export default function useNow(active: boolean, key?: unknown): number {
    const [now, setNow] = useState(seconds);
    useEffect(() => setNow(seconds()), [key]);
    useEffect(() => {
        if (!active) {
            return undefined;
        }
        setNow(seconds());
        const id = window.setInterval(() => setNow(seconds()), 1000);
        return () => window.clearInterval(id);
    }, [active]);
    return now;
}
