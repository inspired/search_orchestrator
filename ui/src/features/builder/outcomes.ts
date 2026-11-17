/* Pure outcome model for the + handle: what a node can do "when" something happens, which
 * outcomes are used, and how lines are labelled. */
import type { JobDefinition } from '../../api/types';
import type { FlowGraph, FlowLink, PortId } from './nodeModel';
import { JOB_KEY, buildGraph, canConnect, nodeKindOfStep, outputPorts } from './nodeModel';
import { PORT_STYLE } from './nodeStyle';

export type Outcome = Exclude<PortId, 'then'>;

export interface WhenOption {
    outcome: Outcome;
    label: string;
    glyph: string;
    count: number;
    note?: string;
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
    success: 'Succeeds',
    failure: 'Fails',
    always: 'Finishes either way',
    start: 'Starts',
    delayed: 'Is delayed',
    if: 'If a condition is true',
};

const MAX_EXPR = 24;

function kindOf(job: JobDefinition, key: string) {
    if (key === JOB_KEY) {
        return 'job' as const;
    }
    if (key.startsWith('step:')) {
        const step = (job.steps || []).find((s) => s.id === key.slice(5));
        return step ? nodeKindOfStep(step) : null;
    }
    return null;
}

function outcomesOf(job: JobDefinition, key: string): Outcome[] {
    const kind = kindOf(job, key);
    return kind ? (outputPorts(kind).filter((p) => p !== 'then') as Outcome[]) : [];
}

export function whenOptions(job: JobDefinition, from: string, to?: string | null): WhenOption[] {
    const graph = buildGraph(job);
    return outcomesOf(job, from)
        .filter((o) => !to || canConnect(job, from, o, to).ok)
        .map((o) => {
            const opt: WhenOption = {
                outcome: o,
                label: OUTCOME_LABEL[o],
                glyph: PORT_STYLE[o].glyph,
                count: graph.links.filter((l) => l.from === from && l.port === o).length,
            };
            if (!to && (o === 'start' || o === 'delayed')) {
                opt.note = 'actions only';
            }
            return opt;
        });
}

const ORDER: PortId[] = ['success', 'failure', 'always', 'start', 'delayed', 'if', 'then'];

export function usedOutcomes(graph: FlowGraph, key: string): PortId[] {
    const used = new Set<PortId>();
    graph.links.forEach((l) => {
        if (l.from === key && l.port) {
            used.add(l.port);
        }
    });
    return ORDER.filter((p) => used.has(p));
}

function conditionText(job: JobDefinition, key: string): string {
    const m = /^cond:(.*)>(.*)$/.exec(key);
    const edge = m && (job.edges || []).find((e) => e.from === m[1] && e.to === m[2] && e.condition === 'expression');
    const expr = ((edge && edge.expression) || '').trim();
    if (!expr) {
        return OUTCOME_LABEL.if;
    }
    return shorten(expr);
}

const shorten = (text: string) => (text.length > MAX_EXPR ? `${text.slice(0, MAX_EXPR)}…` : text);

/** The label the canvas draws on a line, from the graph alone: the glyph and word ("✗ Fails"),
 * "◇ If" on a step-to-condition line, and the condition's expression (shortened) on the line
 * from the diamond to its target. Trigger lines have none. */
export function flowLinkLabel(graph: FlowGraph, link: FlowLink): string {
    if (link.kind === 'trigger' || !link.port) {
        return '';
    }
    if (link.port === 'then') {
        const cond = graph.nodes.find((n) => n.key === link.from);
        return shorten(((cond && cond.detail) || OUTCOME_LABEL.if).trim());
    }
    if (link.port === 'if') {
        return `${PORT_STYLE.if.glyph} If`;
    }
    return `${PORT_STYLE[link.port].glyph} ${OUTCOME_LABEL[link.port as Outcome]}`;
}

export function linkLabel(job: JobDefinition, link: FlowLink): string {
    if (link.kind === 'trigger' || !link.port) {
        return '';
    }
    if (link.kind === 'condition') {
        return conditionText(job, link.from.startsWith('cond:') ? link.from : link.to);
    }
    return `${PORT_STYLE[link.port].glyph} ${OUTCOME_LABEL[link.port as Outcome]}`;
}

/** The outcomes a line's menu offers. A condition's legs can only become a plain line (the
 * condition is dropped), so they offer Succeeds, Fails and Finishes either way. */
export function lineMenuOutcomes(job: JobDefinition, link: FlowLink): Outcome[] {
    if (link.kind === 'trigger') {
        return [];
    }
    if (link.kind === 'condition') {
        const cond = link.from.startsWith('cond:') ? link.from : link.to;
        const m = /^cond:(.*)>(.*)$/.exec(cond);
        const plain: Outcome[] = ['success', 'failure', 'always'];
        return m ? outcomesOf(job, `step:${m[1]}`).filter((o) => plain.includes(o)) : [];
    }
    return whenOptions(job, link.from, link.to).map((o) => o.outcome);
}
