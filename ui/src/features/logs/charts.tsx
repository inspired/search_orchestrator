/* Small charts for the Troubleshooting page, drawn as SVG with theme tokens (light and
 * dark): stacked columns over time, a line over time (gaps where there is no value) and a
 * ranked bar list. Each has a legend for two or more series and a hover tooltip; columns
 * and legend items can be clicked to filter. One measure per chart (no second axis). */
import React, { useState } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';

export type Theme = Record<string, string>;
export const useTheme = () => useSplunkTheme() as unknown as Theme;

export interface Series {
    key: string;
    label: string;
    color: string;
    dashed?: boolean;
}

export interface Point {
    time: string;
    [key: string]: number | string | null;
}

const W = 1100;
const PAD_L = 40;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 22;

export function timeLabel(iso: string, long = false): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
        return iso;
    }
    const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return long ? `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${hm}` : hm;
}

function niceMax(v: number): number {
    if (v <= 0) {
        return 1;
    }
    const p = 10 ** Math.floor(Math.log10(v));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function fmt(v: number, unit?: string): string {
    if (unit === 'ms') {
        return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
    }
    return v >= 10000 ? `${Math.round(v / 1000)}k` : String(Math.round(v * 10) / 10);
}

export function Legend({ series, onPick, hidden = [] }: { series: Series[]; onPick?: (key: string) => void; hidden?: string[] }) {
    const t = useTheme();
    if (series.length < 2) {
        return null;
    }
    return (
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12px', color: t.contentColorDefault, margin: '0 0 4px' }}>
            {series.map((s) => (
                <button
                    key={s.key}
                    type="button"
                    onClick={onPick ? () => onPick(s.key) : undefined}
                    disabled={!onPick}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: onPick ? 'pointer' : 'default', opacity: hidden.includes(s.key) ? 0.4 : 1 }}
                >
                    <span style={{ width: 14, height: s.dashed ? 0 : 10, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined, background: s.dashed ? undefined : s.color, borderRadius: 2 }} />
                    {s.label}
                </button>
            ))}
        </div>
    );
}

function Tooltip({ x, children }: { x: number; children: React.ReactNode }) {
    const t = useTheme();
    const left = `${Math.min(Math.max((x / W) * 100, 12), 88)}%`;
    return (
        <div
            role="tooltip"
            style={{
                position: 'absolute',
                top: 0,
                left,
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                background: t.backgroundColorPopup || t.backgroundColor,
                border: `1px solid ${t.borderColor}`,
                borderRadius: '6px',
                padding: '6px 8px',
                fontSize: '12px',
                color: t.contentColorDefault,
                boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                whiteSpace: 'nowrap',
                zIndex: 2,
            }}
        >
            {children}
        </div>
    );
}

function Axes({ max, height, labels, unit }: { max: number; height: number; labels: Array<[number, string]>; unit?: string }) {
    const t = useTheme();
    const plotH = height - PAD_T - PAD_B;
    return (
        <g fontFamily={t.fontFamily} fontSize={11} fill={t.contentColorMuted}>
            {[0, 0.5, 1].map((f) => {
                const y = PAD_T + plotH * (1 - f);
                return (
                    <g key={f}>
                        <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke={t.borderColorWeak || t.borderColor} strokeWidth={f === 0 ? 1 : 0.6} />
                        <text x={PAD_L - 6} y={y + 3} textAnchor="end">
                            {fmt(max * f, unit)}
                        </text>
                    </g>
                );
            })}
            {labels.map(([x, text]) => (
                <text key={`${x}-${text}`} x={x} y={height - 6} textAnchor="middle">
                    {text}
                </text>
            ))}
        </g>
    );
}

