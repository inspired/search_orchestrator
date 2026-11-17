/* The Flow canvas's copy, paste and duplicate: what the shortcuts do with the selection. Paste
 * reads the clipboard (it can be a clip copied from another job), puts the clip where asked, and
 * selects what it added; the message says how many nodes and which need a line into them. */
import React, { useRef } from 'react';
import type { JobDefinition } from '../../api/types';
import { clipIsEmpty, clipOrigin, copySelection, pasteResult, readClip, writeClip } from './clipboard';
import type { Clip } from './clipboard';
import type { Pos, Positions } from './graphLogic';
import type { FlowSelection } from './selection';
import { normaliseSelection, selectedKeys } from './selection';
import type { BuilderAction } from './reducer';

/** Duplicates land this far right and below the originals. */
export const DUPLICATE_OFFSET = 40;

export interface ClipboardOptions {
    job: JobDefinition;
    positions: Positions;
    selection: FlowSelection;
    dispatch: React.Dispatch<BuilderAction>;
    select: (sel: FlowSelection) => void;
    /** Shows a message with Undo (call before the edit it is about). */
    notify: (text: string) => void;
}

export default function useClipboard({ job, positions, selection, dispatch, select, notify }: ClipboardOptions) {
    // The job as it is when a paste is read from the clipboard, not when the key was pressed.
    const latest = useRef(job);
    latest.current = job;
    const put = (clip: Clip, at: Pos) => {
        const now = latest.current;
        const result = pasteResult(now, clip, at);
        notify(result.message);
        dispatch({ type: 'paste', clip, at });
        select(normaliseSelection(result.keys));
    };
    const copied = () => {
        const clip = copySelection(job, selectedKeys(selection), positions);
        return clipIsEmpty(clip) ? null : clip;
    };
    return {
        onCopy: () => {
            const clip = copied();
            if (clip) {
                writeClip(clip);
            }
        },
        onDuplicate: () => {
            const clip = copied();
            if (clip) {
                const o = clipOrigin(clip);
                put(clip, { x: o.x + DUPLICATE_OFFSET, y: o.y + DUPLICATE_OFFSET });
            }
        },
        onPaste: (at: Pos) => {
            readClip().then((clip) => {
                if (clip && !clipIsEmpty(clip)) {
                    put(clip, at);
                }
            });
        },
    };
}
