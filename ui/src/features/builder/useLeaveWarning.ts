/* Asks the browser to confirm before the page is closed or reloaded while there are unsaved changes. */
import { useEffect } from 'react';

export default function useLeaveWarning(dirty: boolean) {
    useEffect(() => {
        if (!dirty) {
            return undefined;
        }
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);
}
