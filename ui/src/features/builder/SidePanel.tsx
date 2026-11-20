/* The builder's side panel beside the canvas: it can be hidden (a thin strip with a button
 * brings it back) and resized by dragging its left edge or with the arrow keys on that edge
 * (Home and End for the narrowest and widest). Open and width are remembered in this browser
 * (`so.flow.panel`). */
import React, { forwardRef, useCallback, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ChevronLeft from '@splunk/react-icons/ChevronLeft';
import ChevronRight from '@splunk/react-icons/ChevronRight';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';

export const MIN_WIDTH = 260;
export const MAX_WIDTH = 800;
export const DEFAULT_WIDTH = 360;
const STEP = 20;
const KEY = 'so.flow.panel';

export const clampWidth = (w: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)));

function load(): { open: boolean; width: number } {
    try {
        const v = JSON.parse(window.localStorage.getItem(KEY) || '{}');
        return { open: v.open !== false, width: typeof v.width === 'number' ? clampWidth(v.width) : DEFAULT_WIDTH };
    } catch (err) {
        return { open: true, width: DEFAULT_WIDTH };
    }
}

function store(v: { open: boolean; width: number }) {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(v));
    } catch (err) {
        // Not remembered; it still works for this page.
    }
}

export function usePanelLayout() {
    const [state, setState] = useState(load);
    const update = useCallback((next: Partial<{ open: boolean; width: number }>) => {
        setState((s) => {
            const v = { ...s, ...next };
            store(v);
            return v;
        });
    }, []);
    return {
        open: state.open,
        width: state.width,
        toggle: () => update({ open: !state.open }),
        setOpen: (open: boolean) => update({ open }),
        setWidth: (w: number) => update({ width: clampWidth(w) }),
    };
}

export interface SidePanelProps {
    open: boolean;
    width: number;
    onOpen: (open: boolean) => void;
    onWidth: (width: number) => void;
    maxHeight: number;
    children: React.ReactNode;
}

const SidePanel = forwardRef<HTMLDivElement, SidePanelProps>(function SidePanel({ open, width, onOpen, onWidth, maxHeight, children }, ref) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [dragging, setDragging] = useState(false);
    if (!open) {
        return (
            <div style={{ flex: 'none', borderLeft: `1px solid ${theme.borderColor}`, paddingLeft: '4px' }}>
                <Button appearance="subtle" icon={<ChevronLeft />} aria-label="Show side panel" onClick={() => onOpen(true)} />
            </div>
        );
    }
    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = width;
        setDragging(true);
        const move = (ev: PointerEvent) => onWidth(startW + (startX - ev.clientX));
        const up = () => {
            setDragging(false);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const next =
            e.key === 'ArrowLeft' ? width + STEP : e.key === 'ArrowRight' ? width - STEP : e.key === 'Home' ? MIN_WIDTH : e.key === 'End' ? MAX_WIDTH : null;
        if (next !== null) {
            e.preventDefault();
            onWidth(next);
        }
    };
    return (
        <div style={{ display: 'flex', flex: 'none', width: `${width}px` }}>
            <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize side panel"
                aria-valuenow={width}
                aria-valuemin={MIN_WIDTH}
                aria-valuemax={MAX_WIDTH}
                tabIndex={0}
                onPointerDown={onPointerDown}
                onKeyDown={onKeyDown}
                onDoubleClick={() => onWidth(DEFAULT_WIDTH)}
                title="Drag to resize; double-click for the default width"
                style={{
                    flex: 'none',
                    width: '8px',
                    cursor: 'col-resize',
                    alignSelf: 'stretch',
                    display: 'flex',
                    justifyContent: 'center',
                    touchAction: 'none',
                }}
            >
                <span style={{ width: dragging ? '3px' : '1px', background: dragging ? theme.focusColor : theme.borderColor }} />
            </div>
            <div ref={ref} style={{ flex: '1 1 auto', minWidth: 0, paddingLeft: '8px', maxHeight: `${maxHeight}px`, overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button appearance="subtle" icon={<ChevronRight />} aria-label="Hide side panel" onClick={() => onOpen(false)} />
                </div>
                {children}
            </div>
        </div>
    );
});

export default SidePanel;
