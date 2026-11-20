/* Drawing parts for the help page's illustrations: a small flow (the builder's own node
 * shapes and line colours), a side-panel mock, an SPL block, a timeline of bars, a mini
 * calendar, a table and a row of labelled chips. Colours come from theme tokens only, so
 * the pictures follow light and dark mode. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import SplHighlight from '../builder/SplHighlight';
import { FAMILY_STYLE, PORT_STYLE, shapePath } from '../builder/nodeStyle';
import type { Family } from '../builder/nodeStyle';

export type Theme = Record<string, string>;
export const useTheme = () => useSplunkTheme() as unknown as Theme;

const surface = (t: Theme) => t.backgroundColorSection || t.backgroundColor;
const line = (t: Theme) => t.borderColorWeak || t.borderColor;

/** The frame every illustration sits in, with a one-line caption under it. */
export function Figure({ caption, children }: { caption: string; children: React.ReactNode }) {
    const t = useTheme();
    return (
        <figure
            data-testid="help-figure"
            style={{ margin: '8px 0 16px', padding: '12px 14px', background: surface(t), border: `1px solid ${line(t)}`, borderRadius: '8px' }}
        >
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>{children}</div>
            <figcaption style={{ marginTop: '8px', fontSize: '12px', color: t.contentColorMuted }}>{caption}</figcaption>
        </figure>
    );
}

export type Port = 'success' | 'failure' | 'always' | 'if' | 'delayed' | 'late' | 'approval';
export type NodeState = 'succeeded' | 'failed' | 'running' | 'skipped' | 'waiting';

export interface FlowNode {
    id: string;
    f: Family;
    label: string;
    x: number;
    y: number;
    w?: number;
    state?: NodeState;
}

export interface FlowLine {
    from: string;
    to: string;
    port?: Port;
    label?: string;
}

const NODE_H = 40;
const STATE_TOKEN: Record<NodeState, string> = {
    succeeded: 'statusColorNormal',
    failed: 'statusColorHigh',
    running: 'statusColorInfo',
    skipped: 'contentColorMuted',
    waiting: 'statusColorMedium',
};
const STATE_GLYPH: Record<NodeState, string> = { succeeded: '✓', failed: '✗', running: '●', skipped: '»', waiting: '⏸' };

