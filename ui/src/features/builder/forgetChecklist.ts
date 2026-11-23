/* The setup checklist was removed in 1.48.2. It remembered, per job, that it was hidden
 * (`so.checklist.hidden.<job id>` in localStorage); this clears those keys once the builder
 * opens, so they don't stay in the browser for good. Best effort: storage may be blocked. */
const PREFIX = 'so.checklist.hidden.';

export default function forgetChecklist() {
    try {
        const store = window.localStorage;
        const old: string[] = [];
        for (let i = 0; i < store.length; i += 1) {
            const key = store.key(i);
            if (key && key.startsWith(PREFIX)) {
                old.push(key);
            }
        }
        old.forEach((key) => store.removeItem(key));
    } catch (err) {
        // nothing to clear here
    }
}
