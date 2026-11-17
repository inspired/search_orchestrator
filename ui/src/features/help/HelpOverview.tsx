/* The visual top of the help page: a quick start, a drawn example flow, the node shapes and
 * line colours of the flow editor, and cards linking to each feature's section of the guide.
 * Shapes and colours come from nodeStyle and theme tokens, so they match the builder. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import Calendar from '@splunk/react-icons/Calendar';
import ChartGauge from '@splunk/react-icons/ChartGauge';
import Clock from '@splunk/react-icons/Clock';
import Filter from '@splunk/react-icons/Filter';
import Hourglass from '@splunk/react-icons/Hourglass';
import LayersTriple from '@splunk/react-icons/LayersTriple';
import Magnifier from '@splunk/react-icons/Magnifier';
import Megaphone from '@splunk/react-icons/Megaphone';
import NodeConnection from '@splunk/react-icons/NodeConnection';
import PuzzlePiece from '@splunk/react-icons/PuzzlePiece';
import Pulse from '@splunk/react-icons/Pulse';
import ArrowClockwise from '@splunk/react-icons/ArrowClockwise';
import Shield from '@splunk/react-icons/Shield';
import Tag from '@splunk/react-icons/Tag';
import Bookmark from '@splunk/react-icons/Bookmark';
import Stopwatch from '@splunk/react-icons/Stopwatch';
import { CATALOG } from '../builder/nodeCatalog';
import { FAMILY_OF, FAMILY_STYLE, PORT_STYLE, shapePath } from '../builder/nodeStyle';
import type { Family, Shape } from '../builder/nodeStyle';

type Theme = Record<string, string>;

export interface FeatureCard {
    title: string;
    text: string;
    anchor: string;
    Icon: React.ComponentType<{ width?: number | string; height?: number | string }>;
}

/** One card per feature, linking to its section of the guide below. */
export const FEATURES: FeatureCard[] = [
    { title: 'Flow editor', text: 'Drag nodes, connect them with +, group, align and copy.', anchor: 'the-flow-editor', Icon: NodeConnection },
    { title: 'Conditions', text: 'Simple comparisons, SPL expressions or a search that must return rows.', anchor: 'conditions', Icon: Filter },
    { title: 'Tokens', text: 'Use results, run times and parameters in later searches: $step.first.field$.', anchor: 'tokens', Icon: Tag },
    { title: 'Parameters', text: 'Lists, numbers and text you pick on Run now; defaults for schedules.', anchor: 'parameters', Icon: Bookmark },
    { title: 'Approval steps', text: 'Pause a run until someone approves, with a timeout and approver roles.', anchor: 'approval-steps', Icon: Shield },
    { title: 'Deadlines', text: 'Finish by a time or within a duration, or get a Late alert.', anchor: 'deadline', Icon: Hourglass },
    { title: 'Teams, PagerDuty, ServiceNow', text: 'Webhook presets with severity, urgency and impact.', anchor: 'microsoft-teams-pagerduty-and-servicenow', Icon: Megaphone },
    { title: 'Backfill', text: 'Run a job for each missed schedule slot in a past range.', anchor: 'backfill', Icon: ArrowClockwise },
    { title: 'Calendar', text: 'Day, week and month views of schedules, runs and backfills.', anchor: 'calendar', Icon: Calendar },
    { title: 'Dependencies', text: 'Which jobs start which, drawn as one graph.', anchor: 'dependencies', Icon: LayersTriple },
    { title: 'Version history', text: 'Every save is a version: compare and restore.', anchor: 'history', Icon: Clock },
    { title: 'Snippets', text: 'Save nodes as a reusable sub-flow and insert them anywhere.', anchor: 'snippets', Icon: PuzzlePiece },
    { title: 'Run graph', text: 'Watch a run live: active steps pulse and lines flow.', anchor: 'the-run-graph', Icon: Pulse },
    { title: 'Performance', text: 'Runtime, events scanned, disk, CPU and memory per step.', anchor: 'performance', Icon: Stopwatch },
    { title: 'Run health', text: 'A dashboard from the audit index and _internal.', anchor: 'run-health-dashboard', Icon: ChartGauge },
    { title: '| orchestrate', text: 'Start, check and test jobs from a search.', anchor: 'the--orchestrate-command', Icon: Magnifier },
];

const STEPS = [
    { n: 1, title: 'Create a job', text: 'Jobs → Create job, or Browse examples to start from one of eleven.' },
    { n: 2, title: 'Connect nodes', text: 'Point at a node, click + and pick what happens next.' },
    { n: 3, title: 'Preview and save', text: 'Preview runs each search for real; Save checks the whole flow.' },
    { n: 4, title: 'Run and follow', text: 'Run now, then watch the run graph and the Calendar.' },
];

