import { useEffect, useState } from 'react';

/** How long typing must pause before a search box searches. */
export const SEARCH_DELAY_MS = 300;

/** `value`, held back until it has stopped changing for `delayMs`. */
export default function useDebounced<T>(value: T, delayMs: number): T {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);
    return settled;
}
