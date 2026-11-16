/* The "add a node" box, like Nuke's Tab menu: type to filter, arrows to move, Enter to add. */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import { searchCatalog } from './nodeCatalog';
import type { CatalogEntry } from './nodeCatalog';
import type { NodeKind } from './nodeModel';
import { FAMILY_STYLE } from './nodeStyle';
import type { Family } from './nodeStyle';

export interface QuickAddProps {
    open: boolean;
    at: { left: number; top: number };
    kinds?: NodeKind[];
    onChoose: (kind: NodeKind) => void;
    onClose: () => void;
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

export default function QuickAdd({ open, at, kinds, onChoose, onClose }: QuickAddProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    if (!open) {
        return null;
    }
    return (
        <div style={popupStyle(theme, at)}>
            <NodeSearchList kinds={kinds} onChoose={onChoose} onClose={onClose} />
        </div>
    );
}

export interface NodeSearchListProps {
    kinds?: NodeKind[];
    onChoose: (kind: NodeKind) => void;
    onClose: () => void;
    /** Shift+Tab, or ArrowLeft in an empty box: go back to whatever came before (the When list). */
    onBack?: () => void;
}

/** The search box and grouped node list; focuses its box when it mounts. */
export function NodeSearchList({ kinds, onChoose, onClose, onBack }: NodeSearchListProps) {
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

    const activeKind = results[Math.min(active, results.length - 1)]?.kind;
    useEffect(() => {
        if (activeKind) {
            document.getElementById(`${uid}-opt-${activeKind}`)?.scrollIntoView?.({ block: 'nearest' });
        }
    }, [activeKind, uid]);

    const optionId = (kind: NodeKind): string => `${uid}-opt-${kind}`;
    const activeEntry: CatalogEntry | undefined = results[Math.min(active, results.length - 1)];

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (onBack && ((e.key === 'Tab' && e.shiftKey) || (e.key === 'ArrowLeft' && query === ''))) {
            e.preventDefault();
            onBack();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeEntry) {
                onChoose(activeEntry.kind);
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
                aria-activedescendant={activeEntry ? optionId(activeEntry.kind) : undefined}
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
                {results.length === 0 && (
                    <div style={{ padding: 10, color: theme.contentColorMuted }}>No matching nodes. Try a different word.</div>
                )}
                {families.map((g) => (
                    <div key={g.family} role="group" aria-label={FAMILY_STYLE[g.family].label}>
                        <div style={{ padding: '6px 10px 2px', fontSize: 12, color: theme.contentColorMuted }}>
                            {FAMILY_STYLE[g.family].label}
                        </div>
                        {g.items.map((r) => {
                            const isActive = activeEntry?.kind === r.kind;
                            return (
                                <div
                                    key={r.kind}
                                    id={optionId(r.kind)}
                                    role="option"
                                    aria-selected={isActive}
                                    onMouseEnter={() => setActive(results.indexOf(r))}
                                    onClick={() => onChoose(r.kind)}
                                    style={{
                                        padding: '6px 10px',
                                        cursor: 'pointer',
                                        background: isActive ? theme.backgroundColorHover : 'transparent',
                                    }}
                                >
                                    <div>{r.label}</div>
                                    <div style={{ fontSize: 12, color: theme.contentColorMuted }}>{r.description}</div>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </>
    );
}

interface FamilyGroup {
    family: Family;
    items: CatalogEntry[];
}
