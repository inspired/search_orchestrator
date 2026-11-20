/* The "add a node" box, like Nuke's Tab menu: type to filter, arrows to move, Enter to add.
 * Opened on the canvas (not to continue a line), it also lists matching snippets after the
 * node kinds. */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { SnippetInfo } from '../../api/snippets';
import { isBeta, searchCatalog } from './nodeCatalog';
import type { CatalogEntry } from './nodeCatalog';
import type { NodeKind } from './nodeModel';
import { FAMILY_STYLE } from './nodeStyle';
import type { Family } from './nodeStyle';
import BetaTag from './BetaTag';

export interface QuickAddProps {
    open: boolean;
    at: { left: number; top: number };
    kinds?: NodeKind[];
    onChoose: (kind: NodeKind) => void;
    onClose: () => void;
    /** Snippets to offer (null while loading); a Snippets section shows only with onPickSnippet. */
    snippets?: SnippetInfo[] | null;
    /** Why the snippets couldn't load or be inserted. */
    snippetError?: string | null;
    onPickSnippet?: (id: string) => void;
}

/** The popup frame shared with the When list: positioned from the canvas' top-left corner. */
export function popupStyle(theme: Record<string, string>, at: { left: number; top: number }): React.CSSProperties {
    return {
        position: 'absolute',
        left: at.left,
        top: at.top,
        zIndex: 10,
        width: 320,
        background: theme.backgroundColorPopup,
        color: theme.contentColorDefault,
        border: `1px solid ${theme.borderColorStrong}`,
        borderRadius: 4,
        boxShadow: theme.overlayShadow,
        fontFamily: theme.fontFamily,
    };
}

export default function QuickAdd({ open, at, kinds, onChoose, onClose, snippets, snippetError, onPickSnippet }: QuickAddProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    if (!open) {
        return null;
    }
    return (
        <div style={popupStyle(theme, at)}>
            <NodeSearchList kinds={kinds} onChoose={onChoose} onClose={onClose} snippets={snippets} snippetError={snippetError} onPickSnippet={onPickSnippet} />
        </div>
    );
}

export interface NodeSearchListProps extends Pick<QuickAddProps, 'snippets' | 'snippetError' | 'onPickSnippet'> {
    kinds?: NodeKind[];
    onChoose: (kind: NodeKind) => void;
    onClose: () => void;
    /** Shift+Tab, or ArrowLeft in an empty box: go back to whatever came before (the When list). */
    onBack?: () => void;
}

/** The search box and grouped node list; focuses its box when it mounts. */
/** Snippets whose name or description holds `query` (all for an empty one), names first. */
export function matchSnippets(snippets: SnippetInfo[], query: string): SnippetInfo[] {
    const q = query.trim().toLowerCase();
    if (!q) {
        return snippets;
    }
    const byName = snippets.filter((s) => s.name.toLowerCase().includes(q));
    return [...byName, ...snippets.filter((s) => !byName.includes(s) && s.description.toLowerCase().includes(q))];
}

/** One row of the list, in arrow order: a node kind or a snippet. */
type Row = { kind: NodeKind; snippet?: undefined } | { kind?: undefined; snippet: SnippetInfo };

