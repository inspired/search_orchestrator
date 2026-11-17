/* The search field: a real textarea (selection, IME, undo, screen readers) over a coloured
 * copy of its text. The copy sizes the box, so both wrap identically and nothing needs
 * scroll syncing. Typing | can start a new line (see pipeNewline). */
import React, { forwardRef, useState, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import Checkbox from '@splunk/react-ui/Checkbox';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import SplHighlight from './SplHighlight';
import { pipeNewlineEdit } from './pipeNewline';
import usePipeNewlinePref from './usePipeNewlinePref';

export interface SplEditorProps {
    value: string;
    onChange: (value: string) => void;
    inputId?: string;
    error?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    placeholder?: string;
    rowsMin?: number;
    /** Offer "Put each | on a new line" (default true). Off for a single expression. */
    pipeNewline?: boolean;
}

const SplEditor = forwardRef<HTMLTextAreaElement | null, SplEditorProps>(function SplEditor(
    { value, onChange, inputId, error, disabled, readOnly, placeholder, rowsMin = 4, pipeNewline: offerPipeNewline = true },
    ref
) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [pipePref, togglePipeNewline] = usePipeNewlinePref();
    const pipeNewline = offerPipeNewline && pipePref;
    const area = useRef<HTMLTextAreaElement | null>(null);
    const caret = useRef<number | null>(null);
    const [focused, setFocused] = useState(false);
    useImperativeHandle(ref, () => area.current as HTMLTextAreaElement);
    // The fallback edit sets the value first; the caret goes in once it has rendered.
    useLayoutEffect(() => {
        if (caret.current !== null && area.current) {
            area.current.setSelectionRange(caret.current, caret.current);
            caret.current = null;
        }
    });

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const ne = e.nativeEvent as KeyboardEvent;
        if (
            !pipeNewline ||
            readOnly ||
            disabled ||
            e.key !== '|' ||
            e.metaKey ||
            (e.ctrlKey && !e.altKey) ||
            ne.isComposing
        ) {
            return;
        }
        const el = e.currentTarget;
        if (el.selectionStart !== el.selectionEnd) {
            return;
        }
        const at = el.selectionStart;
        const edit = pipeNewlineEdit(el.value, at);
        if (!edit) {
            return;
        }
        e.preventDefault();
        // One undo step where the browser allows it; the space before the caret goes with it.
        if (typeof document.execCommand === 'function') {
            if (el.value[at - 1] === ' ') {
                el.setSelectionRange(at - 1, at);
            }
            let done = false;
            try {
                done = document.execCommand('insertText', false, '\n| ');
            } catch (err) {
                done = false;
            }
            if (done) {
                return;
            }
            el.setSelectionRange(at, at);
        }
        caret.current = edit.caret;
        onChange(edit.text);
    };

    const font = theme.monoFontFamily;
    const border = error ? theme.statusColorHigh : focused ? theme.focusColor : theme.borderColor;
    const shared: React.CSSProperties = {
        margin: 0,
        padding: '6px 8px',
        boxSizing: 'border-box',
        font: 'inherit',
        lineHeight: 1.5,
        letterSpacing: 'normal',
        tabSize: 4,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        wordBreak: 'normal',
    };
    return (
        <div>
            <div
                style={{
                    position: 'relative',
                    fontFamily: font,
                    fontSize: theme.fontSizeSmall,
                    background: disabled ? theme.backgroundColorSection : theme.backgroundColorPage,
                    border: `1px solid ${border}`,
                    borderRadius: theme.borderRadius,
                    boxShadow: focused && !error ? `0 0 0 1px ${theme.focusColor}` : undefined,
                    opacity: disabled ? 0.6 : 1,
                }}
            >
                <pre aria-hidden="true" data-testid="spl-highlight" style={{ ...shared, minHeight: `${rowsMin * 1.5}em`, color: theme.contentColorDefault, pointerEvents: 'none' }}>
                    {value ? <SplHighlight text={value} /> : <span style={{ color: theme.contentColorMuted }}>{placeholder}</span>}
                    {'\n'}
                </pre>
                <textarea
                    ref={area}
                    id={inputId}
                    value={value}
                    disabled={disabled}
                    readOnly={readOnly}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={onKeyDown}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    style={{
                        ...shared,
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        resize: 'none',
                        overflow: 'hidden',
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        color: 'transparent',
                        caretColor: theme.contentColorDefault,
                    }}
                />
            </div>
            {offerPipeNewline && (
                <Checkbox checked={pipePref} onChange={togglePipeNewline} value="pipe-newline">
                    Put each | on a new line
                </Checkbox>
            )}
        </div>
    );
});

export default SplEditor;
