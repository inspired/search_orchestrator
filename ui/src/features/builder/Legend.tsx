/* The node-types legend: one row per family with its shape, colour and example kinds, and the
 * port glyphs. Colours come from theme tokens only. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import { Theme } from './GraphView';
import { CATALOG } from './nodeCatalog';
import { FAMILY_OF, FAMILY_STYLE, Family, PORT_STYLE, shapePath } from './nodeStyle';

const FAMILIES = Object.keys(FAMILY_STYLE) as Family[];

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
            <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>Exits</div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {Object.values(PORT_STYLE).map((p) => (
                    <li key={p.label} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                        <span aria-hidden style={{ width: 32, textAlign: 'center', color: theme[p.colorToken], flex: 'none' }}>{p.glyph}</span>
                        <span>{p.label}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
