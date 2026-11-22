/* Output steps: a Results of earlier steps step that writes to a summary index or a lookup.
 * The SPL is generated from the output settings, so the two never disagree. */
import type { StepOutput } from '../../api/types';

/** What the server accepts as an index or lookup name (bin/so/model.py). */
export const OUTPUT_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/;

/** Field names as typed: split on commas and spaces. */
export function fieldList(text: string | undefined): string[] {
    return (text || '').split(/[\s,]+/).filter(Boolean);
}

export const FIELD_RE = /^[A-Za-z0-9_.*-]+$/;

const quoted = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function outputSpl(o: StepOutput): string {
    const lines: string[] = [];
    const fields = fieldList(o.fields);
    if (o.kind === 'summary_index') {
        const time = o.time || 'result';
        if (fields.length) {
            lines.push(`| table ${time === 'result' && !fields.includes('_time') ? '_time ' : ''}${fields.join(' ')}`);
        }
        if (time === 'scheduled') {
            lines.push('| eval _time=$run.scheduled_time$');
        } else if (time === 'now') {
            lines.push('| eval _time=now()');
        }
        const parts = ['| collect', `index=${o.index}`];
        if (o.source) {
            parts.push(`source=${quoted(o.source)}`);
        }
        if (o.sourcetype) {
            parts.push(`sourcetype=${quoted(o.sourcetype)}`);
        }
        if (o.host) {
            parts.push(`host=${quoted(o.host)}`);
        }
        if (o.add_run_id !== false) {
            parts.push('marker="so_run=$run.id$"');
        }
        lines.push(parts.join(' '));
        return lines.join('\n');
    }
    if (fields.length) {
        lines.push(`| table ${fields.join(' ')}`);
    }
    lines.push(`| outputlookup ${o.append ? 'append=true ' : ''}${o.name}`.trimEnd());
    return lines.join('\n');
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
    if (o.kind === 'summary_index' && [o.source, o.sourcetype, o.host].some((v) => v && /[\r\n]/.test(v))) {
        return 'Remove line breaks from the source, sourcetype or host';
    }
    const bad = fieldList(o.fields).find((f) => !FIELD_RE.test(f));
    if (bad) {
        return `"${bad}" isn't a field name: use letters, numbers, _ . - or *`;
    }
    return null;
}
