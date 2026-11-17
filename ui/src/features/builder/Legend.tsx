/* The node-types legend: one row per family with its shape, colour and example kinds, then the
 * When outcomes with their glyphs, an example + and tab, and a note on line labels. Colours come
 * from theme tokens only. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import { Theme } from './GraphView';
import { CATALOG } from './nodeCatalog';
import { FAMILY_OF, FAMILY_STYLE, Family, HANDLE_R, PORT_STYLE, shapePath } from './nodeStyle';
import { OUTCOME_LABEL, Outcome } from './outcomes';

const FAMILIES = Object.keys(FAMILY_STYLE) as Family[];
const OUTCOMES = Object.keys(OUTCOME_LABEL) as Outcome[];

/** Example kinds of a family, from the catalog; the whole job has no catalog entry. */
function examples(family: Family): string {
    if (family === 'job') {
        return 'Whole job';
    }
    return CATALOG.filter((e) => FAMILY_OF[e.kind] === family)
        .map((e) => e.label)
        .join(', ');
}

export default function Legend() {
    const theme = useSplunkTheme() as unknown as Theme;
    const text = { fontFamily: theme.fontFamily, fontSize: 12, color: theme.contentColorDefault };
    return (
        <div
            data-testid="legend"
            style={{
                ...text,
                background: theme.backgroundColorSection,
                border: `1px solid ${theme.borderColor}`,
                borderRadius: '4px',
                padding: '8px 12px',
                maxHeight: 440,
                overflowY: 'auto',
                width: 300,
            }}
        >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Node types</div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {FAMILIES.map((family) => {
                    const s = FAMILY_STYLE[family];
                    return (
                        <li key={family} data-family={family} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                            <svg width={32} height={20} viewBox="0 0 32 20" aria-hidden focusable="false" style={{ flex: 'none' }}>
                                <path d={shapePath(s.shape, 30, 18)} transform="translate(1,1)" fill="none" stroke={theme[s.colorToken]} strokeWidth={2} />
                            </svg>
                            <div>
                                <div style={{ fontWeight: 600 }}>{s.label}</div>
                                <span style={{ color: theme.contentColorMuted }}>{examples(family)}</span>
                            </div>
                        </li>
                    );
                })}
            </ul>
            <div aria-hidden style={{ fontWeight: 600, margin: '8px 0 4px' }}>
                When a node…
            </div>
            <ul aria-label="When" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {OUTCOMES.map((o) => (
                    <li key={o} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                        <span aria-hidden style={{ width: 32, textAlign: 'center', color: theme[PORT_STYLE[o].colorToken], flex: 'none' }}>
                            {PORT_STYLE[o].glyph}
                        </span>
                        <span>{OUTCOME_LABEL[o]}</span>
                        {(o === 'start' || o === 'delayed') && <span style={{ color: theme.contentColorMuted }}>actions only</span>}
                    </li>
                ))}
            </ul>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0 2px' }}>
                <svg data-testid="legend-plus" width={32} height={28} viewBox="0 0 32 28" aria-hidden focusable="false" style={{ flex: 'none' }}>
                    <circle cx={16} cy={14} r={HANDLE_R} fill={theme.backgroundColorSection} stroke={theme.borderColorStrong} strokeWidth={1.5} />
                    <path d="M10,14 H22 M16,8 V20" stroke={theme.contentColorDefault} strokeWidth={2} strokeLinecap="round" />
                </svg>
                <span>Click + to choose what happens next, or drag it onto another node.</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                <svg width={22} height={22} aria-hidden style={{ flex: 'none' }} data-testid="legend-tab">
                    <circle cx={11} cy={11} r={9} fill={theme.backgroundColorSection} stroke={theme[PORT_STYLE.success.colorToken]} strokeWidth={1.5} />
                    <text x={11} y={15} textAnchor="middle" fontSize={11} fill={theme.contentColorDefault} fontFamily={theme.fontFamily}>
                        {PORT_STYLE.success.glyph}
                    </text>
                </svg>
                <span>A small tab for each outcome in use, a glyph in a ring in the outcome's colour; point at it to see its name, and drag it to add another line with that outcome.</span>
            </div>
            <div style={{ padding: '4px 0 0', color: theme.contentColorMuted }}>
                Lines are coloured by outcome. A line's label shows on the selected line; turn on Show line labels in the toolbar to see them all. Click a line to change it, insert a node or remove it.
            </div>
        </div>
    );
}
