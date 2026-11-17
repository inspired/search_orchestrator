/* Visual identity of each node family: shape, colour token, outcome glyphs and geometry.
 * Colours are theme token names, resolved by the caller from useSplunkTheme(). */
import type { NodeKind, PortId } from './nodeModel';
import { outputPorts } from './nodeModel';

export type Family = 'trigger' | 'search' | 'transform' | 'condition' | 'notify' | 'write' | 'chain' | 'job';
export type Shape = 'stadium' | 'rounded' | 'cut' | 'diamond' | 'flag' | 'cylinder' | 'parallelogram' | 'double';

export const FAMILY_OF: Record<NodeKind, Family> = {
    trigger_cron: 'trigger',
    trigger_completion: 'trigger',
    search: 'search',
    saved_search: 'search',
    previous: 'transform',
    summary_index: 'write',
    lookup: 'write',
    event: 'write',
    condition: 'condition',
    email: 'notify',
    webhook: 'notify',
    slack: 'notify',
    teams: 'notify',
    pagerduty: 'notify',
    servicenow: 'notify',
    alert_action: 'notify',
    start_job: 'chain',
    job: 'job',
};

export const FAMILY_STYLE: Record<Family, { shape: Shape; colorToken: string; label: string }> = {
    trigger: { shape: 'stadium', colorToken: 'categoricalA1Strong', label: 'Trigger' },
    search: { shape: 'rounded', colorToken: 'categoricalA2Strong', label: 'Search' },
    transform: { shape: 'cut', colorToken: 'categoricalA3Strong', label: 'Transform' },
    condition: { shape: 'diamond', colorToken: 'categoricalA4Strong', label: 'Condition' },
    notify: { shape: 'flag', colorToken: 'categoricalA5Strong', label: 'Notify' },
    write: { shape: 'cylinder', colorToken: 'categoricalA7Strong', label: 'Write' },
    chain: { shape: 'parallelogram', colorToken: 'categoricalA6Strong', label: 'Start another job' },
    job: { shape: 'double', colorToken: 'borderColorStrong', label: 'Whole job' },
};

export const PORT_STYLE: Record<PortId, { glyph: string; label: string; colorToken: string }> = {
    success: { glyph: '✓', label: 'Succeeded', colorToken: 'statusColorNormal' },
    failure: { glyph: '✗', label: 'Failed', colorToken: 'statusColorHigh' },
    always: { glyph: '∞', label: 'Finished either way', colorToken: 'contentColorMuted' },
    start: { glyph: '▶', label: 'Started', colorToken: 'contentColorMuted' },
    delayed: { glyph: '⏱', label: 'Delayed', colorToken: 'statusColorMedium' },
    late: { glyph: '⌛', label: 'Late', colorToken: 'statusColorMedium' },
    if: { glyph: '◇', label: 'If…', colorToken: 'contentColorMuted' },
    then: { glyph: '→', label: 'Then', colorToken: 'contentColorMuted' },
};

const STEP_SIZE = { w: 200, h: 76 };

/** Compact nodes: icon and name only. The diamond keeps its size; the whole job is a little wider. */
export function nodeSize(kind: NodeKind, compact = false): { w: number; h: number } {
    if (compact && FAMILY_OF[kind] !== 'condition') {
        return { w: kind === 'job' ? 160 : 140, h: 32 };
    }
    switch (FAMILY_OF[kind]) {
        case 'trigger':
            return { w: 180, h: 44 };
        case 'condition':
            return { w: 64, h: 64 };
        case 'job':
            return { w: 220, h: 68 };
        case 'search':
        case 'transform':
        case 'write':
            return STEP_SIZE;
        default:
            return { w: 200, h: 56 };
    }
}

const CUT = 10;
const SKEW = 12;
const ROUND = 8;
const CAP = 6;

/** A closed SVG path for the shape, origin top-left. */
export function shapePath(shape: Shape, w: number, h: number): string {
    switch (shape) {
        case 'stadium': {
            const r = h / 2;
            return `M${r},0 L${w - r},0 A${r},${r} 0 0 1 ${w - r},${h} L${r},${h} A${r},${r} 0 0 1 ${r},0 Z`;
        }
        case 'cut':
            return `M${CUT},0 L${w - CUT},0 L${w},${CUT} L${w},${h - CUT} L${w - CUT},${h} L${CUT},${h} L0,${h - CUT} L0,${CUT} Z`;
        case 'diamond':
            return `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`;
        case 'flag':
            return `M0,0 L${w},0 L${w - 12},${h / 2} L${w},${h} L0,${h} Z`;
        case 'cylinder':
            return `M0,${CAP} A${w / 2},${CAP} 0 0 1 ${w},${CAP} L${w},${h - CAP} A${w / 2},${CAP} 0 0 1 0,${h - CAP} Z`;
        case 'parallelogram':
            return `M${SKEW},0 L${w},0 L${w - SKEW},${h} L0,${h} Z`;
        default:
            return `M${ROUND},0 L${w - ROUND},0 A${ROUND},${ROUND} 0 0 1 ${w},${ROUND} L${w},${h - ROUND} A${ROUND},${ROUND} 0 0 1 ${w - ROUND},${h} L${ROUND},${h} A${ROUND},${ROUND} 0 0 1 0,${h - ROUND} L0,${ROUND} A${ROUND},${ROUND} 0 0 1 ${ROUND},0 Z`;
    }
}

/** Nodes with outcomes get the + handle: steps, the whole job and conditions. */
export function hasHandle(kind: NodeKind): boolean {
    return outputPorts(kind).length > 0;
}

export const HANDLE_R = 13;
export const TAB_GAP = 22;
/** Outcome tabs are 18 px circles, 2 px outside the node's right edge. */
export const TAB_D = 18;

/** Centre of the + handle: right edge at mid height, or just right of the tab column when `tabCount` tabs exist. */
export function handleOffset(kind: NodeKind, compact = false, tabCount = 0): { x: number; y: number } {
    const { w, h } = nodeSize(kind, compact);
    return { x: tabCount > 0 ? w + TAB_GAP + HANDLE_R : w, y: h / 2 };
}

/** Anchor of the `index`th outcome tab (0 topmost): the column is centred on the node's vertical
 * middle, 22 px apart, tab centres on x = w + 11. */
export function tabOffset(kind: NodeKind, index: number, count: number, compact = false): { x: number; y: number } {
    const { w, h } = nodeSize(kind, compact);
    return { x: w, y: h / 2 + (index - (count - 1) / 2) * TAB_GAP };
}

/** Where a line leaves a tab: the right edge of its circle. */
export function tabExit(kind: NodeKind, index: number, count: number, compact = false): { x: number; y: number } {
    const o = tabOffset(kind, index, count, compact);
    return { x: o.x + 2 + TAB_D, y: o.y };
}

/** Input handle: left centre; null for kinds that cannot be wired into. */
export function inputOffset(kind: NodeKind, compact = false): { x: number; y: number } | null {
    if (FAMILY_OF[kind] === 'trigger' || kind === 'job') {
        return null;
    }
    return { x: 0, y: nodeSize(kind, compact).h / 2 };
}