function Section({ title, children, theme }: { title: string; children: React.ReactNode; theme: Theme }) {
    return (
        <section style={{ margin: '28px 0' }}>
            <h2 style={{ fontSize: '18px', margin: '0 0 12px', color: theme.contentColorDefault }}>{title}</h2>
            {children}
        </section>
    );
}

const card = (theme: Theme): React.CSSProperties => ({
    background: theme.backgroundColorSection || theme.backgroundColor,
    border: `1px solid ${theme.borderColorWeak || theme.borderColor}`,
    borderRadius: '8px',
    padding: '12px 14px',
});

function Shape({ shape, color, w, h, fill }: { shape: Shape; color: string; w: number; h: number; fill: string }) {
    return <path d={shapePath(shape, w, h)} fill={fill} stroke={color} strokeWidth={2} />;
}

interface DiagramNode {
    id: string;
    family: Family;
    label: string;
    x: number;
    y: number;
    w?: number;
}

const DIAGRAM_NODES: DiagramNode[] = [
    { id: 'trigger', family: 'trigger', label: 'Every day 06:00', x: 10, y: 110 },
    { id: 'search', family: 'search', label: 'Count errors', x: 180, y: 110 },
    { id: 'if', family: 'condition', label: 'errors > 50?', x: 350, y: 110, w: 120 },
    { id: 'approve', family: 'approval', label: 'Approve', x: 510, y: 40 },
    { id: 'lookup', family: 'write', label: 'Save to lookup', x: 510, y: 180 },
    { id: 'page', family: 'notify', label: 'Page on-call', x: 680, y: 40 },
    { id: 'chain', family: 'chain', label: 'Start report job', x: 680, y: 180 },
];

const DIAGRAM_LINES: Array<{ from: string; to: string; port: 'success' | 'failure' | 'always' | 'if' }> = [
    { from: 'trigger', to: 'search', port: 'success' },
    { from: 'search', to: 'if', port: 'success' },
    { from: 'if', to: 'approve', port: 'if' },
    { from: 'search', to: 'lookup', port: 'always' },
    { from: 'approve', to: 'page', port: 'success' },
    { from: 'lookup', to: 'chain', port: 'success' },
    { from: 'approve', to: 'lookup', port: 'failure' },
];

const NODE_W = 140;
const NODE_H = 48;

