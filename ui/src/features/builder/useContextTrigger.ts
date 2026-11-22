/* What opens the Flow canvas's right-click menu: a right-click on a node, line or empty canvas,
 * and the Menu key or Shift+F10 on the focused node or line (or the canvas background, where the
 * menu is for the view centre). A node outside the selection is selected first; a node inside a
 * multi-selection keeps it. The browser's own menu is prevented over the canvas only. */
import React from 'react';
import type { Pos } from './graphLogic';
import type { ScreenPoint } from './useCanvasGestures';
import type { FlowSelection } from './selection';

export type ContextTarget = { kind: 'node'; key: string } | { kind: 'nodes'; keys: string[] } | { kind: 'link'; key: string } | { kind: 'canvas'; at: Pos };

export interface ContextTriggerOptions {
    svg: () => SVGSVGElement | null;
    onContext?: (target: ContextTarget, screen: ScreenPoint) => void;
    selected: FlowSelection;
    onSelect: (sel: FlowSelection) => void;
    /** Selects the line, as clicking it does. */
    selectLink: (key: string) => void;
    toCanvas: (clientX: number, clientY: number) => Pos;
}

const attr = (el: Element, name: string): string | null => (el.closest ? el.closest(`[${name}]`)?.getAttribute(name) || null : null);

export default function useContextTrigger({ svg, onContext, selected, onSelect, selectLink, toCanvas }: ContextTriggerOptions) {
    const open = (el: Element, screen: ScreenPoint, at: () => Pos) => {
        const node = attr(el, 'data-node-key');
        const link = node ? null : attr(el, 'data-link-hit') || attr(el, 'data-link-key');
        if (node) {
            const keys = selected && selected.kind === 'nodes' && selected.keys.includes(node) ? selected.keys : null;
            if (!keys && !(selected && selected.kind === 'node' && selected.key === node)) {
                onSelect({ kind: 'node', key: node });
            }
            onContext?.(keys ? { kind: 'nodes', keys } : { kind: 'node', key: node }, screen);
        } else if (link) {
            selectLink(link);
            onContext?.({ kind: 'link', key: link }, screen);
        } else {
            onContext?.({ kind: 'canvas', at: at() }, screen);
        }
    };
    return {
        onContextMenu: (ev: React.MouseEvent) => {
            ev.preventDefault();
            const rect = svg()?.getBoundingClientRect();
            open(ev.target as Element, { left: ev.clientX - (rect ? rect.left : 0), top: ev.clientY - (rect ? rect.top : 0) }, () => toCanvas(ev.clientX, ev.clientY));
        },
        /** True when the key opened the menu. */
        onKey: (ev: React.KeyboardEvent): boolean => {
            if (!onContext || !(ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey))) {
                return false;
            }
            ev.preventDefault();
            const el = svg();
            const rect = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
            const w = el ? el.clientWidth : 0;
            const h = el ? el.clientHeight : 0;
            const target = ev.target as Element;
            const box = target.getBoundingClientRect ? target.getBoundingClientRect() : null;
            const onItem = target !== el && (attr(target, 'data-node-key') || attr(target, 'data-link-key'));
            const screen = onItem && box ? { left: box.left - rect.left, top: box.bottom - rect.top + 4 } : { left: w / 2, top: h / 2 };
            open(target, screen, () => toCanvas(rect.left + w / 2, rect.top + h / 2));
            return true;
        },
    };
}
