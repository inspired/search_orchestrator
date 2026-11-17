/* Pure graph helpers for the builder: cycle checks, dagre layout, run-when presets and a
 * light client-side check. The server's POST jobs/validate is authoritative. */
import * as dagre from '@dagrejs/dagre';
import { outputIssue } from './outputs';
import type { Edge, Issue, JobDefinition, RunWhen, StepDef } from '../../api/types';
import { conditionKind, splConditionIssues } from './conditions';

export interface Pos {
    x: number;
    y: number;
}

export type Positions = Record<string, Pos>;

type Link = Pick<Edge, 'from' | 'to'>;

/** Node size on the canvas and in the read-only graph. */
export const NODE_W = 180;
export const NODE_H = 52;

/** Mirrors model.STEP_ID_RE (plus its "no __" rule). */
export const STEP_ID_RE = /^[a-z][a-z0-9_]{0,39}$/;

export function isStepId(id: string): boolean {
    return STEP_ID_RE.test(id) && !id.includes('__');
}

/** True if adding from -> to would close a cycle: `to` already reaches `from`. */
export function wouldCycle(edges: Link[], from: string, to: string): boolean {
    if (from === to) {
        return true;
    }
    const seen = new Set<string>();
    const stack = [to];
    while (stack.length) {
        const n = stack.pop() as string;
        if (n === from) {
            return true;
        }
        if (!seen.has(n)) {
            seen.add(n);
            edges.forEach((e) => {
                if (e.from === n) {
                    stack.push(e.to);
                }
            });
        }
    }
    return false;
}

/** Ids of the steps `id` depends on. */
export function parentsOf(edges: Link[], id: string): string[] {
    return edges.filter((e) => e.to === id).map((e) => e.from);
}

/** Top-left corner of each node, laid out top to bottom with dagre. */
export function autoLayout(steps: Pick<StepDef, 'id'>[], edges: Link[]): Positions {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    const ids = new Set(steps.map((s) => s.id));
    steps.forEach((s) => g.setNode(s.id, { width: NODE_W, height: NODE_H }));
    edges.forEach((e) => {
        if (ids.has(e.from) && ids.has(e.to)) {
            g.setEdge(e.from, e.to);
        }
    });
    dagre.layout(g);
    const out: Positions = {};
    steps.forEach((s) => {
        const n = g.node(s.id);
        out[s.id] = { x: Math.round(n.x - NODE_W / 2), y: Math.round(n.y - NODE_H / 2) };
    });
    return out;
}

/** Day-level presets, matched against the run's scheduled time. */
export const RUN_WHEN_PRESETS: { key: string; label: string; value: RunWhen }[] = [
    { key: 'mondays', label: 'Mondays', value: { kind: 'cron', value: '* * * * 1' } },
    { key: 'first_of_month', label: '1st of month', value: { kind: 'cron', value: '* * 1 * *' } },
];

export function runWhenPreset(key: string): RunWhen | null {
    const found = RUN_WHEN_PRESETS.find((p) => p.key === key);
    return found ? { ...found.value } : null;
}

/** The run-when choice a step's value corresponds to: every, a preset key, cron or expression. */
export function runWhenChoice(rw: RunWhen | null | undefined): string {
    if (!rw || !rw.kind) {
        return 'every';
    }
    if (rw.kind === 'cron') {
        const found = RUN_WHEN_PRESETS.find((p) => p.value.value === (rw.value || '').trim());
        return found ? found.key : 'cron';
    }
    return rw.kind === 'expression' ? 'expression' : 'cron';
}

/** Every code findIssues can emit; a server error with one of these is rechecked live. */
const CLIENT_CODES = [
    'bad_job',
    'bad_step_id',
    'reserved_step_id',
    'duplicate_step',
    'bad_step',
    'previous_needs_pipe',
    'previous_needs_dependency',
    'bad_run_when',
    'unknown_edge_step',
    'cycle',
    'bad_expression',
    'bad_output',
    'condition_writes',
] as const;
type ClientCode = (typeof CLIENT_CODES)[number];
export const CLIENT_ISSUE_CODES: ReadonlySet<string> = new Set<string>(CLIENT_CODES);

