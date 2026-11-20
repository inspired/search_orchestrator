/* Whether the setup checklist is hidden. Hiding it by hand is remembered per job in localStorage
 * (`so.checklist.hidden.<job id>`) where the browser allows it; hiding it because everything is
 * done is not, so it can come back if something stops being done. */
import { useCallback, useState } from 'react';

export const checklistKey = (jobId: string | null) => `so.checklist.hidden.${jobId || 'new'}`;

function read(jobId: string | null): boolean {
    try {
        return window.localStorage.getItem(checklistKey(jobId)) === '1';
    } catch (err) {
        return false;
    }
}

function write(jobId: string | null, hidden: boolean) {
    try {
        if (hidden) {
            window.localStorage.setItem(checklistKey(jobId), '1');
        } else {
            window.localStorage.removeItem(checklistKey(jobId));
        }
    } catch (err) {
        // the choice still holds for this visit
    }
}

export default function useChecklistHidden(jobId: string | null) {
    const [hidden, setHidden] = useState(() => read(jobId));
    const hide = useCallback(() => {
        setHidden(true);
        write(jobId, true);
    }, [jobId]);
    const show = useCallback(() => {
        setHidden(false);
        write(jobId, false);
    }, [jobId]);
    /** Hidden for this visit only. */
    const hideQuietly = useCallback(() => setHidden(true), []);
    return { hidden, hide, show, hideQuietly };
}
