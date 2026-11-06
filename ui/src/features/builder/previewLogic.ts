/* Pure helpers for step previews: which steps a step reads, the input a "From previous
 * steps" step gets, and the key that says whether a live preview is still valid. No I/O. */
import type { Edge, JobDefinition, SkipKind, StepDef } from '../../api/types';

/** model.BUILTIN_DEFAULTS */
export const BUILTIN_DEFAULTS = { delayed_after: 3600, give_up_after: 86400, max_runtime: 14400, retries: 0 };

const FIELD = '[A-Za-z0-9_]+';
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** tokens._regex: run tokens, and `$<step>.<prop>$` for the given step ids (longest id
 * first), each with an optional `|default`. */
function tokenRegex(stepIds: string[]): RegExp {
    const steps = [...stepIds]
        .sort((a, b) => b.length - a.length)
        .map(escapeRe)
        .join('|');
    const alts = ['run\\.id', 'run\\.scheduled_time', `run\\.param\\.${FIELD}`];
    if (steps) {
        alts.push(`(?:${steps})\\.(?:sid|resultCount|status)`);
        alts.push(`(?:${steps})\\.first\\.${FIELD}`);
    }
    return new RegExp(`\\$(${alts.join('|')})(?:\\|[A-Za-z0-9_.:@ -]*)?\\$`, 'g');
}

/** tokens.find_tokens: the token names in `text`. */
function findTokens(text: string, stepIds: string[]): string[] {
    const out: string[] = [];
    const re = tokenRegex(stepIds);
    let m: RegExpExecArray | null = re.exec(text);
    while (m) {
        out.push(m[1]);
        m = re.exec(text);
    }
    return out;
}

/** preview._step_refs: step ids the step's SPL names in tokens. */
function stepRefs(step: StepDef, stepIds: string[]): Set<string> {
    const ids = new Set(stepIds);
    const out = new Set<string>();
    findTokens(step.spl || '', stepIds).forEach((name) => {
        const ref = name.split('.')[0];
        if (ref !== 'run' && ids.has(ref)) {
            out.add(ref);
        }
    });
    return out;
}

/** model.topo_order: Kahn's order, ready steps taken in step order. Null on a cycle. */
function topoOrder(ids: string[], edges: Pick<Edge, 'from' | 'to'>[]): string[] | null {
    const index = new Map(ids.map((id, i) => [id, i]));
    const succ = new Map<string, string[]>(ids.map((id) => [id, []]));
    const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
    edges.forEach((e) => {
        if (index.has(e.from) && index.has(e.to)) {
            (succ.get(e.from) as string[]).push(e.to);
            indeg.set(e.to, (indeg.get(e.to) as number) + 1);
        }
    });
    const byIndex = (a: string, b: string) => (index.get(a) as number) - (index.get(b) as number);
    const ready = ids.filter((id) => indeg.get(id) === 0).sort(byIndex);
    const out: string[] = [];
    while (ready.length) {
        const n = ready.shift() as string;
        out.push(n);
        (succ.get(n) as string[]).forEach((b) => {
            indeg.set(b, (indeg.get(b) as number) - 1);
            if (indeg.get(b) === 0) {
                ready.push(b);
            }
        });
        ready.sort(byIndex);
    }
    return out.length === ids.length ? out : null;
}

/** preview.closure: the steps `stepId` reads through edges or `$x.…$` tokens in its SPL,
 * transitively, in topological order, without `stepId` itself. */
export function upstreamOf(job: JobDefinition, stepId: string): string[] {
    const steps = job.steps || [];
    const ids: string[] = [];
    steps.forEach((s) => {
        if (!ids.includes(s.id)) {
            ids.push(s.id);
        }
    });
    const known = new Set(ids);
    const preds = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
    const edges = job.edges || [];
    edges.forEach((e) => {
        if (known.has(e.from) && known.has(e.to)) {
            (preds.get(e.to) as Set<string>).add(e.from);
        }
    });
    const tokenEdges: Pick<Edge, 'from' | 'to'>[] = [];
    steps.forEach((s) => {
        stepRefs(s, ids).forEach((ref) => {
            if (ref !== s.id) {
                (preds.get(s.id) as Set<string>).add(ref);
                tokenEdges.push({ from: ref, to: s.id });
            }
        });
    });
    const seen = new Set<string>();
    const stack = [...(preds.get(stepId) || [])];
    while (stack.length) {
        const n = stack.pop() as string;
        if (!seen.has(n)) {
            seen.add(n);
            stack.push(...(preds.get(n) as Set<string>));
        }
    }
    seen.delete(stepId);
    // Token refs that make a cycle with the edges: order by edges only, as the server does.
    const order = topoOrder(ids, [...edges, ...tokenEdges]) || topoOrder(ids, edges) || ids;
    return order.filter((id) => seen.has(id));
}

/** tokens.previous_inputs: the steps with an edge into `stepId`, in edge order, once each. */
export function previousInputs(job: JobDefinition, stepId: string): string[] {
    const out: string[] = [];
    (job.edges || []).forEach((e) => {
        if (e.to === stepId && !out.includes(e.from)) {
            out.push(e.from);
        }
    });
    return out;
}

function loadjobChain(deps: string[], ref: (id: string) => string): string {
    return deps.map((d, i) => (i === 0 ? `| loadjob ${ref(d)}` : `| append [| loadjob ${ref(d)}]`)).join(' ');
}

/** The input a "From previous steps" step gets, as the panel shows it. */
export function generatedInput(job: JobDefinition, stepId: string): string {
    const deps = previousInputs(job, stepId);
    return deps.length ? loadjobChain(deps, (d) => `‹${d}›`) : '(no previous steps yet)';
}

