/* Snippets in the builder: the list (loaded when asked, kept while it reloads), inserting one
 * at a canvas point with the paste code (one undo step), and saving the selection as one. Only
 * builders and admins use snippets; for anyone else nothing loads and nothing is offered. */
import { useEffect, useRef, useState } from 'react';
import { createSnippet, deleteSnippet, getSnippet, listSnippets, renameSnippet } from '../../api/snippets';
import type { SnippetInfo } from '../../api/snippets';
import type { JobDefinition, Me } from '../../api/types';
import { clipIsEmpty, copySelection } from './clipboard';
import type { Clip } from './clipboard';
import type { Pos, Positions } from './graphLogic';

export interface SnippetOptions {
    job: JobDefinition;
    positions: Positions;
    me: Me | null | undefined;
    /** Pastes a clip as Paste does (useClipboard's `put`); `say` rewords its message. */
    put: (clip: Clip, at: Pos, say: (message: string) => string) => void;
}

export interface Snippets {
    snippets: SnippetInfo[] | null;
    error: string | null;
    refresh: () => void;
    /** Rejects (with `error` set) when the snippet couldn't be read. */
    insert: (id: string, at: Pos) => Promise<void>;
    /** The user may list, insert and save snippets. */
    canUse: boolean;
    /** The clip the Save as snippet dialog is for, while it is open. */
    saving: Clip | null;
    /** Opens the save dialog for these nodes (nothing happens when none can be copied). */
    requestSave: (keys: string[]) => void;
    cancelSave: () => void;
    /** Saves `saving`; rejects with the server's error (the dialog shows it). */
    create: (name: string, description: string) => Promise<void>;
    rename: (id: string, s: { name: string; description: string }) => Promise<void>;
    remove: (id: string) => Promise<void>;
}

export default function useSnippets({ job, positions, me, put }: SnippetOptions): Snippets {
    const canUse = Boolean(me && (me.can_build || me.can_admin));
    const [snippets, setSnippets] = useState<SnippetInfo[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState<Clip | null>(null);
    const alive = useRef(true);
    const asked = useRef(0);
    useEffect(
        () => () => {
            alive.current = false;
        },
        []
    );

    const refresh = () => {
        if (!canUse) {
            return;
        }
        asked.current += 1;
        const n = asked.current;
        listSnippets().then(
            (list) => {
                if (alive.current && n === asked.current) {
                    setSnippets(list);
                    setError(null);
                }
            },
            (err: Error) => {
                if (alive.current && n === asked.current) {
                    setError(`Snippets couldn't load: ${err.message}`);
                }
            }
        );
    };

    const insert = async (id: string, at: Pos) => {
        try {
            const s = await getSnippet(id);
            put(s.content, at, (m) => m.replace(/^Pasted /, `Inserted ${s.name}: `));
            setError(null);
        } catch (err) {
            const name = (snippets || []).find((s) => s.id === id)?.name || 'The snippet';
            if (alive.current) {
                setError(`${name} couldn't be inserted: ${(err as Error).message}`);
            }
            throw err;
        }
    };

    return {
        snippets,
        error,
        refresh,
        insert,
        canUse,
        saving,
        requestSave: (keys) => {
            const clip = copySelection(job, keys, positions);
            if (canUse && !clipIsEmpty(clip)) {
                setSaving(clip);
            }
        },
        cancelSave: () => setSaving(null),
        create: async (name, description) => {
            if (saving) {
                await createSnippet({ name, description, content: saving });
                setSaving(null);
                refresh();
            }
        },
        rename: async (id, s) => {
            await renameSnippet(id, s);
            refresh();
        },
        remove: async (id) => {
            await deleteSnippet(id);
            refresh();
        },
    };
}
