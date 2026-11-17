/* Drawing a group on the flow canvas: the frame (its colour token at low opacity with a 1 px
 * border in the same token), a title bar to drag it by (double-click asks to edit the title), a
 * corner handle to resize it, a focus-colour outline when selected, and, collapsed, a 200 × 56
 * block with the title and how many nodes it holds. `GroupFocus` is the keyboard stop for a
 * group, drawn after the nodes so Tab reaches every node first. Frames are drawn behind lines
 * and nodes. */
import React from 'react';
import type { Theme } from './GraphView';
import { NodeGroup } from './GraphView';
import { BLOCK, GROUP_TITLE_H, Group } from './groups';

const FILL_OPACITY = 0.12;
const TITLE_OPACITY = 0.2;
const HANDLE = 12;

export const countText = (n: number) => `${n} node${n === 1 ? '' : 's'}`;

/** "Group Daily, 2 nodes", or "Group Daily, collapsed, 2 nodes". */
export const groupLabel = (g: Group, collapsed: boolean, members: number) =>
    [`Group ${g.title || 'without a title'}`, collapsed ? 'collapsed' : '', countText(members)].filter(Boolean).join(', ');

/** The box drawn for `g`: the frame, or the block when collapsed. */
export const drawnBox = (g: Group, collapsed: boolean) => (collapsed ? { x: g.x, y: g.y, w: BLOCK.w, h: BLOCK.h } : { x: g.x, y: g.y, w: g.w, h: g.h });

const clip = (s: string, width: number) => {
    const max = Math.max(1, Math.floor((width - 20) / 7));
    return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
};

export interface GroupFrameProps {
    group: Group;
    collapsed: boolean;
    members: number;
    selected: boolean;
    theme: Theme;
    /** Without these the frame is only drawn (the run page). */
    onTitleDown?: (ev: React.PointerEvent) => void;
    onResizeDown?: (ev: React.PointerEvent) => void;
    onTitleDouble?: () => void;
}

export function GroupFrame({ group: g, collapsed, members, selected, theme, onTitleDown, onResizeDown, onTitleDouble }: GroupFrameProps) {
    const color = theme[g.color];
    const b = drawnBox(g, collapsed);
    const editable = Boolean(onTitleDown);
    const title = (
        <text x={b.x + 10} y={b.y + 18} fill={theme.contentColorDefault} fontSize={13} fontWeight={600} pointerEvents="none">
            {clip(g.title, b.w)}
        </text>
    );
    return (
        <g data-testid={`group-${g.id}`} aria-hidden>
            <rect data-testid={`group-body-${g.id}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={6} fill={color} fillOpacity={FILL_OPACITY} stroke={color} strokeWidth={1} pointerEvents="none" />
            {selected && (
                <rect data-testid={`group-outline-${g.id}`} x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6} rx={8} fill="none" stroke={theme.focusColor} strokeWidth={2} pointerEvents="none" />
            )}
            <rect
                data-testid={`group-title-${g.id}`}
                x={b.x}
                y={b.y}
                width={b.w}
                height={collapsed ? b.h : GROUP_TITLE_H}
                rx={6}
                fill={color}
                fillOpacity={collapsed ? 0 : TITLE_OPACITY}
                pointerEvents={editable ? 'all' : 'none'}
                style={{ cursor: editable ? 'move' : undefined }}
                onPointerDown={
                    onTitleDown
                        ? (ev) => {
                              ev.stopPropagation();
                              onTitleDown(ev);
                          }
                        : undefined
                }
                onDoubleClick={onTitleDouble}
            />
            {collapsed ? (
                <g data-testid={`group-block-${g.id}`}>
                    {title}
                    <text x={b.x + 10} y={b.y + 40} fill={theme.contentColorMuted} fontSize={12} pointerEvents="none">
                        {countText(members)}
                    </text>
                </g>
            ) : (
                title
            )}
            {!collapsed && onResizeDown && (
                <rect
                    data-testid={`group-resize-${g.id}`}
                    x={b.x + b.w - HANDLE}
                    y={b.y + b.h - HANDLE}
                    width={HANDLE}
                    height={HANDLE}
                    fill={color}
                    fillOpacity={0.5}
                    style={{ cursor: 'nwse-resize' }}
                    onPointerDown={(ev) => {
                        ev.stopPropagation();
                        onResizeDown(ev);
                    }}
                />
            )}
        </g>
    );
}

export interface GroupFocusProps {
    group: Group;
    collapsed: boolean;
    members: number;
    selected: boolean;
}

/** The keyboard stop for a group: Enter selects, Delete asks to remove, arrows move it. */
export function GroupFocus({ group, collapsed, members, selected }: GroupFocusProps) {
    const b = drawnBox(group, collapsed);
    return (
        <NodeGroup data-group-id={group.id} role="button" tabIndex={0} aria-label={groupLabel(group, collapsed, members)} aria-pressed={selected} pointerEvents="none">
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} fill="none" stroke="none" />
        </NodeGroup>
    );
}
