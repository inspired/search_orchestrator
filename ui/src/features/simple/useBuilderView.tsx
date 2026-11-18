/* Simple or Flow on the builder's Flow tab, and the switch between them. The choice is
 * remembered in this browser (`so.builder.view`); with no choice yet, Simple opens jobs it
 * can edit and Flow the others. */
import React, { useState } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { JobDefinition } from '../../api/types';
import { readSimple } from './simpleModel';

export type BuilderView = 'simple' | 'flow';
const KEY = 'so.builder.view';

function stored(): BuilderView | null {
    try {
        const v = window.localStorage.getItem(KEY);
        return v === 'simple' || v === 'flow' ? v : null;
    } catch (err) {
        return null;
    }
}

export function useBuilderView(job: JobDefinition): [BuilderView, (v: BuilderView) => void] {
    const [chosen, setChosen] = useState<BuilderView | null>(stored);
    const view: BuilderView = chosen || (readSimple(job).reasons.length ? 'flow' : 'simple');
    const set = (v: BuilderView) => {
        setChosen(v);
        try {
            window.localStorage.setItem(KEY, v);
        } catch (err) {
            // Not remembered; it still switches for this page.
        }
    };
    return [view, set];
}

export function ViewSwitch({ view, onView }: { view: BuilderView; onView: (v: BuilderView) => void }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const button = (v: BuilderView, label: string, hint: string) => (
        <button
            type="button"
            aria-pressed={view === v}
            title={hint}
            onClick={() => onView(v)}
            style={{
                border: 0,
                padding: '5px 14px',
                font: 'inherit',
                fontWeight: 600,
                cursor: 'pointer',
                background: view === v ? theme.focusColor : 'transparent',
                color: view === v ? theme.contentColorInverted || '#fff' : theme.contentColorMuted,
            }}
        >
            {label}
        </button>
    );
    return (
        <div role="group" aria-label="View" style={{ display: 'inline-flex', border: `1px solid ${theme.borderColorStrong || theme.borderColor}`, borderRadius: '6px', overflow: 'hidden', margin: '4px 0 8px' }}>
            {button('simple', 'Simple', 'A list of searches, run top to bottom')}
            {button('flow', 'Flow', 'The node editor, for conditions, branches and approval')}
        </div>
    );
}
