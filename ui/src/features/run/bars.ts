/* The timeline's rows: one bar per step on a shared time axis. Pure, so the layout can be
 * tested without rendering. */
import type { RunDetail, StepStatus } from '../../api/types';
import { isStepDelayed, statusLabel } from '../../components/StatusText';

export type BarKind = 'running' | 'waiting' | 'done' | 'failed' | 'skipped';

export interface Bar {
    stepId: string;
    label: string;
    kind: BarKind;
    /** Left edge and width as a percentage of the axis; 0 for a step with no bar. */
    startPct: number;
    widthPct: number;
    statusText: string;
    delayed: boolean;
}

const ACTIVE_RUN = ['queued', 'running', 'blocked', 'paused'];
const WORKING = ['ready', 'starting', 'running', 'retrying'];
const MIN_WIDTH = 1;

function kindOf(step: StepStatus, runActive: boolean): BarKind {
    const { state } = step;
    if (WORKING.includes(state)) {
        return 'running';
    }
    if (state === 'waiting') {
        return runActive ? 'waiting' : 'skipped';
    }
    if (state === 'succeeded') {
        return 'done';
    }
    if (state === 'failed') {
        return 'failed';
    }
    if (state === 'skipped') {
        return 'skipped';
    }
    // cancelled or abandoned: a bar only if the step actually started
    return step.started_at ? 'failed' : 'skipped';
}

export function bars(run: RunDetail, now: number): Bar[] {
    const status = run.steps || {};
    const steps = (run.definition && run.definition.steps) || [];
    const runActive = ACTIVE_RUN.includes(run.state);
    const origin = run.started_at ?? run.queued_at ?? run.created_at ?? now;
    let end = runActive ? now : run.ended_at ?? now;
    steps.forEach((s) => {
        const st = status[s.id];
        if (st && st.ended_at && st.ended_at > end) {
            end = st.ended_at;
        }
    });
    const total = Math.max(end - origin, 1);
    const pct = (t: number) => Math.min(100, Math.max(0, ((t - origin) / total) * 100));

    const preds: Record<string, string[]> = {};
    (run.definition.edges || []).forEach((e) => {
        (preds[e.to] = preds[e.to] || []).push(e.from);
    });

    return steps.map((s) => {
        const st: StepStatus = status[s.id] || { state: 'waiting' };
        const kind = kindOf(st, runActive);
        const delayed = isStepDelayed(st);
        let startPct = 0;
        let widthPct = 0;
        if (kind === 'waiting') {
            // waiting since its predecessors finished (or the run started)
            const since = Math.max(
                origin,
                ...(preds[s.id] || []).map((p) => (status[p] && status[p].ended_at) || origin)
            );
            startPct = pct(since);
            widthPct = Math.max(100 - startPct, MIN_WIDTH);
        } else if (kind !== 'skipped') {
            const from = st.started_at ?? origin;
            const to = WORKING.includes(st.state) ? now : st.ended_at ?? now;
            startPct = pct(from);
            widthPct = Math.max(pct(Math.max(to, from)) - startPct, MIN_WIDTH);
            widthPct = Math.min(widthPct, 100 - startPct || MIN_WIDTH);
        }
        return {
            stepId: s.id,
            label: s.name || s.id,
            kind,
            startPct,
            widthPct,
            statusText: statusLabel(st.state, delayed, st.skip_kind),
            delayed,
        };
    });
}
