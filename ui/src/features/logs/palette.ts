/* One palette for the whole Troubleshooting page: the charts, the single values and the Level
 * column use the same colour for the same level, and the page sits on the charts' own surface
 * (Splunk's visualizations draw on black in dark mode and white in light mode).
 *
 * Each scheme has its own steps, checked against its surface: error and warning stay apart for
 * colour-blind readers (deutan ΔE ≥ 12), and every colour has at least 3:1 contrast. Colour is
 * never alone: each level also has an icon and a word. */
import type { Tone } from './catalog';

export type Scheme = 'dark' | 'light';

export interface Palette {
    surface: string;
    error: string;
    warning: string;
    info: string;
    ok: string;
    /** Routine detail and debug lines. */
    muted: string;
}

export const PALETTES: Record<Scheme, Palette> = {
    dark: { surface: '#000000', error: '#E8473C', warning: '#F2A33A', info: '#4A9FE0', ok: '#5DB35A', muted: '#9A9EA4' },
    light: { surface: '#FFFFFF', error: '#B3263E', warning: '#C46A00', info: '#0B6FA4', ok: '#2E7D32', muted: '#6B7078' },
};

export function schemeOf(theme: Record<string, unknown>): Scheme {
    return theme.colorScheme === 'dark' ? 'dark' : 'light';
}

export function paletteOf(theme: Record<string, unknown>): Palette {
    return PALETTES[schemeOf(theme)];
}

export function toneHex(p: Palette, tone: Tone): string {
    return p[tone] || p.muted;
}
