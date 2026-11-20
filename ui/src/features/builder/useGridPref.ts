/* Whether the Flow canvas shows its dot grid: off by default, remembered in localStorage
 * (`so.flow.grid`) where the browser allows it. */
import { useState } from 'react';

export const GRID_KEY = 'so.flow.grid';

export default function useGridPref(): [boolean, () => void] {
    const [on, setOn] = useState(() => {
        try {
            return window.localStorage.getItem(GRID_KEY) === '1';
        } catch (err) {
            return false;
        }
    });
    const toggle = () => {
        const next = !on;
        setOn(next);
        try {
            window.localStorage.setItem(GRID_KEY, next ? '1' : '0');
        } catch (err) {
            // the choice still holds for this visit
        }
    };
    return [on, toggle];
}
