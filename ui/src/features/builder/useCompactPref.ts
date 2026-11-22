/* Whether the Flow canvas draws nodes compact (icon and name only): off by default, remembered
 * in localStorage (`so.flow.compact`) where the browser allows it. */
import { useState } from 'react';

export const COMPACT_KEY = 'so.flow.compact';

export default function useCompactPref(): [boolean, () => void] {
    const [on, setOn] = useState(() => {
        try {
            return window.localStorage.getItem(COMPACT_KEY) === '1';
        } catch (err) {
            return false;
        }
    });
    const toggle = () => {
        const next = !on;
        setOn(next);
        try {
            window.localStorage.setItem(COMPACT_KEY, next ? '1' : '0');
        } catch (err) {
            // the choice still holds for this visit
        }
    };
    return [on, toggle];
}