const issue = (level: Issue['level'], code: ClientCode, message: string, step: string | null = null): Issue => ({
    level,
    code,
    message,
    step,
});

/** A quick check while editing; codes and messages match model.py where they overlap. */
export function findIssues(job: JobDefinition): Issue[] {
    const out: Issue[] = [];
    if (!(job.name || '').trim()) {
        out.push(issue('error', 'bad_job', 'the job needs a name; type one in Job name'));
    }
    const seen = new Set<string>();
    (job.steps || []).forEach((s) => {
        if (!isStepId(s.id || '')) {
            out.push(issue('error', 'bad_step_id', `step id '${s.id}' isn't valid; use lowercase letters, numbers and _ (no __), starting with a letter`, s.id));
        } else if (s.id === 'run') {
            out.push(issue('error', 'reserved_step_id', "step id 'run' is reserved for run tokens; choose another id", s.id));
        } else if (seen.has(s.id)) {
            out.push(issue('error', 'duplicate_step', `two steps use the id '${s.id}'; give each step its own id`, s.id));
        }
        seen.add(s.id);
        if (s.type === 'saved_search' && !(s.saved_search_ref || '').trim()) {
            out.push(issue('error', 'bad_step', 'pick a saved search for this step', s.id));
        }
        if (s.type === 'inline' && !(s.spl || '').trim()) {
            out.push(issue('error', 'bad_step', 'this step has no search; write one in Search', s.id));
        }
        if (s.type === 'previous') {
            // model.py's checks and messages (an empty search fails the first one there too).
            if (!(s.spl || '').trimStart().startsWith('|')) {
                out.push(issue('error', 'previous_needs_pipe', 'the search must start with |, such as | stats count', s.id));
            }
            if (!(job.edges || []).some((e) => e.to === s.id)) {
                out.push(issue('error', 'previous_needs_dependency', 'this step needs a step before it to read from; add one in Depends on', s.id));
            }
        }
        const outputProblem = s.output ? outputIssue(s.output) : null;
        if (outputProblem) {
            out.push(issue('error', 'bad_output', outputProblem, s.id));
        }
        if (s.run_when && s.run_when.kind && !(s.run_when.value || '').trim()) {
            out.push(issue('error', 'bad_run_when', 'run when is empty; fill it in or turn Run when off', s.id));
        }
    });
    const edges = job.edges || [];
    edges.forEach((e, i) => {
        const missing = [e.from, e.to].filter((end) => !seen.has(end));
        missing.forEach((end) => {
            out.push(issue('error', 'unknown_edge_step', `a dependency points at step '${end}', which doesn't exist; remove the dependency`));
        });
        if (!missing.length && wouldCycle(edges.slice(0, i), e.from, e.to)) {
            out.push(issue('error', 'cycle', 'steps depend on each other in a loop; remove a dependency to break it'));
        }
        if (e.condition === 'expression' && conditionKind(e) === 'simple' && !(e.expression || '').trim()) {
            out.push(issue('error', 'bad_expression', `dependency ${e.from}->${e.to}: empty expression`, e.to));
        } else if (e.condition === 'expression') {
            splConditionIssues(e).forEach((found) => out.push(issue('error', found.code, found.message, e.to)));
        }
    });
    return out;
}

/** Issues grouped by step id; job-level ones (step null) under ''. */
export function issuesByStep(issues: Issue[]): Record<string, Issue[]> {
    const out: Record<string, Issue[]> = {};
    issues.forEach((i) => {
        const key = i.step || '';
        (out[key] = out[key] || []).push(i);
    });
    return out;
}

/** A node's run-when line: "every run", "Mondays only", "when <cron>" or "if <expression>". */
export function runWhenSummary(rw: RunWhen | null | undefined): string {
    const choice = runWhenChoice(rw);
    if (choice === 'every') {
        return 'every run';
    }
    const preset = RUN_WHEN_PRESETS.find((p) => p.key === choice);
    if (preset) {
        return `${preset.label} only`;
    }
    const text = ((rw && rw.value) || '').trim();
    const short = text.length > 22 ? `${text.slice(0, 21)}…` : text;
    return choice === 'expression' ? `if ${short}` : `when ${short}`;
}