/** A small example job drawn with the builder's own shapes and line colours. */
export function FlowDiagram({ theme }: { theme: Theme }) {
    const byId = new Map(DIAGRAM_NODES.map((n) => [n.id, n]));
    const width = (n: DiagramNode) => n.w || NODE_W;
    const fill = theme.backgroundColorSection || theme.backgroundColor;
    return (
        <svg
            role="img"
            aria-label="An example job: a daily trigger starts a search; if errors are above 50 an approval step asks before paging on-call, and the results are saved to a lookup either way, which then starts a report job."
            viewBox="0 0 830 250"
            style={{ width: '100%', maxWidth: '900px', height: 'auto', display: 'block' }}
        >
            {DIAGRAM_LINES.map((l) => {
                const a = byId.get(l.from)!;
                const b = byId.get(l.to)!;
                const x1 = a.x + width(a);
                const y1 = a.y + NODE_H / 2;
                const x2 = b.x;
                const y2 = b.y + NODE_H / 2;
                const back = x2 <= x1;
                const d = back
                    ? `M${a.x + width(a) / 2},${a.y + NODE_H} C${a.x + width(a) / 2},${y2} ${b.x + width(b) / 2},${b.y - 30} ${b.x + width(b) / 2},${b.y}`
                    : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
                const color = theme[PORT_STYLE[l.port].colorToken];
                return (
                    <g key={`${l.from}-${l.to}`}>
                        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray={l.port === 'always' ? '6 4' : undefined} />
                        <circle cx={back ? b.x + width(b) / 2 : x2} cy={back ? b.y : y2} r={3} fill={color} />
                    </g>
                );
            })}
            {DIAGRAM_NODES.map((n) => {
                const s = FAMILY_STYLE[n.family];
                return (
                    <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                        <Shape shape={s.shape} color={theme[s.colorToken]} w={width(n)} h={NODE_H} fill={fill} />
                        <text x={width(n) / 2} y={NODE_H / 2 + 4} textAnchor="middle" fontSize={12} fill={theme.contentColorDefault} fontFamily={theme.fontFamily}>
                            {n.label}
                        </text>
                        <text x={width(n) / 2} y={-6} textAnchor="middle" fontSize={10} fill={theme.contentColorMuted} fontFamily={theme.fontFamily}>
                            {s.label}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

function examples(family: Family): string {
    if (family === 'job') {
        return 'Actions for the whole job';
    }
    return CATALOG.filter((e) => FAMILY_OF[e.kind] === family)
        .map((e) => e.label)
        .join(', ');
}

const LINE_PORTS = ['success', 'failure', 'always', 'if', 'delayed', 'late', 'approval'] as const;

export default function HelpOverview() {
    const theme = useSplunkTheme() as unknown as Theme;
    const muted = theme.contentColorMuted;
    const grid = (min: number): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: '12px' });
    return (
        <div data-testid="help-overview">
            <div
                style={{
                    ...card(theme),
                    padding: '20px 24px',
                    borderLeft: `4px solid ${theme[FAMILY_STYLE.search.colorToken]}`,
                }}
            >
                <h1 style={{ fontSize: '24px', margin: '0 0 6px' }}>Search Orchestrator</h1>
                <p style={{ margin: 0, color: muted, fontSize: '14px' }}>
                    Chain Splunk searches into jobs: run them on a schedule or after each other, branch on results, ask for approval, write to indexes and
                    lookups, and alert when something fails or runs late.
                </p>
            </div>

            <Section title="Get started in four steps" theme={theme}>
                <ol style={{ ...grid(190), listStyle: 'none', margin: 0, padding: 0 }}>
                    {STEPS.map((s) => (
                        <li key={s.n} style={{ ...card(theme), display: 'flex', gap: '10px' }}>
                            <span
                                aria-hidden
                                style={{
                                    flex: 'none',
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 700,
                                    color: theme[FAMILY_STYLE.search.colorToken],
                                    border: `2px solid ${theme[FAMILY_STYLE.search.colorToken]}`,
                                }}
                            >
                                {s.n}
                            </span>
                            <div>
                                <div style={{ fontWeight: 600 }}>{s.title}</div>
                                <div style={{ color: muted, fontSize: '13px' }}>{s.text}</div>
                            </div>
                        </li>
                    ))}
                </ol>
            </Section>

            <Section title="What a job looks like" theme={theme}>
                <div style={card(theme)}>
                    <FlowDiagram theme={theme} />
                    <p style={{ margin: '8px 0 0', color: muted, fontSize: '13px' }}>
                        Each node is a step, trigger or action; its shape and colour say what kind. Lines say when the next node runs: green when the step
                        succeeds, red when it fails, dashed grey either way, and through a ◇ condition only when it holds.
                    </p>
                </div>
            </Section>

            <Section title="Node shapes" theme={theme}>
                <ul style={{ ...grid(240), listStyle: 'none', margin: 0, padding: 0 }}>
                    {(Object.keys(FAMILY_STYLE) as Family[]).map((family) => {
                        const s = FAMILY_STYLE[family];
                        return (
                            <li key={family} style={{ ...card(theme), display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <svg width={56} height={34} viewBox="-2 -2 56 34" aria-hidden style={{ flex: 'none' }}>
                                    <Shape shape={s.shape} color={theme[s.colorToken]} w={52} h={30} fill="none" />
                                </svg>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 600 }}>{s.label}</div>
                                    <div style={{ color: muted, fontSize: '12px' }}>{examples(family)}</div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </Section>

            <Section title="Line colours" theme={theme}>
                <ul style={{ ...grid(200), listStyle: 'none', margin: 0, padding: 0 }}>
                    {LINE_PORTS.map((p) => {
                        const s = PORT_STYLE[p];
                        const color = theme[s.colorToken];
                        return (
                            <li key={p} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <svg width={64} height={16} aria-hidden style={{ flex: 'none' }}>
                                    <path d="M2,8 H54" stroke={color} strokeWidth={2} strokeDasharray={p === 'always' ? '6 4' : undefined} />
                                    <circle cx={58} cy={8} r={3} fill={color} />
                                </svg>
                                <span aria-hidden style={{ color, width: '16px', textAlign: 'center' }}>
                                    {s.glyph}
                                </span>
                                <span>{s.label}</span>
                            </li>
                        );
                    })}
                </ul>
            </Section>

            <Section title="Features" theme={theme}>
                <ul style={{ ...grid(230), listStyle: 'none', margin: 0, padding: 0 }}>
                    {FEATURES.map(({ title, text, anchor, Icon }) => (
                        <li key={anchor}>
                            <a
                                href={`#${anchor}`}
                                style={{ ...card(theme), display: 'flex', gap: '12px', height: '100%', boxSizing: 'border-box', textDecoration: 'none', color: theme.contentColorDefault }}
                            >
                                <span aria-hidden style={{ flex: 'none', color: theme[FAMILY_STYLE.search.colorToken], paddingTop: '2px' }}>
                                    <Icon width={20} height={20} />
                                </span>
                                <span>
                                    <span style={{ display: 'block', fontWeight: 600 }}>{title}</span>
                                    <span style={{ display: 'block', color: muted, fontSize: '13px' }}>{text}</span>
                                </span>
                            </a>
                        </li>
                    ))}
                </ul>
            </Section>
        </div>
    );
}
