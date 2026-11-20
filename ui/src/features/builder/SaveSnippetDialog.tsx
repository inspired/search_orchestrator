/* Save as snippet: a name and a description for the copied nodes, and who will see them. The
 * fields are shared with the Snippets dialog's Rename. */
import React, { useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import Text from '@splunk/react-ui/Text';
import TextArea from '@splunk/react-ui/TextArea';

export const SNIPPET_AUDIENCE = 'Everyone who can build jobs can see and insert this snippet, including its searches.';
const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;

/** What is wrong with a name and description, or null. */
export function snippetFieldsError(name: string, description: string): string | null {
    if (!name.trim()) {
        return 'Give the snippet a name.';
    }
    if (name.trim().length > NAME_MAX) {
        return `Shorten the name to ${NAME_MAX} characters or fewer.`;
    }
    if (description.length > DESCRIPTION_MAX) {
        return `Shorten the description to ${DESCRIPTION_MAX} characters or fewer.`;
    }
    return null;
}

/** A name and description form: checks them, sends them, and shows what went wrong. */
export function useSnippetForm(initial: { name: string; description: string }, send: (s: { name: string; description: string }) => Promise<void>) {
    const [name, setName] = useState(initial.name);
    const [description, setDescription] = useState(initial.description);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        const bad = snippetFieldsError(name, description);
        setError(bad);
        if (bad) {
            return;
        }
        setBusy(true);
        try {
            await send({ name: name.trim(), description });
        } catch (err) {
            setError((err as Error).message || 'The snippet was not saved. Try again.');
        } finally {
            setBusy(false);
        }
    };
    const fields = (
        <>
            {error && (
                <Message type="error" appearance="default">
                    {error}
                </Message>
            )}
            <ControlGroup label="Name" labelFor="snippet-name" labelPosition="top">
                <Text inputId="snippet-name" value={name} onChange={(_e: unknown, { value }: { value: string }) => setName(value)} />
            </ControlGroup>
            <ControlGroup label="Description" labelFor="snippet-description" labelPosition="top" help="Optional. Quick-add finds snippets by name and description.">
                <TextArea inputId="snippet-description" value={description} onChange={(_e: unknown, { value }: { value: string }) => setDescription(value)} />
            </ControlGroup>
        </>
    );
    return { fields, submit, busy };
}

export interface SaveSnippetDialogProps {
    onSave: (name: string, description: string) => Promise<void>;
    onClose: () => void;
}

export default function SaveSnippetDialog({ onSave, onClose }: SaveSnippetDialogProps) {
    // Focus goes back to what had it when the dialog opened (a node, or the panel's button).
    const returnFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
    const form = useSnippetForm({ name: '', description: '' }, (s) => onSave(s.name, s.description));
    return (
        <Modal open onRequestClose={onClose} returnFocus={returnFocus} style={{ width: '520px' }}>
            <Modal.Header title="Save as snippet" />
            <Modal.Body>
                {form.fields}
                <p>{SNIPPET_AUDIENCE}</p>
            </Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Cancel" onClick={onClose} />
                <Button appearance="primary" label="Save snippet" disabled={form.busy} onClick={form.submit} />
            </Modal.Footer>
        </Modal>
    );
}
