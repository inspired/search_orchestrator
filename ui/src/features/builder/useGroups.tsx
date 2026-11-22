/* The Flow tab's groups: the props FlowCanvas needs to draw and edit them, making a group from
 * the selected nodes (Ctrl/Cmd+G, the toolbar or the right-click menu), the group panel and the
 * confirm before removing one. `reveal` expands a collapsed group before one of its hidden nodes
 * is selected (from the issue list), so the selection can be seen. */
import React, { useEffect, useMemo, useState } from 'react';
import type { JobDefinition } from '../../api/types';
import type { FlowSelection } from './FlowCanvas';
import type { Positions } from './graphLogic';
import GroupPanel, { RemoveGroupModal, groupTitleId } from './GroupPanel';
import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE, Group, groupAround, groupHiding, membersOf, nextGroupId, readGroups } from './groups';
import type { FlowGraph } from './nodeModel';
import type { BuilderAction } from './reducer';

export interface GroupsOptions {
    job: JobDefinition;
    graph: FlowGraph;
    positions: Positions;
    dispatch: React.Dispatch<BuilderAction>;
    selection: FlowSelection;
    /** Sets the selection (without revealing). */
    select: (sel: FlowSelection) => void;
    rememberFocus: () => void;
    returnFocus: React.MutableRefObject<HTMLElement | null>;
}

export default function useGroups({ job, graph, positions, dispatch, selection, select, rememberFocus, returnFocus }: GroupsOptions) {
    const groups = useMemo(() => readGroups(job), [job]);
    const [removing, setRemoving] = useState<string | null>(null);
    // The group whose title field to focus once its panel shows (double-click on the title).
    const [titleFor, setTitleFor] = useState<string | null>(null);
    useEffect(() => {
        if (!titleFor) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            document.getElementById(groupTitleId(titleFor))?.focus();
            setTitleFor(null);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [titleFor]);

    const group = (keys: string[]) => {
        const placed = keys.filter((k) => positions[k]);
        if (!placed.length) {
            return;
        }
        const id = nextGroupId(groups);
        dispatch({ type: 'addGroup', group: { id, title: DEFAULT_GROUP_TITLE, color: DEFAULT_GROUP_COLOR, ...groupAround(placed, positions, graph) }, shown: positions });
        select({ kind: 'group', id });
    };
    const update = (id: string, changes: Partial<Group>) => dispatch({ type: 'updateGroup', id, changes });
    const requestRemove = (id: string) => {
        rememberFocus();
        setRemoving(id);
    };

    const selected = selection && selection.kind === 'group' ? groups.find((g) => g.id === selection.id) : undefined;
    const removingGroup = removing ? groups.find((g) => g.id === removing) : undefined;

    return {
        group,
        reveal: (sel: FlowSelection) => {
            const hiding = sel && sel.kind === 'node' ? groupHiding(job, graph, positions, sel.key) : undefined;
            if (hiding) {
                update(hiding.id, { collapsed: false });
            }
        },
        canvas: {
            groups,
            onGroupMove: (id: string, dx: number, dy: number, members: string[]) => dispatch({ type: 'moveGroup', id, dx, dy, members, shown: positions }),
            onGroupResize: (id: string, size: { w: number; h: number }) => update(id, size),
            onGroupTitle: (id: string) => {
                select({ kind: 'group', id });
                setTitleFor(id);
            },
            onRequestRemoveGroup: requestRemove,
            onGroup: group,
        },
        panel: selected ? (
            <GroupPanel
                key={selected.id}
                group={selected}
                members={membersOf(selected, graph, positions).length}
                onChange={(changes) => update(selected.id, changes)}
                onRequestRemove={() => requestRemove(selected.id)}
            />
        ) : null,
        modalOpen: Boolean(removingGroup),
        modal: removingGroup ? (
            <RemoveGroupModal
                group={removingGroup}
                returnFocus={returnFocus}
                onCancel={() => setRemoving(null)}
                onConfirm={() => {
                    // The group's focus stop goes away: focus moves to the canvas once the confirm has closed.
                    returnFocus.current = null;
                    window.setTimeout(() => document.querySelector<HTMLElement>('[data-canvas]')?.focus(), 0);
                    setRemoving(null);
                    dispatch({ type: 'removeGroup', id: removingGroup.id });
                    if (selected && selected.id === removingGroup.id) {
                        select(null);
                    }
                }}
            />
        ) : null,
    };
}
