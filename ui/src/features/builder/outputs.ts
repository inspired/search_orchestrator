/* Output steps: a Results of earlier steps step that writes to a summary index or a lookup.
 * The SPL is generated from the output settings, so the two never disagree. */
import type { StepOutput } from '../../api/types';

/** What the server accepts as an index or lookup name (bin/so/model.py). */
export const OUTPUT_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/;

export function outputSpl(o: StepOutput): string {
    if (o.kind === 'summary_index') {
        const parts = ['| collect', `index=${o.index}`];
        if (o.source) {
            parts.push(`source="${o.source.replace(/"/g, '\\"')}"`);
        }
        if (o.add_run_id !== false) {
            parts.push('marker="so_run=$run.id$"');
        }
        return parts.join(' ');
    }
    return `| outputlookup ${o.append ? 'append=true ' : ''}${o.name}`.trimEnd();
}

/** A message for the field when the output cannot be saved, else null. */
export function outputIssue(o: StepOutput): string | null {
    const value = o.kind === 'summary_index' ? o.index : o.name;
    const noun = o.kind === 'summary_index' ? 'index' : 'lookup';
    if (!value) {
        return o.kind === 'summary_index' ? 'Type the summary index to write to' : 'Type the lookup name to write to';
    }
    if (!OUTPUT_NAME_RE.test(value)) {
        return `Use letters, numbers, _ . : or - in the ${noun} name`;
    }
    return null;
}
