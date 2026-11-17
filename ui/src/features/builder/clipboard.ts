/* Copy, paste and duplicate for the Flow canvas. A clip holds steps (with their actions), the lines
 * between them, triggers and, when the Whole job node was selected, the job's actions, plus where
 * each node was shown. Pasting never connects to what is already in the job: ids that are taken
 * are renamed (tokens inside the pasted SPL, expressions and actions follow), and the clip's
 * top-left corner lands where asked. The text goes to the system clipboard when the browser
 * allows it, and to a copy in memory always, so paste works between jobs in the same page. */
import type { Action, Edge, JobDefinition, StepDef, Trigger } from '../../api/types';
import { layoutFlow } from './flowLayout';
import { withNodes } from './flowEdits';
import type { Pos, Positions } from './graphLogic';
import { JOB_KEY, actionKey, buildGraph, condKey, stepKey, triggerKey } from './nodeModel';
import { nextStepId, renameActions, renameStepTokens, renameTokens } from './stepRename';

export interface Clip {
    so_clipboard: 1;
    steps: StepDef[];
    edges: Edge[];
    job_actions: Action[];
    triggers: Trigger[];
    /** Where each copied node was shown, by its key in the job it was copied from. */
    positions: Record<string, Pos>;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** How many nodes pasting `clip` adds: steps, their actions, job actions, triggers and conditions. */
export function clipSize(clip: Clip): number {
    return (
        clip.steps.reduce((n, s) => n + 1 + (s.actions || []).length, 0) +
        clip.job_actions.length +
        clip.triggers.length +
        clip.edges.filter((e) => e.condition === 'expression').length
    );
}

/** Whether `clip` holds nothing to paste. */
export const clipIsEmpty = (clip: Clip) => clip.steps.length + clip.job_actions.length + clip.triggers.length === 0;

/** The top-left corner of the copied nodes (0,0 when none has a position). */
export function clipOrigin(clip: Clip): Pos {
    const all = Object.values(clip.positions);
    return all.length ? { x: Math.min(...all.map((p) => p.x)), y: Math.min(...all.map((p) => p.y)) } : { x: 0, y: 0 };
}

/** The selected steps with their actions, the lines between them (with their condition), the
 * selected triggers, and the job's actions when `job` is selected. `pos` is where nodes are shown. */
export function copySelection(job: JobDefinition, keys: string[], pos: Positions): Clip {
    const picked = new Set(keys);
    const steps = (job.steps || []).filter((s) => picked.has(stepKey(s.id)));
    const ids = new Set(steps.map((s) => s.id));
    const edges = (job.edges || []).filter((e) => ids.has(e.from) && ids.has(e.to));
    const triggers = (job.triggers || []).map((t, i) => ({ t, i })).filter(({ i }) => picked.has(triggerKey(i)));
    const jobActions = picked.has(JOB_KEY) ? job.actions || [] : [];
    const positions: Record<string, Pos> = {};
    const keep = (key: string) => {
        if (pos[key]) {
            positions[key] = { x: pos[key].x, y: pos[key].y };
        }
    };
    steps.forEach((s) => {
        keep(stepKey(s.id));
        (s.actions || []).forEach((_, i) => keep(actionKey(s.id, i)));
    });
    edges.forEach((e) => keep(condKey(e.from, e.to)));
    // Saved under the clip's own indexes (the nth copied trigger), as pasting maps them.
    triggers.forEach(({ i }, n) => {
        if (pos[triggerKey(i)]) {
            positions[triggerKey(n)] = { x: pos[triggerKey(i)].x, y: pos[triggerKey(i)].y };
        }
    });
    jobActions.forEach((_, i) => keep(actionKey('job', i)));
    return { so_clipboard: 1, steps: clone(steps), edges: clone(edges), job_actions: clone(jobActions), triggers: clone(triggers.map(({ t }) => t)), positions };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const listOf = (v: unknown, ok: (x: unknown) => boolean): boolean => Array.isArray(v) && v.every(ok);

/** The clip in `text`, or null for anything else. */
export function parseClip(text: string | null | undefined): Clip | null {
    let data: unknown;
    try {
        data = JSON.parse(text || '');
    } catch {
        return null;
    }
    if (!isObject(data) || data.so_clipboard !== 1 || !isObject(data.positions)) {
        return null;
    }
    const valid =
        listOf(
            data.steps,
            (s) => isObject(s) && typeof s.id === 'string' && typeof s.type === 'string' && (s.actions === undefined || listOf(s.actions, isObject))
        ) &&
        listOf(data.edges, (e) => isObject(e) && typeof e.from === 'string' && typeof e.to === 'string') &&
        listOf(data.job_actions, isObject) &&
        listOf(data.triggers, isObject);
    if (!valid) {
        return null;
    }
    const positions: Record<string, Pos> = {};
    Object.entries(data.positions).forEach(([key, p]) => {
        if (isObject(p) && Number.isFinite(p.x) && Number.isFinite(p.y)) {
            positions[key] = { x: p.x as number, y: p.y as number };
        }
    });
    return { so_clipboard: 1, steps: data.steps as StepDef[], edges: data.edges as Edge[], job_actions: data.job_actions as Action[], triggers: data.triggers as Trigger[], positions };
}

/** New ids for the steps whose id is taken; ids still free are kept, and no new id takes one. */
function newIds(job: JobDefinition, clip: Clip): Map<string, string> {
    const taken = new Set((job.steps || []).map((s) => s.id));
    const out = new Map<string, string>();
    const reserved: StepDef[] = [...(job.steps || [])];
    clip.steps.forEach((s) => {
        if (!taken.has(s.id)) {
            reserved.push({ id: s.id, type: 'inline' });
        }
    });
    clip.steps.forEach((s) => {
        if (taken.has(s.id)) {
            const id = nextStepId(reserved);
            reserved.push({ id, type: 'inline' });
            out.set(s.id, id);
        }
    });
    return out;
}

/** `job` with `clip` pasted so its top-left corner is at `at`; `keys` are the new nodes and
 * `message` says what happened. Nodes already shown keep their place (laid out compact or not). */
export function pasteResult(job: JobDefinition, clip: Clip, at: Pos, compact = false): { job: JobDefinition; keys: string[]; message: string } {
    const ids = newIds(job, clip);
    const idOf = (id: string) => ids.get(id) || id;
    // Renames go through a placeholder so one rename never meets the result of another.
    const renames = Array.from(ids.entries()).map(([from, to], i) => ({ from, to, tmp: `__so_paste_${i}__` }));
    const retoken = (text: string) => {
        const via = renames.reduce((t, r) => renameTokens(t, r.from, r.tmp), text);
        return renames.reduce((t, r) => renameTokens(t, r.tmp, r.to), via);
    };
    const steps = clip.steps.map((s) => {
        let out = clone(s);
        renames.forEach((r) => {
            out = renameStepTokens(out, r.from, r.tmp);
        });
        renames.forEach((r) => {
            out = renameStepTokens(out, r.tmp, r.to);
        });
        return { ...out, id: idOf(s.id) };
    });
    const edges = clip.edges.map((e) => {
        const next: Edge = { ...clone(e), from: idOf(e.from), to: idOf(e.to) };
        if (typeof next.expression === 'string') {
            next.expression = retoken(next.expression);
        }
        return next;
    });
    let jobActions = clone(clip.job_actions);
    renames.forEach((r) => {
        jobActions = renameActions(jobActions, r.from, r.tmp) || [];
    });
    renames.forEach((r) => {
        jobActions = renameActions(jobActions, r.tmp, r.to) || [];
    });
    const jobActionBase = (job.actions || []).length;
    const triggerBase = (job.triggers || []).length;
    const next: JobDefinition = {
        ...job,
        steps: [...(job.steps || []), ...steps],
        edges: [...(job.edges || []), ...edges],
        triggers: clip.triggers.length ? [...(job.triggers || []), ...clone(clip.triggers)] : job.triggers,
        actions: jobActions.length ? [...(job.actions || []), ...jobActions] : job.actions,
    };
    // Old key in the clip -> key in the target.
    const keyMap: Record<string, string> = {};
    steps.forEach((s, i) => {
        const old = clip.steps[i];
        keyMap[stepKey(old.id)] = stepKey(s.id);
        (s.actions || []).forEach((_, n) => {
            keyMap[actionKey(old.id, n)] = actionKey(s.id, n);
        });
    });
    clip.edges.forEach((e) => {
        keyMap[condKey(e.from, e.to)] = condKey(idOf(e.from), idOf(e.to));
    });
    clip.triggers.forEach((_, i) => {
        keyMap[triggerKey(i)] = triggerKey(triggerBase + i);
    });
    jobActions.forEach((_, i) => {
        keyMap[actionKey('job', i)] = actionKey('job', jobActionBase + i);
    });
    const origin = clipOrigin(clip);
    const placed: Record<string, Pos> = {};
    Object.entries(clip.positions).forEach(([old, p]) => {
        if (keyMap[old]) {
            placed[keyMap[old]] = { x: Math.round(p.x - origin.x + at.x), y: Math.round(p.y - origin.y + at.y) };
        }
    });
    const shown = layoutFlow(buildGraph(job), job.layout?.nodes, compact);
    const keys = Object.values(keyMap).filter((k) => {
        // Conditions exist only for expression lines (all of the clip's are copied with theirs).
        const c = /^cond:(.*)>(.*)$/.exec(k);
        return !c || edges.some((e) => e.condition === 'expression' && e.from === c[1] && e.to === c[2]);
    });
    const lines = new Set(edges.map((e) => e.to));
    const dangling = steps.filter((s) => s.type === 'previous' && !lines.has(s.id)).length;
    const count = clipSize(clip);
    let message = `Pasted ${count} node${count === 1 ? '' : 's'}`;
    if (dangling) {
        message += dangling === 1 ? '; 1 needs a line into it' : `; ${dangling} need a line into them`;
    }
    return { job: withNodes(next, { ...shown, ...placed }), keys, message };
}

let memory: string | null = null;

/** Copies `clip` to the system clipboard when the browser lets us, and always to memory. */
export async function writeClip(clip: Clip): Promise<void> {
    const text = JSON.stringify(clip);
    memory = text;
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // No clipboard API, or no permission: the copy in memory serves paste.
    }
}

/** The clip on the system clipboard, else the one in memory, else null. */
export async function readClip(): Promise<Clip | null> {
    try {
        const clip = parseClip(await navigator.clipboard.readText());
        if (clip) {
            return clip;
        }
    } catch {
        // Fall through to the copy in memory.
    }
    return parseClip(memory);
}

/** Which clipboard shortcut a key press is (Ctrl or Cmd with C, V or D), none while typing in a field. */
export function clipboardShortcut(ev: React.KeyboardEvent): 'copy' | 'paste' | 'duplicate' | null {
    const el = ev.target as HTMLElement;
    const tag = el && el.tagName;
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) {
        return null;
    }
    const key = ev.key.toLowerCase();
    return key === 'c' ? 'copy' : key === 'v' ? 'paste' : key === 'd' ? 'duplicate' : null;
}

/** Handles a clipboard key press on the canvas; true when it was one (and the default is stopped).
 * Copy leaves the browser's own copy alone when nothing is selected. */
export function runClipboardShortcut(
    ev: React.KeyboardEvent,
    o: { enabled: boolean; hasSelection: boolean; onCopy?: () => void; onDuplicate?: () => void; onPaste?: (at: Pos) => void; at: () => Pos }
): boolean {
    const what = o.enabled ? clipboardShortcut(ev) : null;
    const run = what === 'copy' ? o.onCopy : what === 'duplicate' ? o.onDuplicate : what === 'paste' ? o.onPaste && (() => o.onPaste?.(o.at())) : undefined;
    if (!run || (what === 'copy' && !o.hasSelection)) {
        return false;
    }
    ev.preventDefault();
    run();
    return true;
}
