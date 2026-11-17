/* Whether typing | in the search field starts a new line: on by default, remembered in
 * localStorage (`so.spl.pipeNewline`) where the browser allows it. */
import { useState } from 'react';

export const PIPE_NEWLINE_KEY = 'so.spl.pipeNewline';

export default function usePipeNewlinePref(): [boolean, () => void] {
    const [on, setOn] = useState(() => {
        try {
            return window.localStorage.getItem(PIPE_NEWLINE_KEY) !== '0';
        } catch (err) {
            return true;
        }
    });
    const toggle = () => {
        const next = !on;
        setOn(next);
        try {
            window.localStorage.setItem(PIPE_NEWLINE_KEY, next ? '1' : '0');
        } catch (err) {
            // the choice still holds for this visit
        }
    };
    return [on, toggle];
}
