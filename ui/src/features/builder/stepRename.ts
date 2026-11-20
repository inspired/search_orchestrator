/* Step ids and token rewrites: the id addStep gives a new step, and the renaming of `$id.sid$`
 * style tokens when a step's id changes (renaming a step, pasting a copy of one). */
import type { Action, StepDef } from '../../api/types';

/** The id addStep gives a new step: step_<n>, unused. */
export function nextStepId(steps: StepDef[], prefix?: string): string {
    const ids = new Set(steps.map((s) => s.id));
    if (prefix) {
        let k = 1;
        let id = prefix;
        while (ids.has(id)) {
            k += 1;
            id = `${prefix}_${k}`;
        }
        return id;
    }
    let n = steps.length + 1;
    while (ids.has(`step_${n}`)) {
        n += 1;
    }
    return `step_${n}`;
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Rewrites `$old.sid$`, `$old.resultCount$`, `$old.status$` and `$old.first.f$` (with an
 * optional `|default`) to the new id. Anything else, such as a literal `$` or `$old$`,
 * is left as it is (the token grammar of bin/so/tokens.py). */
export function renameTokens(text: string, from: string, to: string): string {
    const re = new RegExp(`\\$${escapeRe(from)}(\\.(?:sid|resultCount|status|first\\.[A-Za-z0-9_]+)(?:\\|[A-Za-z0-9_.:@ -]*)?\\$)`, 'g');
    return text.replace(re, (_m, rest: string) => `$${to}${rest}`);
}

/** Every string inside an action (subject, message, payload, params values ...). */
function renameInValue(value: unknown, from: string, to: string): unknown {
    if (typeof value === 'string') {
        return renameTokens(value, from, to);
    }
    if (Array.isArray(value)) {
        return value.map((v) => renameInValue(v, from, to));
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
            out[k] = renameInValue(v, from, to);
        });
        return out;
    }
    return value;
}

export const renameActions = (actions: Action[] | undefined, from: string, to: string) =>
    actions ? (actions.map((a) => renameInValue(a, from, to)) as Action[]) : actions;

export function renameStepTokens(step: StepDef, from: string, to: string): StepDef {
    const out = { ...step };
    if (typeof out.spl === 'string') {
        out.spl = renameTokens(out.spl, from, to);
    }
    if (out.run_when && out.run_when.kind === 'expression' && typeof out.run_when.value === 'string') {
        out.run_when = { ...out.run_when, value: renameTokens(out.run_when.value, from, to) };
    }
    if (out.actions) {
        out.actions = renameActions(out.actions, from, to);
    }
    if (out.approval && typeof out.approval.message === 'string') {
        out.approval = { ...out.approval, message: renameTokens(out.approval.message, from, to) };
    }
    return out;
}
