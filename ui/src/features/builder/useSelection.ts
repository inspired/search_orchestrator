/* The Flow tab's selection and the removal it can ask for: what is selected (one node, one line or
 * several nodes), kept to what still exists in the graph; and which node or nodes the remove
 * confirm is open for, with what happens once it is confirmed (focus moves on, and a selection
 * that no longer names the same node is dropped). */
import React, { useMemo, useState } from 'react';
import type { JobDefinition } from '../../api/types';
import { readGroups } from './groups';
import { JOB_KEY, stepKey } from './nodeModel';
import type { FlowGraph } from './nodeModel';
import type { BuilderAction } from './reducer';
import { FlowSelection, normaliseSelection } from './selection';

export interface SelectionOptions {
    job: JobDefinition;
    graph: FlowGraph;
    dispatch: React.Dispatch<BuilderAction>;
    /** Remember where focus is, to give it back when the confirm closes. */
    rememberFocus: () => void;
    returnFocus: React.MutableRefObject<HTMLElement | null>;
    /** After a confirmed removal: focus this node, or the canvas for null. */
    focusAfterRemove: (key: string | null) => void;
}

export default function useSelection({ job, graph, dispatch, rememberFocus, returnFocus, focusAfterRemove }: SelectionOptions) {
    const [selected, setSelected] = useState<FlowSelection>(null);
    const [removing, setRemovingState] = useState<string | string[] | null>(null);

    // A selection whose node or line is gone (removed, undone, renamed) counts as none; a
    // multi-selection keeps the nodes still there.
    const selection = useMemo<FlowSelection>(() => {
        if (!selected) {
            return null;
        }
        if (selected.kind === 'group') {
            return readGroups(job).some((g) => g.id === selected.id) ? selected : null;
        }
        const has = (key: string) => graph.nodes.some((n) => n.key === key);
        if (selected.kind === 'nodes') {
            const keys = selected.keys.filter(has);
            return keys.length === selected.keys.length ? selected : normaliseSelection(keys);
        }
        return (selected.kind === 'node' ? has(selected.key) : graph.links.some((l) => l.key === selected.key)) ? selected : null;
    }, [selected, graph, job]);

    const setRemoving = (key: string | string[] | null) => {
        if (key) {
            rememberFocus();
        }
        setRemovingState(key);
    };

    const requestRemove = (key: string) => {
        if (key !== JOB_KEY) {
            setRemoving(key);
        }
    };

    const requestRemoveNodes = (keys: string[]) => {
        const removable = keys.filter((k) => k !== JOB_KEY);
        if (removable.length) {
            setRemoving(removable.length === 1 ? removable[0] : removable);
        }
    };

    const confirmRemove = (action: BuilderAction) => {
        if (removing) {
            let next: string | null = null;
            if (action.type === 'removeStep') {
                const ids = job.steps.map((s) => s.id);
                const at = ids.indexOf(action.id);
                const id = ids[at + 1] !== undefined ? ids[at + 1] : ids[at - 1];
                next = id === undefined ? null : stepKey(id);
            }
            returnFocus.current = null;
            focusAfterRemove(next);
            dispatch(action);
            if (typeof removing !== 'string') {
                setSelected(null);
            } else {
                // Later actions in the same list, and later triggers, move down a place, so a
                // selection among them would point at a different node: drop it.
                const shifting = removing.startsWith('action:')
                    ? removing.slice(0, removing.lastIndexOf(':') + 1)
                    : removing.startsWith('trigger:')
                      ? 'trigger:'
                      : null;
                const key = selection && selection.kind === 'node' ? selection.key : null;
                if (key && (key === removing || (shifting && key.startsWith(shifting)))) {
                    setSelected(null);
                }
            }
        }
        setRemovingState(null);
    };

    return { selection, setSelected, removing, cancelRemove: () => setRemovingState(null), requestRemove, requestRemoveNodes, confirmRemove };
}
