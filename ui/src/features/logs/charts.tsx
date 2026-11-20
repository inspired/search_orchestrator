/* Charts for the Troubleshooting page. Over time they are Splunk's own Column and Line
 * visualizations (@splunk/visualizations, as Dashboard Studio draws them), fed the points as a
 * search result; the ranked lists are rows that can be clicked to filter. One measure per
 * chart (no second axis). */
import React, { useState } from 'react';
import Column from '@splunk/visualizations/Column';
import Line from '@splunk/visualizations/Line';
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

/** The points as a Splunk search result: `_time`, one column per series (named by its label,
 * which is what Splunk's legend and tooltip show) and `_span` (seconds per bucket). A missing
 * value is empty, so a line breaks there. */
export function toDataSource(points: Point[], series: Series[]) {
    const times = points.map((p) => p.time);
    const ms = times.map((t) => new Date(t).getTime());
    const span = ms.length > 1 && !Number.isNaN(ms[1] - ms[0]) ? Math.max(1, Math.round((ms[1] - ms[0]) / 1000)) : 60;
    const cell = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : String(v));
    return {
        primary: {
            requestParams: { offset: 0, count: points.length },
            data: {
                fields: [{ name: '_time' }, ...series.map((x) => ({ name: x.label })), { name: '_span' }],
                columns: [times, ...series.map((x) => points.map((p) => cell(p[x.key]))), times.map(() => String(span))],
            },
            meta: { totalCount: points.length },
        },
    };
}

function colorsByField(series: Series[]): Record<string, string> {
    const out: Record<string, string> = {};
    series.forEach((x) => {
        out[x.label] = x.color;
    });
    return out;
}

/** Columns over time, stacked by series: Splunk's own Column chart (as in Dashboard Studio),
 * with its axes, legend and tooltips. */
export function StackedColumns({ points, series, height = 170, label }: { points: Point[]; series: Series[]; height?: number; long?: boolean; label: string }) {
    return (
        <div role="img" aria-label={label} data-testid="splunk-chart" data-kind="column" style={{ width: '100%' }}>
            <Column
                width="100%"
                height={height + 40}
                options={{
                    stackMode: 'stacked',
                    legendDisplay: series.length > 1 ? 'top' : 'off',
                    seriesColorsByField: colorsByField(series),
                    xAxisTitleVisibility: 'hide',
                    yAxisTitleVisibility: 'hide',
                }}
                dataSources={toDataSource(points, series)}
            />
        </div>
    );
}

/** Lines over time: Splunk's own Line chart; a missing value breaks the line, so quiet
 * periods show as gaps. */
export function LineChart({ points, series, height = 150, unit, label }: { points: Point[]; series: Series[]; height?: number; unit?: string; long?: boolean; label: string }) {
    const dashes: Record<string, string> = {};
    series.forEach((x) => {
        if (x.dashed) {
            dashes[x.label] = 'dash';
        }
    });
    return (
        <div role="img" aria-label={label} data-testid="splunk-chart" data-kind="line" style={{ width: '100%' }}>
            <Line
                width="100%"
                height={height + 40}
                options={{
                    legendDisplay: series.length > 1 ? 'top' : 'off',
                    seriesColorsByField: colorsByField(series),
                    lineDashStylesByField: dashes,
                    nullValueDisplay: 'gaps',
                    xAxisTitleVisibility: 'hide',
                    yAxisTitleVisibility: unit ? 'show' : 'hide',
                    yAxisTitleText: unit === 'ms' ? 'Milliseconds' : '',
                }}
                dataSources={toDataSource(points, series)}
            />
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