export function NodeSearchList({ kinds, onChoose, onClose, onBack, snippets, snippetError, onPickSnippet }: NodeSearchListProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const input = useRef<HTMLInputElement>(null);
    const uid = useId();
    const listId = `${uid}-list`;

    useEffect(() => {
        input.current?.focus();
    }, []);

    // Group by family (a heading sits at its best result), so arrow order matches what is on screen.
    const { results, families } = useMemo(() => {
        const found = searchCatalog(query, kinds);
        const groups: FamilyGroup[] = [];
        found.forEach((r) => {
            let g = groups.find((f) => f.family === r.family);
            if (!g) {
                g = { family: r.family, items: [] };
                groups.push(g);
            }
            g.items.push(r);
        });
        return { results: groups.flatMap((g) => g.items), families: groups };
    }, [query, kinds]);
    const shownSnippets = useMemo(() => (onPickSnippet && snippets ? matchSnippets(snippets, query) : []), [onPickSnippet, snippets, query]);
    const rows: Row[] = [...results.map((r) => ({ kind: r.kind })), ...shownSnippets.map((sn) => ({ snippet: sn }))];

    const optionId = (row: Row): string => (row.snippet ? `${uid}-opt-snippet-${row.snippet.id}` : `${uid}-opt-${row.kind}`);
    const activeRow: Row | undefined = rows[Math.min(active, rows.length - 1)];
    const activeId = activeRow ? optionId(activeRow) : undefined;
    useEffect(() => {
        if (activeId) {
            document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
        }
    }, [activeId]);
    const pick = (row: Row) => (row.snippet ? onPickSnippet?.(row.snippet.id) : onChoose(row.kind));
    const rowStyle = (isActive: boolean): React.CSSProperties => ({
        padding: '6px 10px',
        cursor: 'pointer',
        background: isActive ? theme.backgroundColorHover : 'transparent',
    });
    const heading: React.CSSProperties = { padding: '6px 10px 2px', fontSize: 12, color: theme.contentColorMuted };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (onBack && ((e.key === 'Tab' && e.shiftKey) || (e.key === 'ArrowLeft' && query === ''))) {
            e.preventDefault();
            onBack();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, rows.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeRow) {
                pick(activeRow);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    return (
        <>
            <input
                ref={input}
                type="text"
                role="combobox"
                aria-label="Add a node"
                aria-expanded
                aria-autocomplete="list"
                aria-controls={listId}
                aria-activedescendant={activeId}
                placeholder="Search for a node"
                value={query}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                }}
                onKeyDown={onKeyDown}
                style={{
                    boxSizing: 'border-box',
                    width: '100%',
                    padding: '8px 10px',
                    background: theme.backgroundColorSection,
                    color: theme.contentColorDefault,
                    border: 'none',
                    borderBottom: `1px solid ${theme.borderColorStrong}`,
                    outline: 'none',
                    font: 'inherit',
                }}
            />
            <div id={listId} role="listbox" aria-label="Nodes" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {rows.length === 0 && (
                    <div style={{ padding: 10, color: theme.contentColorMuted }}>No matching nodes. Try a different word.</div>
                )}
                {families.map((g) => (
                    <div key={g.family} role="group" aria-label={FAMILY_STYLE[g.family].label}>
                        <div style={heading}>{FAMILY_STYLE[g.family].label}</div>
                        {g.items.map((r) => {
                            const isActive = activeRow?.kind === r.kind;
                            return (
                                <div
                                    key={r.kind}
                                    id={optionId({ kind: r.kind })}
                                    role="option"
                                    aria-selected={isActive}
                                    onMouseEnter={() => setActive(results.indexOf(r))}
                                    onClick={() => onChoose(r.kind)}
                                    style={rowStyle(isActive)}
                                >
                                    <div>
                                        {r.label}
                                        {isBeta(r.kind) && <BetaTag />}
                                    </div>
                                    <div style={{ fontSize: 12, color: theme.contentColorMuted }}>{r.description}</div>
                                </div>
                            );
                        })}
                    </div>
                ))}
                {onPickSnippet && (shownSnippets.length > 0 || snippetError || !snippets) && (
                    <div role="group" aria-label="Snippets">
                        <div style={heading}>Snippets</div>
                        {snippetError && <div style={{ padding: '6px 10px', color: theme.contentColorMuted }}>{snippetError}</div>}
                        {!snippets && !snippetError && <div style={{ padding: '6px 10px', color: theme.contentColorMuted }}>Loading snippets…</div>}
                        {shownSnippets.map((sn, i) => {
                            const isActive = activeRow?.snippet?.id === sn.id;
                            return (
                                <div
                                    key={sn.id}
                                    id={optionId({ snippet: sn })}
                                    role="option"
                                    aria-selected={isActive}
                                    onMouseEnter={() => setActive(results.length + i)}
                                    onClick={() => onPickSnippet(sn.id)}
                                    style={rowStyle(isActive)}
                                >
                                    <div>{sn.name}</div>
                                    <div style={{ fontSize: 12, color: theme.contentColorMuted }}>
                                        {`${sn.node_count} node${sn.node_count === 1 ? '' : 's'}${sn.description ? ` · ${sn.description}` : ''}`}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </>
    );
}

interface FamilyGroup {
    family: Family;
    items: CatalogEntry[];
}
