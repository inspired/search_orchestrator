/* Simple, Standard or Advanced on the builder's first tab, and the switch between them. All
 * three edit the same job; switching changes nothing in it. The choice is remembered in this
 * browser (`so.builder.view`; the old "flow" reads as Advanced); with no choice yet, Standard
 * opens. Simple is locked for a job it can't show: choosing it says why and stays. */
import React, { useState } from 'react';
import Message from '@splunk/react-ui/Message';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { JobDefinition } from '../../api/types';
import { readSimple } from './simpleModel';

export type BuilderView = 'simple' | 'standard' | 'advanced';
const KEY = 'so.builder.view';

function stored(): BuilderView | null {
    try {
        const v = window.localStorage.getItem(KEY);
        if (v === 'flow') {
            return 'advanced';
        }
        return v === 'simple' || v === 'standard' || v === 'advanced' ? v : null;
    } catch (err) {
        return null;
    }
}

export function useBuilderView(job: JobDefinition): [BuilderView, (v: BuilderView) => void] {
    const [chosen, setChosen] = useState<BuilderView | null>(stored);
    let view: BuilderView = chosen || 'standard';
    if (view === 'simple' && readSimple(job).reasons.length) {
        view = 'standard';
    }
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

/** The message shown when Simple is chosen for a job it can't show. */
export const lockedText = (reasons: string[]): string => `Simple can't show this job: ${reasons.join(', ')}. Use Standard or Advanced.`;

export function ViewSwitch({ view, onView, lockedReasons = [] }: { view: BuilderView; onView: (v: BuilderView) => void; lockedReasons?: string[] }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [told, setTold] = useState(false);
    const locked = lockedReasons.length > 0;
    const button = (v: BuilderView, label: string, hint: string) => {
        const off = v === 'simple' && locked;
        return (
            <button
                type="button"
                aria-pressed={view === v}
                aria-disabled={off ? 'true' : undefined}
                title={off ? "Simple can't show this job" : hint}
                onClick={() => {
                    if (off) {
                        setTold(true);
                        return;
                    }
                    setTold(false);
                    onView(v);
                }}
                style={{
                    border: 0,
                    padding: '5px 14px',
                    font: 'inherit',
                    fontWeight: 600,
                    cursor: off ? 'not-allowed' : 'pointer',
                    opacity: off ? 0.55 : 1,
                    background: view === v ? theme.focusColor : 'transparent',
                    color: view === v ? theme.contentColorInverted || '#fff' : theme.contentColorMuted,
                }}
            >
                {off && (
                    <svg aria-hidden width="11" height="11" viewBox="0 0 24 24" style={{ marginRight: '5px', verticalAlign: '-1px' }} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="11" width="14" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                )}
                {label}
            </button>
        );
    };
    return (
        <div>
            <div role="group" aria-label="View" style={{ display: 'inline-flex', border: `1px solid ${theme.borderColorStrong || theme.borderColor}`, borderRadius: '6px', overflow: 'hidden', margin: '4px 0 8px' }}>
                {button('simple', 'Simple', 'A list of searches, run top to bottom')}
                {button('standard', 'Standard', 'The steps on a canvas; triggers and actions in tabs and panels')}
                {button('advanced', 'Advanced', 'The node editor: triggers, conditions and actions as nodes')}
            </div>
            {told && locked && (
                <Message type="warning" appearance="default" onRequestRemove={() => setTold(false)}>
                    {lockedText(lockedReasons)}
                </Message>
            )}
        </div>
    );
}