function xLabels(points: Point[], xOf: (i: number) => number, long: boolean): Array<[number, string]> {
    if (!points.length) {
        return [];
    }
    const n = Math.min(6, points.length);
    const out: Array<[number, string]> = [];
    for (let k = 0; k < n; k += 1) {
        const i = Math.round((k * (points.length - 1)) / Math.max(n - 1, 1));
        out.push([xOf(i), timeLabel(points[i].time, long)]);
    }
    return out;
}

/** Columns over time, each stacked from the series; click a column part to pick its series. */
export function StackedColumns({ points, series, height = 170, long = false, onPick, label }: { points: Point[]; series: Series[]; height?: number; long?: boolean; onPick?: (key: string) => void; label: string }) {
    const t = useTheme();
    const [hover, setHover] = useState<number | null>(null);
    const total = (p: Point) => series.reduce((s, x) => s + (Number(p[x.key]) || 0), 0);
    const max = niceMax(Math.max(0, ...points.map(total)));
    const plotW = W - PAD_L - PAD_R;
    const step = plotW / Math.max(points.length, 1);
    const barW = Math.max(Math.min(step - 2, 28), 1);
    const plotH = height - PAD_T - PAD_B;
    const xOf = (i: number) => PAD_L + step * i + step / 2;
    return (
        <div style={{ position: 'relative' }}>
            <Legend series={series} onPick={onPick} />
            <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }} onMouseLeave={() => setHover(null)}>
                <Axes max={max} height={height} labels={xLabels(points, xOf, long)} />
                {points.map((p, i) => (
                    <rect key={`hit-${p.time}`} x={PAD_L + step * i} y={PAD_T} width={step} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                ))}
                {points.map((p, i) => {
                    let y = PAD_T + plotH;
                    const x = xOf(i) - barW / 2;
                    return (
                        <g key={p.time} data-testid="chart-column" onMouseEnter={() => setHover(i)}>
                            {series.map((s) => {
                                const v = Number(p[s.key]) || 0;
                                if (!v) {
                                    return null;
                                }
                                const h = Math.max((v / max) * plotH, 1);
                                y -= h;
                                return (
                                    <rect
                                        key={s.key}
                                        data-series={s.key}
                                        x={x}
                                        y={y + 1}
                                        width={barW}
                                        height={Math.max(h - 1, 0.5)}
                                        rx={Math.min(2, barW / 2)}
                                        fill={s.color}
                                        opacity={hover === null || hover === i ? 1 : 0.55}
                                        style={{ cursor: onPick ? 'pointer' : 'default' }}
                                        onClick={onPick ? () => onPick(s.key) : undefined}
                                    />
                                );
                            })}
                        </g>
                    );
                })}
            </svg>
            {hover !== null && points[hover] && (
                <Tooltip x={xOf(hover)}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{timeLabel(points[hover].time, true)}</div>
                    {series.map((s) => (
                        <div key={s.key} style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                            <span>
                                <span style={{ display: 'inline-block', width: 8, height: 8, background: s.color, borderRadius: 2, marginRight: 6 }} />
                                {s.label}
                            </span>
                            <strong>{Number(points[hover][s.key]) || 0}</strong>
                        </div>
                    ))}
                </Tooltip>
            )}
        </div>
    );
}

