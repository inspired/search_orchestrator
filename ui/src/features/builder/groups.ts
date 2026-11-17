/* Groups (backdrops) in the node editor: titled, tinted frames behind nodes, stored in
 * job.layout.groups, so they never change how a job runs. Membership is spatial and never stored:
 * a node belongs to a group while its box is fully inside the frame (`membersOf`). A collapsed
 * group is drawn as a 200 × 56 block at the frame's top-left and hides its members; lines to and
 * from them attach to the block. Groups read from a job are checked first (`readGroups`), so a
 * hand-edited layout with bad data never breaks the canvas. Pure helpers and the job edits. */
import type { JobDefinition, LayoutGroup } from '../../api/types';
import { layoutFlow } from './flowLayout';
import type { Pos, Positions } from './graphLogic';
import { buildGraph } from './nodeModel';
import type { FlowGraph } from './nodeModel';
import { nodeSize } from './nodeStyle';

export type Group = LayoutGroup;
export type GroupColor = Group['color'];

export const GROUP_COLORS: { token: GroupColor; label: string }[] = [
    { token: 'categoricalA1', label: 'Purple' },
    { token: 'categoricalA2', label: 'Blue' },
    { token: 'categoricalA3', label: 'Teal' },
    { token: 'categoricalA4', label: 'Amber' },
    { token: 'categoricalA5', label: 'Pink' },
    { token: 'categoricalA6', label: 'Slate' },
    { token: 'categoricalA7', label: 'Orange' },
];
export const DEFAULT_GROUP_COLOR: GroupColor = 'categoricalA2';
export const DEFAULT_GROUP_TITLE = 'Group';
/** Space around the members when a group is made from a selection. */
export const GROUP_PAD = 24;
export const GROUP_TITLE_H = 28;
/** A collapsed group's block. */
export const BLOCK = { w: 200, h: 56 };
/** The smallest frame a resize leaves. */
export const MIN_GROUP = { w: 120, h: 60 };
export const MAX_GROUPS = 200;
const MAX_ID = 40;
const MAX_TITLE = 80;
const LIMIT = 1_000_000;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMIT;

/** Whether `v` is a group the server accepts (spec §6). */
export function isGroup(v: unknown): v is Group {
    if (typeof v !== 'object' || v === null) {
        return false;
    }
    const g = v as Record<string, unknown>;
    return (
        typeof g.id === 'string' &&
        g.id.length <= MAX_ID &&
        typeof g.title === 'string' &&
        g.title.length <= MAX_TITLE &&
        GROUP_COLORS.some((c) => c.token === g.color) &&
        [g.x, g.y, g.w, g.h].every(finite) &&
        (g.w as number) > 0 &&
        (g.h as number) > 0 &&
        (g.collapsed === undefined || typeof g.collapsed === 'boolean')
    );
}

/** The well-formed groups in `list` (anything else is skipped). */
export const validGroups = (list: unknown): Group[] => (Array.isArray(list) ? list.filter(isGroup) : []);

/** The job's groups, skipping any that are broken. */
export function readGroups(job: JobDefinition): Group[] {
    const layout = job.layout as unknown;
    return typeof layout === 'object' && layout !== null ? validGroups((layout as { groups?: unknown }).groups) : [];
}

export function nextGroupId(groups: Group[]): string {
    const used = new Set(groups.map((g) => g.id));
    let i = 1;
    while (used.has(`g${i}`)) {
        i += 1;
    }
    return `g${i}`;
}

const nodeBox = (graph: FlowGraph, pos: Positions, key: string, compact: boolean) => {
    const n = graph.nodes.find((x) => x.key === key);
    const p = pos[key];
    return n && p ? { x: p.x, y: p.y, ...nodeSize(n.kind, compact) } : null;
};

/** The nodes whose boxes are fully inside the frame of `group`, in graph order. */
export function membersOf(group: Group, graph: FlowGraph, pos: Positions, compact = false): string[] {
    return graph.nodes
        .filter((n) => {
            const b = nodeBox(graph, pos, n.key, compact);
            return b !== null && b.x >= group.x && b.y >= group.y && b.x + b.w <= group.x + group.w && b.y + b.h <= group.y + group.h;
        })
        .map((n) => n.key);
}

/** A frame around the nodes `keys`: `pad` on every side and the title bar above. */
export function groupAround(keys: string[], pos: Positions, graph: FlowGraph, pad = GROUP_PAD, compact = false): Pick<Group, 'x' | 'y' | 'w' | 'h'> {
    const boxes = keys.map((k) => nodeBox(graph, pos, k, compact)).filter((b): b is NonNullable<typeof b> => b !== null);
    if (!boxes.length) {
        return { x: 0, y: 0, w: MIN_GROUP.w, h: MIN_GROUP.h };
    }
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    return { x: x0 - pad, y: y0 - pad - GROUP_TITLE_H, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad + GROUP_TITLE_H };
}

