/* Whether the Flow canvas draws a label on every line: off by default, remembered in localStorage
 * (`so.flow.lineLabels`) where the browser allows it. */
import { useState } from 'react';

export const LINE_LABELS_KEY = 'so.flow.lineLabels';

export default function useLineLabelsPref(): [boolean, () => void] {
    const [on, setOn] = useState(() => {
        try {
            return window.localStorage.getItem(LINE_LABELS_KEY) === '1';
        } catch (err) {
            return false;
        }
    });
    const toggle = () => {
        const next = !on;
        setOn(next);
        try {
            window.localStorage.setItem(LINE_LABELS_KEY, next ? '1' : '0');
        } catch (err) {
            // the choice still holds for this visit
        }
    };
    return [on, toggle];
}
