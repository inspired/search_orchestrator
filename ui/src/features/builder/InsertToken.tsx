/* "Insert value": a menu of $tokens$ for a text field. TokenInput wraps a SUIT Text or
 * TextArea, remembers its selection and puts the chosen token there. A field that was never
 * focused has no selection, so the token goes at the end. */
import React, { useCallback, useLayoutEffect, useRef } from 'react';
import Button from '@splunk/react-ui/Button';
import Dropdown from '@splunk/react-ui/Dropdown';
import Menu from '@splunk/react-ui/Menu';
import Text from '@splunk/react-ui/Text';
import TextArea from '@splunk/react-ui/TextArea';
import { insertAt, Selection, TokenGroup } from './tokens';

export interface InsertTokenProps {
    groups: TokenGroup[];
    /** The field's label; names the toggle for assistive technology. */
    fieldLabel: string;
    onInsert: (token: string) => void;
}

export default function InsertToken({ groups, fieldLabel, onInsert }: InsertTokenProps) {
    return (
        <Dropdown
            closeReasons={['clickAway', 'escapeKey', 'offScreen', 'toggleClick', 'contentClick']}
            toggle={<Button appearance="subtle" label="Insert value" aria-label={`Insert value into ${fieldLabel}`} />}
        >
            <Menu>
                {groups.map((g) => (
                    <React.Fragment key={g.title}>
                        <Menu.Heading>{g.title}</Menu.Heading>
                        {g.options.map((o) => (
                            <Menu.Item key={o.token} description={o.description} onClick={() => onInsert(o.token)}>
                                {o.label}
                            </Menu.Item>
                        ))}
                    </React.Fragment>
                ))}
            </Menu>
        </Dropdown>
    );
}

type El = HTMLInputElement | HTMLTextAreaElement;

export interface TokenInputProps {
    inputId: string;
    fieldLabel: string;
    value: string;
    groups: TokenGroup[];
    /** Called with the new text, like the field's own typing. */
    onValue: (value: string) => void;
    multiline?: boolean;
    rowsMin?: number;
    placeholder?: string;
}

export function TokenInput({ inputId, fieldLabel, value, groups, onValue, multiline, rowsMin, placeholder }: TokenInputProps) {
    const el = useRef<El | null>(null);
    const selection = useRef<Selection | null>(null);
    const pending = useRef<number | null>(null);
    const remember = useCallback(() => {
        const e = el.current;
        if (e && e.selectionStart !== null && e.selectionEnd !== null) {
            selection.current = { start: e.selectionStart, end: e.selectionEnd };
        }
    }, []);
    const setRef = useCallback(
        (next: El | null) => {
            const prev = el.current;
            if (prev) {
                ['select', 'keyup', 'click', 'blur'].forEach((n) => prev.removeEventListener(n, remember));
            }
            el.current = next;
            if (next) {
                ['select', 'keyup', 'click', 'blur'].forEach((n) => next.addEventListener(n, remember));
            }
        },
        [remember]
    );
    // After the new text renders, focus the field and put the caret after the token.
    useLayoutEffect(() => {
        const caret = pending.current;
        if (caret !== null && el.current) {
            pending.current = null;
            el.current.focus();
            el.current.setSelectionRange(caret, caret);
            selection.current = { start: caret, end: caret };
        }
    });
    const onInsert = (token: string) => {
        const next = insertAt(value, selection.current, token);
        pending.current = next.caret;
        onValue(next.text);
    };
    const onChange = (_e: unknown, { value: v }: { value: string }) => onValue(v);
    return (
        <div>
            {multiline ? (
                <TextArea inputId={inputId} inputRef={setRef} value={value} rowsMin={rowsMin} onChange={onChange} />
            ) : (
                <Text inputId={inputId} inputRef={setRef} value={value} placeholder={placeholder} onChange={onChange} />
            )}
            <InsertToken groups={groups} fieldLabel={fieldLabel} onInsert={onInsert} />
        </div>
    );
}
