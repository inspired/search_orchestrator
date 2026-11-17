/* Import job: paste a job's JSON (or choose a .json file) and open it in the builder as a new,
 * unsaved job. Nothing is created until the user saves it there. */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import TextArea from '@splunk/react-ui/TextArea';
import { pageHref } from '../../components/PageShell';
import { parseJobSource, stashImportedJob } from '../builder/sourceLogic';

export interface ImportJobDialogProps {
    onClose: () => void;
    /** Opens the builder; the page sets window.location by default. */
    navigate?: (url: string) => void;
    returnFocus: React.MutableRefObject<HTMLElement | null>;
}

const go = (url: string) => {
    window.location.href = url;
};

export default function ImportJobDialog({ onClose, navigate = go, returnFocus }: ImportJobDialogProps) {
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);

    const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files && event.target.files[0];
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            setText(String(reader.result || ''));
            setError(null);
        };
        reader.onerror = () => setError(`The file could not be read: ${file.name}. Choose it again or paste its contents instead.`);
        reader.readAsText(file);
    };

    const open = () => {
        const parsed = parseJobSource(text);
        if (parsed.error) {
            setError(parsed.error);
            return;
        }
        if (!stashImportedJob(parsed.job as Record<string, unknown>)) {
            setError('The job could not be passed to the builder because the browser blocks session storage. Allow site data for this page and try again.');
            return;
        }
        navigate(pageHref('builder', { import: '1' }));
    };

    return (
        <Modal open onRequestClose={onClose} returnFocus={returnFocus} style={{ width: '640px' }}>
            <Modal.Header title="Import a job" />
            <Modal.Body>
                {error && (
                    <Message type="error" appearance="default">
                        {error}
                    </Message>
                )}
                <ControlGroup label="Paste the job's JSON" labelFor="import-job-text" labelPosition="top">
                    <TextArea
                        inputId="import-job-text"
                        value={text}
                        rowsMin={10}
                        rowsMax={20}
                        spellCheck={false}
                        onChange={(_e: unknown, { value }: { value: string }) => {
                            setText(value);
                            setError(null);
                        }}
                    />
                </ControlGroup>
                <label htmlFor="import-job-file" style={{ display: 'block', paddingBottom: '4px' }}>
                    Or choose a .json file
                </label>
                <input id="import-job-file" type="file" accept=".json,application/json" onChange={onFile} />
            </Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Cancel" onClick={onClose} />
                <Button appearance="primary" label="Open in builder" onClick={open} />
            </Modal.Footer>
        </Modal>
    );
}
