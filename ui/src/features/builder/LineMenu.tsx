/* The small menu a line's label opens: "Change to <outcome>" for each allowed outcome, then
 * "Insert a node" and "Remove line" where allowed. Arrows move, Enter or a click chooses, Escape
 * closes. The caller works out the rows (`lineMenuOutcomes`, `canSplice`) and places it. */
import React, { useEffect, useId, useRef, useState } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Outcome, WhenOption } from './outcomes';
import { PORT_STYLE } from './nodeStyle';
import { popupStyle } from './QuickAdd';

export type LineChoice = { kind: 'outcome'; outcome: Outcome } | { kind: 'insert' } | { kind: 'remove' };

export interface LineMenuProps {
    open: boolean;
    at: { left: number; top: number };
    outcomes: Pick<WhenOption, 'outcome' | 'label' | 'glyph'>[];
    canInsert: boolean;
    canRemove: boolean;
    onChoose: (choice: LineChoice) => void;
    onClose: () => void;
}

interface Row {
    id: string;
    label: string;
    glyph?: string;
    color?: string;
    choice: LineChoice;
}

export default function LineMenu({ open, at, outcomes, canInsert, canRemove, onChoose, onClose }: LineMenuProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [active, setActive] = useState(0);
    const list = useRef<HTMLDivElement>(null);
    const uid = useId();

    useEffect(() => {
        if (open) {
            setActive(0);
            list.current?.focus();
        }
    }, [open]);

    if (!open) {
        return null;
    }

    const rows: Row[] = [
        ...outcomes.map((o) => ({
            id: o.outcome,
            label: `Change to ${o.label}`,
            glyph: o.glyph,
            color: theme[PORT_STYLE[o.outcome].colorToken],
            choice: { kind: 'outcome', outcome: o.outcome } as LineChoice,
        })),
        ...(canInsert ? [{ id: 'insert', label: 'Insert a node', choice: { kind: 'insert' } as LineChoice }] : []),
        ...(canRemove ? [{ id: 'remove', label: 'Remove line', choice: { kind: 'remove' } as LineChoice }] : []),
    ];
    const current = Math.min(active, rows.length - 1);
    const rowId = (r: Row) => `${uid}-line-${r.id}`;

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, rows.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (rows[current]) {
                onChoose(rows[current].choice);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    return (
        <div style={{ ...popupStyle(theme, at), width: 240 }}>
            <div
                ref={list}
                role="listbox"
                aria-label="Line"
                tabIndex={0}
                aria-activedescendant={rows[current] ? rowId(rows[current]) : undefined}
                onKeyDown={onKeyDown}
                style={{ outline: 'none', padding: '4px 0' }}
            >
                {rows.length === 0 && <div style={{ padding: 10, color: theme.contentColorMuted }}>Nothing can change on this line.</div>}
                {rows.map((r, i) => (
                    <div
                        key={r.id}
                        id={rowId(r)}
                        role="option"
                        aria-selected={i === current}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => onChoose(r.choice)}
                        style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: 8,
                            padding: '6px 10px',
                            cursor: 'pointer',
                            background: i === current ? theme.backgroundColorHover : 'transparent',
                            borderTop: r.choice.kind !== 'outcome' && i > 0 && rows[i - 1].choice.kind === 'outcome' ? `1px solid ${theme.borderColor}` : undefined,
                        }}
                    >
                        {r.glyph && (
                            <span aria-hidden style={{ width: 16, textAlign: 'center', color: r.color }}>
                                {r.glyph}
                            </span>
                        )}
                        <span style={{ flex: 1 }}>{r.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