/** Node key → id of the collapsed group hiding it. With `expandAll` (the run page), none. */
export function hiddenMembers(groups: Group[], graph: FlowGraph, pos: Positions, compact = false, expandAll = false): Record<string, string> {
    const out: Record<string, string> = {};
    if (expandAll) {
        return out;
    }
    groups.forEach((g) => {
        if (g.collapsed) {
            membersOf(g, graph, pos, compact).forEach((k) => {
                out[k] = out[k] || g.id;
            });
        }
    });
    return out;
}

/** Where a line leaves (`from`, the right edge) or enters (`to`, the left edge) a collapsed block. */
export function collapsedEnd(g: Group, end: 'from' | 'to'): Pos {
    return { x: end === 'from' ? g.x + BLOCK.w : g.x, y: g.y + BLOCK.h / 2 };
}

/** The job with `groups` in its layout; none removes `groups`, and then a layout with no nodes. */
export function withGroups(job: JobDefinition, groups: Group[]): JobDefinition {
    const out = { ...job };
    const layout = { ...job.layout };
    if (groups.length) {
        layout.groups = groups;
    } else {
        delete layout.groups;
    }
    if (Object.keys(layout).length === 0) {
        delete out.layout;
    } else {
        out.layout = layout;
    }
    return out;
}

/** `changes` that a group may take: a title of at most 80 characters, a known colour, a size no
 * smaller than the minimum, finite coordinates and a collapse flag (false is not stored). */
function applyChanges(g: Group, changes: Partial<Group>): Group {
    const next: Group = { ...g };
    if (typeof changes.title === 'string') {
        next.title = changes.title.slice(0, MAX_TITLE);
    }
    if (changes.color && GROUP_COLORS.some((c) => c.token === changes.color)) {
        next.color = changes.color;
    }
    (['x', 'y'] as const).forEach((k) => {
        if (finite(changes[k])) {
            next[k] = Math.round(changes[k] as number);
        }
    });
    if (finite(changes.w) && changes.w > 0) {
        next.w = Math.max(MIN_GROUP.w, Math.round(changes.w));
    }
    if (finite(changes.h) && changes.h > 0) {
        next.h = Math.max(MIN_GROUP.h, Math.round(changes.h));
    }
    if (changes.collapsed === true) {
        next.collapsed = true;
    } else if (changes.collapsed === false) {
        delete next.collapsed;
    }
    return next;
}

export type GroupAction =
    | { type: 'addGroup'; group: Group }
    | { type: 'updateGroup'; id: string; changes: Partial<Group> }
    /** Moves the frame and the nodes `members` (worked out when the drag started) by dx, dy as
     * one undo step. `shown` (the positions on screen) is saved too, so other nodes stay put. */
    | { type: 'moveGroup'; id: string; dx: number; dy: number; members: string[]; shown?: Positions; compact?: boolean }
    | { type: 'removeGroup'; id: string };

/** The job after a group edit; null when nothing changes. */
export function groupEdit(job: JobDefinition, action: GroupAction): JobDefinition | null {
    const groups = readGroups(job);
    if (action.type === 'addGroup') {
        if (!isGroup(action.group) || groups.length >= MAX_GROUPS || groups.some((g) => g.id === action.group.id)) {
            return null;
        }
        return withGroups(job, [...groups, action.group]);
    }
    const current = groups.find((g) => g.id === action.id);
    if (!current) {
        return null;
    }
    if (action.type === 'removeGroup') {
        return withGroups(job, groups.filter((g) => g !== current));
    }
    if (action.type === 'updateGroup') {
        const next = applyChanges(current, action.changes);
        return JSON.stringify(next) === JSON.stringify(current) ? null : withGroups(job, groups.map((g) => (g === current ? next : g)));
    }
    const { dx, dy } = action;
    // A frame that cannot move (past ±1 000 000) leaves its members where they are too.
    if (!finite(dx) || !finite(dy) || (dx === 0 && dy === 0) || !finite(current.x + dx) || !finite(current.y + dy)) {
        return null;
    }
    const moved = applyChanges(current, { x: current.x + dx, y: current.y + dy });
    const shown = action.shown || layoutFlow(buildGraph(job), job.layout?.nodes, action.compact);
    const nodes: Record<string, Pos> = { ...shown };
    action.members.forEach((k) => {
        if (shown[k]) {
            nodes[k] = { x: shown[k].x + dx, y: shown[k].y + dy };
        }
    });
    const next = withGroups(job, groups.map((g) => (g === current ? moved : g)));
    return { ...next, layout: { ...next.layout, nodes } };
}

/** The group to expand so node `key` shows, if a collapsed group hides it. */
export function groupHiding(job: JobDefinition, graph: FlowGraph, pos: Positions, key: string, compact = false): Group | undefined {
    const id = hiddenMembers(readGroups(job), graph, pos, compact)[key];
    return id ? readGroups(job).find((g) => g.id === id) : undefined;
}