/** Lines over time; a missing value breaks the line, so quiet periods show as gaps. */
export function LineChart({ points, series, height = 150, unit, long = false, label }: { points: Point[]; series: Series[]; height?: number; unit?: string; long?: boolean; label: string }) {
    const t = useTheme();
    const [hover, setHover] = useState<number | null>(null);
    const values = points.flatMap((p) => series.map((s) => p[s.key]).filter((v): v is number => typeof v === 'number'));
    const max = niceMax(Math.max(0, ...values));
    const plotW = W - PAD_L - PAD_R;
    const plotH = height - PAD_T - PAD_B;
    const step = plotW / Math.max(points.length - 1, 1);
    const xOf = (i: number) => PAD_L + (points.length === 1 ? plotW / 2 : step * i);
    const yOf = (v: number) => PAD_T + plotH * (1 - v / max);
    const paths = series.map((s) => {
        let d = '';
        let open = false;
        points.forEach((p, i) => {
            const v = p[s.key];
            if (typeof v === 'number') {
                d += `${open ? 'L' : 'M'}${xOf(i)},${yOf(v)} `;
                open = true;
            } else {
                open = false;
            }
        });
        return { s, d };
    });
    return (
        <div style={{ position: 'relative' }}>
            <Legend series={series} />
            <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }} onMouseLeave={() => setHover(null)}>
                <Axes max={max} height={height} labels={xLabels(points, xOf, long)} unit={unit} />
                {paths.map(({ s, d }) => (
                    <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />
                ))}
                {points.length === 1 &&
                    series.map((s) => (typeof points[0][s.key] === 'number' ? <circle key={s.key} cx={xOf(0)} cy={yOf(points[0][s.key] as number)} r={4} fill={s.color} /> : null))}
                {hover !== null && (
                    <g>
                        <line x1={xOf(hover)} x2={xOf(hover)} y1={PAD_T} y2={PAD_T + plotH} stroke={t.contentColorMuted} strokeWidth={1} />
                        {series.map((s) =>
                            typeof points[hover][s.key] === 'number' ? (
                                <circle key={s.key} cx={xOf(hover)} cy={yOf(points[hover][s.key] as number)} r={4} fill={s.color} stroke={t.backgroundColor} strokeWidth={2} />
                            ) : null
                        )}
                    </g>
                )}
                {points.map((p, i) => (
                    <rect key={p.time} x={xOf(i) - step / 2} y={PAD_T} width={Math.max(step, 4)} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                ))}
            </svg>
            {hover !== null && points[hover] && (
                <Tooltip x={xOf(hover)}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{timeLabel(points[hover].time, true)}</div>
                    {series.map((s) => (
                        <div key={s.key} style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                            <span>{s.label}</span>
                            <strong>{typeof points[hover][s.key] === 'number' ? fmt(points[hover][s.key] as number, unit) : 'none'}</strong>
                        </div>
                    ))}
                </Tooltip>
            )}
        </div>
    );
}

export interface BarRow {
    key: string;
    label: string;
    value: number;
    /** Shown after the value, such as "12 calls · 1 failed". */
    note?: string;
    color?: string;
}

/** Ranked horizontal bars with the value at the end; rows can be clicked. */
export function BarList({ rows, unit, onPick, empty }: { rows: BarRow[]; unit?: string; onPick?: (key: string) => void; empty: string }) {
    const t = useTheme();
    if (!rows.length) {
        return <p style={{ color: t.contentColorMuted, margin: '8px 0' }}>{empty}</p>;
    }
    const max = Math.max(...rows.map((r) => r.value), 1);
    return (
        <div role="list" style={{ display: 'grid', gap: '6px' }}>
            {rows.map((r) => (
                <button
                    key={r.key}
                    type="button"
                    role="listitem"
                    data-testid="bar-row"
                    onClick={onPick ? () => onPick(r.key) : undefined}
                    disabled={!onPick}
                    title={onPick ? 'Show these lines' : undefined}
                    style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 34%) 1fr', gap: '10px', alignItems: 'center', background: 'none', border: 0, padding: '2px 0', font: 'inherit', color: t.contentColorDefault, textAlign: 'left', cursor: onPick ? 'pointer' : 'default' }}
                >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px' }} title={r.label}>
                        {r.label}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <span style={{ height: 10, width: `${Math.max((r.value / max) * 70, 1)}%`, background: r.color || t.contentColorMuted, borderRadius: '0 2px 2px 0', flex: 'none' }} />
                        <span style={{ fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <strong>{fmt(r.value, unit)}</strong>
                            {r.note && <span style={{ color: t.contentColorMuted }}>{` · ${r.note}`}</span>}
                        </span>
                    </span>
                </button>
            ))}
        </div>
    );
}
