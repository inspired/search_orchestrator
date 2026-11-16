/* The When list that opens from a node's + handle: Succeeds, Fails, Finishes either way, Starts,
 * Is delayed, If a condition is true. Each row shows its glyph, how many lines already use it,
 * and "actions only" where only actions can follow. Arrows move, Enter or a click chooses,
 * Escape closes. With `withSearch`, choosing an outcome moves on to the node search below,
 * offering only the kinds that outcome can lead to; choosing a node then reports both.
 * Shift+Tab (or ArrowLeft in an empty search box) goes back to the outcomes. */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { NodeKind } from './nodeModel';
import type { Outcome, WhenOption } from './outcomes';
import { PORT_STYLE } from './nodeStyle';
import { NodeSearchList, popupStyle } from './QuickAdd';

export interface WhenMenuProps {
    open: boolean;
    at: { left: number; top: number };
    options: WhenOption[];
    withSearch?: { kinds: (o: Outcome) => NodeKind[] };
    onChoose: (o: Outcome, kind?: NodeKind) => void;
    onClose: () => void;
}

const lines = (n: number) => `${n} line${n === 1 ? '' : 's'}`;

export default function WhenMenu({ open, at, options, withSearch, onChoose, onClose }: WhenMenuProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [active, setActive] = useState(0);
    const [chosen, setChosen] = useState<Outcome | null>(null);
    const list = useRef<HTMLDivElement>(null);
    const uid = useId();
    const optionId = (o: Outcome) => `${uid}-when-${o}`;

    useEffect(() => {
        if (open) {
            setActive(0);
            setChosen(null);
            list.current?.focus();
        }
    }, [open]);

    const activeOption = options[Math.min(active, options.length - 1)];
    const activeOutcome = activeOption ? activeOption.outcome : null;
    useEffect(() => {
        if (open && activeOutcome) {
            document.getElementById(`${uid}-when-${activeOutcome}`)?.scrollIntoView?.({ block: 'nearest' });
        }
    }, [open, activeOutcome, uid]);

    const kinds = useMemo(() => (withSearch && chosen ? withSearch.kinds(chosen) : undefined), [withSearch, chosen]);

    if (!open) {
        return null;
    }

    const choose = (o: Outcome) => {
        if (withSearch) {
            setChosen(o);
            setActive(Math.max(0, options.findIndex((x) => x.outcome === o)));
        } else {
            onChoose(o);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (activeOption) {
                choose(activeOption.outcome);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    return (
        <div style={popupStyle(theme, at)}>
            <div style={{ padding: '6px 10px 2px', fontSize: 12, color: theme.contentColorMuted }}>When this node…</div>
            <div
                ref={list}
                role="listbox"
                aria-label="When"
                tabIndex={0}
                aria-activedescendant={activeOption ? optionId(activeOption.outcome) : undefined}
                onKeyDown={onKeyDown}
                style={{ outline: 'none', paddingBottom: 4 }}
            >
                {options.length === 0 && (
                    <div style={{ padding: 10, color: theme.contentColorMuted }}>No line can go there. Drop it on another node.</div>
                )}
                {options.map((opt, i) => {
                    const isActive = i === Math.min(active, options.length - 1);
                    return (
                        <div
                            key={opt.outcome}
                            id={optionId(opt.outcome)}
                            role="option"
                            aria-selected={isActive}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => choose(opt.outcome)}
                            style={{
                                display: 'flex',
                                alignItems: 'baseline',
                                gap: 8,
                                padding: '6px 10px',
                                cursor: 'pointer',
                                background: isActive ? theme.backgroundColorHover : 'transparent',
                                boxShadow: chosen === opt.outcome ? `inset 3px 0 0 ${theme.focusColor}` : undefined,
                            }}
                        >
                            <span aria-hidden style={{ width: 16, textAlign: 'center', color: theme[PORT_STYLE[opt.outcome].colorToken] }}>
                                {opt.glyph}
                            </span>
                            <span style={{ flex: 1 }}>{opt.label}</span>
                            {opt.note && <span style={{ fontSize: 12, color: theme.contentColorMuted }}>{opt.note}</span>}
                            {opt.count > 0 && <span style={{ fontSize: 12, color: theme.contentColorMuted }}>{lines(opt.count)}</span>}
                        </div>
                    );
                })}
            </div>
            {withSearch && chosen && (
                <div style={{ borderTop: `1px solid ${theme.borderColorStrong}` }}>
                    <NodeSearchList
                        key={chosen}
                        kinds={kinds}
                        onChoose={(kind) => onChoose(chosen, kind)}
                        onClose={onClose}
                        onBack={() => {
                            setChosen(null);
                            list.current?.focus();
                        }}
                    />
                </div>
            )}
        </div>
    );
}