/** A small flow drawn with the builder's shapes; lines go right edge to left edge. */
export function Flow({ nodes, lines = [], width, height, label }: { nodes: FlowNode[]; lines?: FlowLine[]; width: number; height: number; label: string }) {
    const t = useTheme();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const w = (n: FlowNode) => n.w || 120;
    return (
        <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxWidth: `${width}px`, height: 'auto', display: 'block', flex: '1 1 320px' }}>
            {lines.map((l) => {
                const a = byId.get(l.from);
                const b = byId.get(l.to);
                if (!a || !b) {
                    return null;
                }
                const x1 = a.x + w(a);
                const y1 = a.y + NODE_H / 2;
                const x2 = b.x;
                const y2 = b.y + NODE_H / 2;
                const color = t[PORT_STYLE[l.port || 'success'].colorToken];
                const mx = (x1 + x2) / 2;
                return (
                    <g key={`${l.from}-${l.to}`}>
                        <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={color} strokeWidth={2} strokeDasharray={l.port === 'always' ? '6 4' : undefined} />
                        <circle cx={x2} cy={y2} r={3} fill={color} />
                        {l.label && (
                            <text x={mx} y={(y1 + y2) / 2 - 5} textAnchor="middle" fontSize={10} fill={t.contentColorMuted} fontFamily={t.fontFamily}>
                                {l.label}
                            </text>
                        )}
                    </g>
                );
            })}
            {nodes.map((n) => {
                const s = FAMILY_STYLE[n.f];
                const stroke = n.state ? t[STATE_TOKEN[n.state]] : t[s.colorToken];
                return (
                    <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={n.state === 'skipped' ? 0.5 : 1}>
                        <path d={shapePath(s.shape, w(n), NODE_H)} fill={surface(t)} stroke={stroke} strokeWidth={n.state === 'running' ? 3 : 2} />
                        <text x={w(n) / 2} y={NODE_H / 2 + 4} textAnchor="middle" fontSize={11} fill={t.contentColorDefault} fontFamily={t.fontFamily}>
                            {n.label}
                        </text>
                        {n.state && (
                            <text x={w(n) - 4} y={-4} textAnchor="end" fontSize={12} fill={stroke} fontFamily={t.fontFamily}>
                                {STATE_GLYPH[n.state]}
                            </text>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}

/** A mock of a side panel or dialog: a title and label/value rows (a value in [brackets]
 * is drawn as a button). */
export function Panel({ title, rows, width = 260 }: { title: string; rows: Array<[string, string]>; width?: number }) {
    const t = useTheme();
    return (
        <div aria-hidden style={{ flex: `0 1 ${width}px`, minWidth: '200px', border: `1px solid ${line(t)}`, borderRadius: '6px', padding: '8px 10px', fontSize: '12px', background: t.backgroundColor }}>
            <div style={{ fontWeight: 700, marginBottom: '6px' }}>{title}</div>
            {rows.map(([k, v]) => {
                const button = /^\[.*\]$/.test(v);
                return (
                    <div key={k + v} style={{ marginBottom: '6px' }}>
                        {k && <div style={{ color: t.contentColorMuted, fontSize: '11px' }}>{k}</div>}
                        <div
                            style={
                                button
                                    ? { display: 'inline-block', padding: '2px 8px', border: `1px solid ${t.borderColorStrong || line(t)}`, borderRadius: '4px', marginTop: '2px' }
                                    : { padding: '3px 6px', border: `1px solid ${line(t)}`, borderRadius: '3px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                            }
                        >
                            {button ? v.slice(1, -1) : v}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/** SPL with the editor's syntax colours. */
export function Code({ spl }: { spl: string }) {
    const t = useTheme();
    return (
        <pre
            aria-hidden
            style={{ flex: '1 1 300px', margin: 0, padding: '8px 10px', fontFamily: t.monoFontFamily, fontSize: '12px', whiteSpace: 'pre-wrap', background: t.backgroundColor, border: `1px solid ${line(t)}`, borderRadius: '6px' }}
        >
            <SplHighlight text={spl} />
        </pre>
    );
}

export type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'muted';
const TONE_TOKEN: Record<Tone, string> = { ok: 'statusColorNormal', bad: 'statusColorHigh', warn: 'statusColorMedium', info: 'statusColorInfo', muted: 'contentColorMuted' };
export const toneColor = (t: Theme, tone: Tone) => t[TONE_TOKEN[tone]];

/** Horizontal bars on a shared time axis (a run graph or a performance view). */
export function Bars({ rows, label }: { rows: Array<{ name: string; start: number; end: number; tone: Tone; note?: string }>; label: string }) {
    const t = useTheme();
    const max = Math.max(...rows.map((r) => r.end));
    const rowH = 22;
    const nameW = 120;
    const span = 300;
    return (
        <svg role="img" aria-label={label} viewBox={`0 0 ${nameW + span + 70} ${rows.length * rowH + 4}`} style={{ width: '100%', maxWidth: '520px', height: 'auto', flex: '1 1 320px' }}>
            {rows.map((r, i) => (
                <g key={r.name} transform={`translate(0,${i * rowH})`}>
                    <text x={0} y={15} fontSize={11} fill={t.contentColorDefault} fontFamily={t.fontFamily}>
                        {r.name}
                    </text>
                    <rect x={nameW} y={5} width={span} height={12} rx={3} fill={line(t)} opacity={0.4} />
                    <rect x={nameW + (r.start / max) * span} y={5} width={Math.max(4, ((r.end - r.start) / max) * span)} height={12} rx={3} fill={toneColor(t, r.tone)} />
                    {r.note && (
                        <text x={nameW + span + 6} y={15} fontSize={10} fill={t.contentColorMuted} fontFamily={t.fontFamily}>
                            {r.note}
                        </text>
                    )}
                </g>
            ))}
        </svg>
    );
}

/** Labelled chips: a dot in a tone and a short text. */
export function Chips({ items }: { items: Array<{ text: string; tone: Tone; hollow?: boolean }> }) {
    const t = useTheme();
    return (
        <div aria-hidden style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: '1 1 300px', alignContent: 'flex-start' }}>
            {items.map((c) => (
                <span key={c.text} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', border: `1px solid ${line(t)}`, borderRadius: '12px', fontSize: '12px', background: t.backgroundColor }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', boxSizing: 'border-box', background: c.hollow ? 'none' : toneColor(t, c.tone), border: `1.5px solid ${toneColor(t, c.tone)}` }} />
                    {c.text}
                </span>
            ))}
        </div>
    );
}

/** A small table: header row and rows of text. */
export function MiniTable({ head, rows }: { head: string[]; rows: string[][] }) {
    const t = useTheme();
    const cell: React.CSSProperties = { padding: '3px 8px', borderBottom: `1px solid ${line(t)}`, textAlign: 'left' };
    return (
        <table aria-hidden style={{ flex: '1 1 300px', borderCollapse: 'collapse', fontSize: '12px', background: t.backgroundColor }}>
            <thead>
                <tr>
                    {head.map((h) => (
                        <th key={h} style={{ ...cell, color: t.contentColorMuted, fontWeight: 600 }}>
                            {h}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map((r) => (
                    <tr key={r.join('|')}>
                        {r.map((c, i) => (
                            // eslint-disable-next-line react/no-array-index-key
                            <td key={i} style={cell}>
                                {c}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** A week of days with items as dots (scheduled hollow, runs filled by tone). */
export function MiniCalendar({ days, label }: { days: Array<{ day: string; items: Array<{ tone: Tone; hollow?: boolean }> }>; label: string }) {
    const t = useTheme();
    const cw = 64;
    return (
        <svg role="img" aria-label={label} viewBox={`0 0 ${days.length * cw} 96`} style={{ width: '100%', maxWidth: `${days.length * cw}px`, height: 'auto', flex: '1 1 320px' }}>
            {days.map((d, i) => (
                <g key={d.day} transform={`translate(${i * cw},0)`}>
                    <rect x={1} y={1} width={cw - 2} height={94} fill={t.backgroundColor} stroke={line(t)} />
                    <text x={6} y={14} fontSize={10} fill={t.contentColorMuted} fontFamily={t.fontFamily}>
                        {d.day}
                    </text>
                    {d.items.map((it, j) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <circle key={j} cx={12 + (j % 4) * 13} cy={30 + Math.floor(j / 4) * 14} r={4.5} fill={it.hollow ? 'none' : toneColor(t, it.tone)} stroke={toneColor(t, it.tone)} strokeWidth={1.5} />
                    ))}
                </g>
            ))}
        </svg>
    );
}

/** A short list of numbered steps or facts beside a picture. */
export function Notes({ items }: { items: string[] }) {
    const t = useTheme();
    return (
        <ol aria-hidden style={{ flex: '1 1 220px', margin: 0, paddingLeft: '18px', fontSize: '12px', color: t.contentColorDefault }}>
            {items.map((i) => (
                <li key={i} style={{ marginBottom: '4px' }}>
                    {i}
                </li>
            ))}
        </ol>
    );
}

/** The colour token a family is drawn in, for text that refers to it. */
export const familyColor = (t: Theme, f: Family) => t[FAMILY_STYLE[f].colorToken];
