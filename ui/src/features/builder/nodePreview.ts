/* What a node shows of its step's preview: "1 204 rows · 3.2 s", "Previewing…",
 * "Preview failed: <first line>" or a muted "Out of date" (no numbers, no bar), and the length of its bar relative to the largest previewed
 * row count on the canvas. Pure text and numbers; NodeShape draws them. */

export interface PreviewSummary {
    rows?: number;
    seconds?: number;
    error?: string;
    running?: boolean;
    /** The step or what it reads changed since: the numbers no longer apply. */
    stale?: boolean;
}

const MAX_ERROR = 60;

/** The first line of `error`, cut to 60 characters (the last one an ellipsis when cut). */
export function firstLine(error: string): string {
    const line = (error.split(/\r?\n/).find((l) => l.trim()) || '').trim();
    return line.length > MAX_ERROR ? `${line.slice(0, MAX_ERROR - 1)}…` : line;
}

/** The text under a node's name; null when there is no preview to show. */
export function previewLine(p: PreviewSummary | undefined): { text: string; failed: boolean; muted?: boolean } | null {
    if (!p) {
        return null;
    }
    if (p.running) {
        return { text: 'Previewing…', failed: false };
    }
    if (p.stale) {
        return { text: 'Out of date', failed: false, muted: true };
    }
    if (p.error !== undefined) {
        const line = firstLine(p.error);
        return { text: line ? `Preview failed: ${line}` : 'Preview failed', failed: true };
    }
    if (typeof p.rows !== 'number') {
        return null;
    }
    const count = `${new Intl.NumberFormat().format(p.rows)} row${p.rows === 1 ? '' : 's'}`;
    return { text: typeof p.seconds === 'number' ? `${count} · ${p.seconds.toFixed(1)} s` : count, failed: false };
}

/** The largest row count among the previews of `ids`. */
export function maxRows(previews: Record<string, PreviewSummary | undefined>, ids: string[]): number {
    return ids.reduce((m, id) => {
        const p = previews[id];
        return p && !p.running && !p.stale && p.error === undefined && typeof p.rows === 'number' ? Math.max(m, p.rows) : m;
    }, 0);
}

/** 0 to 1: this preview's rows over the largest; 0 (no bar) for no rows or no preview. */
export function barFraction(p: PreviewSummary | undefined, max: number): number {
    if (!p || p.running || p.stale || p.error !== undefined || !p.rows || p.rows <= 0 || max <= 0) {
        return 0;
    }
    return Math.min(1, p.rows / max);
}
