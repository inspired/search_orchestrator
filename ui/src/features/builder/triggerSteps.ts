/* Which steps a trigger starts. A trigger with a `steps` list starts only those (each a step
 * with no line into it); one without starts every such step, as jobs saved before the list
 * existed do. The builder writes a list as soon as a trigger's lines are changed, and
 * `syncTriggerSteps` keeps lists valid after any edit (removed, renamed or no-longer-first
 * steps drop out). Mirrors bin/so/scheduler.py entry_of and model.py's bad_trigger check. */
import type { JobDefinition, Trigger } from '../../api/types';

/** Step ids with no line into them, in step order. */
export function rootSteps(job: JobDefinition): string[] {
    const into = new Set((job.edges || []).map((e) => e.to));
    return (job.steps || []).map((s) => s.id).filter((id) => !into.has(id));
}

/** The steps trigger `t` starts. */
export function startedBy(job: JobDefinition, t: Trigger): string[] {
    const roots = rootSteps(job);
    return Array.isArray(t.steps) ? roots.filter((id) => (t.steps as string[]).includes(id)) : roots;
}

/** The job with trigger `index` starting (`on`) or no longer starting `stepId`. */
export function setTriggerStep(job: JobDefinition, index: number, stepId: string, on: boolean): JobDefinition | null {
    const list = job.triggers || [];
    const t = list[index];
    if (!t || !rootSteps(job).includes(stepId)) {
        return null;
    }
    const now = startedBy(job, t);
    if (now.includes(stepId) === on) {
        return null;
    }
    const steps = on ? [...now, stepId] : now.filter((id) => id !== stepId);
    return { ...job, triggers: list.map((x, i) => (i === index ? { ...x, steps } : x)) };
}

/** Lists without steps that are gone or now have a line into them. Returns `job` itself
 * when nothing changes. */
export function syncTriggerSteps(job: JobDefinition): JobDefinition {
    const list = job.triggers || [];
    if (!list.some((t) => Array.isArray(t.steps))) {
        return job;
    }
    const roots = new Set(rootSteps(job));
    let changed = false;
    const next = list.map((t) => {
        if (!Array.isArray(t.steps)) {
            return t;
        }
        const kept = t.steps.filter((id, i, all) => roots.has(id) && all.indexOf(id) === i);
        if (kept.length === t.steps.length) {
            return t;
        }
        changed = true;
        return { ...t, steps: kept };
    });
    return changed ? { ...job, triggers: next } : job;
}

/** Trigger lists with step `from` renamed to `to`. */
export function renameTriggerSteps(job: JobDefinition, from: string, to: string): JobDefinition {
    const list = job.triggers || [];
    if (!list.some((t) => Array.isArray(t.steps) && t.steps.includes(from))) {
        return job;
    }
    return { ...job, triggers: list.map((t) => (Array.isArray(t.steps) ? { ...t, steps: t.steps.map((id) => (id === from ? to : id)) } : t)) };
}
