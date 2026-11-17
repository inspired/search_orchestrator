/* "Open larger": the same SPL editor and Insert value in a large dialog. The text is a copy
 * until Done; Cancel and Escape discard it. */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Modal from '@splunk/react-ui/Modal';
import { TokenInput } from './InsertToken';
import type { TokenGroup } from './tokens';

export interface LargeEditorModalProps {
    title: string;
    inputId: string;
    value: string;
    groups: TokenGroup[];
    placeholder?: string;
    pipeNewline?: boolean;
    returnFocus: React.MutableRefObject<HTMLElement | null>;
    onDone: (value: string) => void;
    onCancel: () => void;
}

export default function LargeEditorModal({ title, inputId, value, groups, placeholder, pipeNewline, returnFocus, onDone, onCancel }: LargeEditorModalProps) {
    const [draft, setDraft] = useState(value);
    return (
        <Modal open onRequestClose={onCancel} returnFocus={returnFocus} style={{ width: '80vw', maxWidth: '80vw' }}>
            <Modal.Header title={title} />
            <Modal.Body>
                <div style={{ minHeight: '60vh' }}>
                    <TokenInput inputId={inputId} fieldLabel={title} multiline rowsMin={24} value={draft} placeholder={placeholder} groups={groups} pipeNewline={pipeNewline} onValue={setDraft} />
                </div>
            </Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Cancel" onClick={onCancel} />
                <Button appearance="primary" label="Done" onClick={() => onDone(draft)} />
            </Modal.Footer>
        </Modal>
    );
}
