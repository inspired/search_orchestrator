/* The job source field: a real textarea over a coloured copy of its text (same overlay as the
 * search field). The copy sizes the box, so both wrap identically; long text scrolls the frame. */
import React, { forwardRef, useState } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import JsonHighlight from './JsonHighlight';

export interface JsonEditorProps {
    value: string;
    onChange: (value: string) => void;
    inputId?: string;
    readOnly?: boolean;
    rowsMin?: number;
    rowsMax?: number;
}

const JsonEditor = forwardRef<HTMLTextAreaElement | null, JsonEditorProps>(function JsonEditor(
    { value, onChange, inputId, readOnly, rowsMin = 20, rowsMax = 40 },
    ref
) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [focused, setFocused] = useState(false);
    const shared: React.CSSProperties = {
        margin: 0,
        padding: '6px 8px',
        boxSizing: 'border-box',
        font: 'inherit',
        lineHeight: 1.5,
        letterSpacing: 'normal',
        tabSize: 2,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        wordBreak: 'normal',
    };
    return (
        <div
            style={{
                maxHeight: `calc(${rowsMax * 1.5}em + 12px)`,
                overflow: 'auto',
                fontFamily: theme.monoFontFamily,
                fontSize: theme.fontSizeSmall,
                background: theme.backgroundColorPage,
                border: `1px solid ${focused ? theme.focusColor : theme.borderColor}`,
                borderRadius: theme.borderRadius,
                boxShadow: focused ? `0 0 0 1px ${theme.focusColor}` : undefined,
            }}
        >
            <div style={{ position: 'relative' }}>
                <pre aria-hidden="true" data-testid="json-highlight" style={{ ...shared, minHeight: `calc(${rowsMin * 1.5}em + 12px)`, color: theme.contentColorDefault, pointerEvents: 'none' }}>
                    <JsonHighlight text={value} />
                    {'\n'}
                </pre>
                <textarea
                    ref={ref}
                    id={inputId}
                    value={value}
                    readOnly={readOnly}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    onChange={(e) => onChange(e.target.value)}
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
        </div>
    );
});

export default JsonEditor;