/** The same input as Search SPL with `$step.sid$` tokens, for switching back to Search.
 * Empty when the step has no dependencies. */
export function generatedInputSpl(job: JobDefinition, stepId: string): string {
    return loadjobChain(previousInputs(job, stepId), (d) => `$${d}.sid$`);
}

export interface PreviewContext {
    /** "Preview as if scheduled at", epoch seconds. */
    scheduledTime: number;
    params: Record<string, string>;
    /** `live`, or the id of the run the inputs come from. */
    source: string;
}

export type UpstreamKeys = Record<string, { key: string; sid?: string; skipped?: SkipKind }>;

/** JSON with object keys sorted and null or undefined members dropped (an absent optional
 * field and a null one mean the same), so equal values give equal text. */
function stable(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(stable);
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        Object.keys(value as Record<string, unknown>)
            .sort()
            .forEach((k) => {
                const v = (value as Record<string, unknown>)[k];
                if (v !== undefined && v !== null) {
                    out[k] = stable(v);
                }
            });
        return out;
    }
    return value;
}

/** What a step's preview depends on, as text: the step (without its display name and its
 * actions, which don't change what a preview shows; with inherited defaults resolved), the
 * job ref (its id, or "new" before the first save), the edges into it, the time zone, "as if scheduled at",
 * the params it references, where the inputs come from, and (live previews only) each
 * upstream step's key and sid. A live preview is valid while this is unchanged. */
export function previewKey(job: JobDefinition, stepId: string, ctx: PreviewContext, upstreamKeys: UpstreamKeys): string {
    const step = (job.steps || []).find((s) => s.id === stepId);
    if (!step) {
        return '';
    }
    const defaults = job.defaults || {};
    const resolved: Record<string, unknown> = { ...step };
    delete resolved.name;
    delete resolved.actions;
    (Object.keys(BUILTIN_DEFAULTS) as (keyof typeof BUILTIN_DEFAULTS)[]).forEach((k) => {
        const own = step[k];
        const inherited = defaults[k];
        resolved[k] = own !== undefined && own !== null ? own : inherited !== undefined && inherited !== null ? inherited : BUILTIN_DEFAULTS[k];
    });
    const incoming = (job.edges || []).filter((e) => e.to === stepId);
    const texts = [step.spl || '', (step.run_when && step.run_when.value) || '', ...incoming.map((e) => e.expression || '')];
    const names = new Set<string>();
    texts.forEach((t) =>
        findTokens(t, []).forEach((name) => {
            if (name.startsWith('run.param.')) {
                names.add(name.slice('run.param.'.length));
            }
        })
    );
    const params: Record<string, unknown> = {};
    Array.from(names)
        .sort()
        .forEach((name) => {
            const decl = (job.params || []).find((p) => p.name === name);
            const given = ctx.params[name];
            params[name] = given !== undefined && given !== '' ? String(given) : decl && decl.default !== undefined && decl.default !== null ? String(decl.default) : null;
        });
    // From a past run the run id (in `source`) is the input; live previews don't matter.
    const upstream: Record<string, unknown> = {};
    if (ctx.source === 'live') {
        upstreamOf(job, stepId).forEach((u) => {
            const k = upstreamKeys[u];
            upstream[u] = k ? { key: k.key, sid: k.sid ?? null, skipped: k.skipped ?? null } : null;
        });
    }
    return JSON.stringify(
        stable({
            // The server names preview sids after the job id, or "new" before the first save.
            job: job.id || 'new',
            step: resolved,
            edges: incoming.map((e) => ({ from: e.from, condition: e.condition || 'on_success', expression: e.expression })),
            timezone: job.timezone || null,
            scheduledTime: ctx.scheduledTime,
            params,
            source: ctx.source,
            upstream,
        })
    );
}

/** Every step's current key, each built from its upstream steps' current keys and the
 * sids (or skips) of their previews in `previews`. */
export function previewKeys(
    job: JobDefinition,
    ctx: PreviewContext,
    previews: Record<string, LivePreview | undefined>
): Record<string, string> {
    const out: Record<string, string> = {};
    const keyOf = (id: string): string => {
        if (!(id in out)) {
            const ups: UpstreamKeys = {};
            upstreamOf(job, id).forEach((u) => {
                const p = previews[u];
                ups[u] = { key: keyOf(u), sid: p?.sid, skipped: p?.skipped };
            });
            out[id] = previewKey(job, id, ctx, ups);
        }
        return out[id];
    };
    (job.steps || []).forEach((s) => keyOf(s.id));
    return out;
}

/** A step's preview in this tab. `missing`: the server no longer has its search job. */
export interface LivePreview {
    key: string;
    sid?: string;
    skipped?: SkipKind;
    state: 'running' | 'done' | 'failed' | 'skipped' | 'missing';
    startedAt: number;
}

export function isStale(preview: LivePreview, currentKey: string): boolean {
    return preview.key !== currentKey;
}

/** The steps to preview, in order, to preview `stepId`: each upstream step whose preview
 * is missing, stale or gone from the server, or that reads one of those; then the step. */
export function toBeRun(
    job: JobDefinition,
    stepId: string,
    previews: Record<string, LivePreview | undefined>,
    keyOf: (id: string) => string
): string[] {
    const out: string[] = [];
    upstreamOf(job, stepId).forEach((id) => {
        const p = previews[id];
        const own = !p || p.state === 'missing' || isStale(p, keyOf(id));
        if (own || upstreamOf(job, id).some((u) => out.includes(u))) {
            out.push(id);
        }
    });
    return [...out, stepId];
}
