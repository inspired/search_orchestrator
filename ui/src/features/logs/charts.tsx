/* Shared bits for the Troubleshooting page: the theme hook, a graph series, and the ranked
 * lists (rows that can be clicked to filter). The graphs over time are a small Dashboard
 * Studio dashboard (GraphDashboard.tsx). */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';

export type Theme = Record<string, string>;
export const useTheme = () => useSplunkTheme() as unknown as Theme;

export interface Series {
    key: string;
    label: string;
    color: string;
    dashed?: boolean;
}

function fmt(v: number, unit?: string): string {
    if (unit === 'ms') {
        return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
    }
    return v >= 10000 ? `${Math.round(v / 1000)}k` : String(Math.round(v * 10) / 10);
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
