/* The right-click menu (also opened with the Menu key or Shift+F10): a short list of actions for
 * a node, a multi-selection or the empty canvas. An item can be dimmed with the reason it can't
 * be used. Arrows move, Enter or a click chooses, Escape closes. The caller works out the items
 * and places it (see useFlowMenus). */
import React, { useEffect, useId, useRef, useState } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import { popupStyle } from './QuickAdd';

export interface MenuItem {
    id: string;
    label: string;
    disabled?: boolean;
    /** Why it is dimmed, shown under the label. */
    reason?: string;
}

export interface CanvasMenuProps {
    open: boolean;
    at: { left: number; top: number };
    /** The menu's accessible name, such as "Node". */
    label: string;
    items: MenuItem[];
    onChoose: (id: string) => void;
    onClose: () => void;
}

export default function CanvasMenu({ open, at, label, items, onChoose, onClose }: CanvasMenuProps) {
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
    const current = Math.min(active, items.length - 1);
    const rowId = (i: number) => `${uid}-item-${items[i].id}`;
    const choose = (i: number) => {
        if (items[i] && !items[i].disabled) {
            onChoose(items[i].id);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(Math.min(current + 1, items.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(Math.max(current - 1, 0));
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            choose(current);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    return (
        <div style={{ ...popupStyle(theme, at), width: 240 }}>
            <div
                ref={list}
                role="menu"
                aria-label={label}
                tabIndex={0}
                aria-activedescendant={items[current] ? rowId(current) : undefined}
                onKeyDown={onKeyDown}
                onContextMenu={(e) => e.preventDefault()}
                style={{ outline: 'none', padding: '4px 0' }}
            >
                {items.map((it, i) => (
                    <div
                        key={it.id}
                        id={rowId(i)}
                        role="menuitem"
                        aria-disabled={it.disabled ? true : undefined}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(i)}
                        style={{
                            padding: '6px 10px',
                            cursor: it.disabled ? 'default' : 'pointer',
                            opacity: it.disabled ? 0.6 : 1,
                            background: i === current ? theme.backgroundColorHover : 'transparent',
                        }}
                    >
                        <div>{it.label}</div>
                        {it.reason && <div style={{ fontSize: 12, color: theme.contentColorMuted }}>{it.reason}</div>}
                    </div>
                ))}
            </div>
        </div>
    );
}
