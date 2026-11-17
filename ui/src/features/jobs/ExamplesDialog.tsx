/* Browse examples: the example jobs shipped with the app. Open one in the builder as a new,
 * unsaved job (like Import job), or add every missing one as a job, turned off. */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { JobDefinition, SaveResponse } from '../../api/types';
import { pageHref } from '../../components/PageShell';
import { stashImportedJob } from '../builder/sourceLogic';
import { AddExamplesResult, EXAMPLE_JOBS, ExampleJob, addExamples } from './examples';

export interface ExamplesDialogProps {
    onClose: () => void;
    returnFocus: React.MutableRefObject<HTMLElement | null>;
    /** Opens the builder; the page sets window.location by default. */
    navigate?: (url: string) => void;
    /** Builders and admins may add the examples as jobs. */
    canAdd: boolean;
    /** Ids of the jobs that exist now: their examples are skipped. */
    existingIds: string[];
    createJob: (job: JobDefinition) => Promise<SaveResponse>;
    /** Called after Add all examples saved at least one job. */
    onAdded?: () => void;
}

const go = (url: string) => {
    window.location.href = url;
};

const list = (examples: ExampleJob[]) => examples.map((e) => e.title).join(', ');

export default function ExamplesDialog({ onClose, returnFocus, navigate = go, canAdd, existingIds, createJob, onAdded }: ExamplesDialogProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [error, setError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [result, setResult] = useState<AddExamplesResult | null>(null);

    const openExample = (example: ExampleJob) => {
        if (!stashImportedJob(example.job as unknown as Record<string, unknown>)) {
            setError('The example could not be passed to the builder because the browser blocks session storage. Allow site data for this page and try again.');
            return;
        }
        navigate(pageHref('builder', { import: '1' }));
    };

    const addAll = async () => {
        setError(null);
        setResult(null);
        setAdding(true);
        try {
            const out = await addExamples(existingIds, createJob);
            setResult(out);
            if (out.added.length && onAdded) {
                onAdded();
            }
        } finally {
            setAdding(false);
        }
    };

    const muted = { color: theme.contentColorMuted, margin: '2px 0' };

    return (
        <Modal open onRequestClose={onClose} returnFocus={returnFocus} style={{ width: '760px', maxWidth: '95vw' }}>
            <Modal.Header title="Example jobs" />
            <Modal.Body>
                <p style={{ marginTop: 0 }}>
                    Ten jobs that use only data every Splunk has, from simple to advanced. Open one to look at it in the builder, or add them all as jobs. Examples are turned off and
                    scheduled, so nothing runs until you turn one on. Email actions go to you@example.com until you change them.
                </p>
                {error && (
                    <Message type="error" appearance="default">
                        {error}
                    </Message>
                )}
                {result && (result.added.length > 0 || !result.failed.length) && (
                    <Message type="success" appearance="default">
                        {result.added.length
                            ? `Added ${result.added.length} example${result.added.length === 1 ? '' : 's'}. They're turned off; turn one on from its Settings when you're ready.`
                            : 'Every example is already a job, so nothing was added.'}
                    </Message>
                )}
                {result && result.skipped.length > 0 && (result.added.length > 0 || result.failed.length > 0) && <p>{`Already there, so skipped: ${list(result.skipped)}.`}</p>}
                {result && result.failed.length > 0 && (
                    <Message type="error" appearance="default">
                        <div>
                            {`${result.failed.length} example${result.failed.length === 1 ? '' : 's'} could not be added:`}
                            <ul style={{ margin: '4px 0 0', paddingLeft: '20px' }}>
                                {result.failed.map((f) => (
                                    <li key={f.example.job.id}>{`${f.example.title}: ${f.message}`}</li>
                                ))}
                            </ul>
                        </div>
                    </Message>
                )}
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Examples">
                    {EXAMPLE_JOBS.map((example, i) => (
                        <li
                            key={example.job.id}
                            style={{
                                display: 'flex',
                                gap: '16px',
                                alignItems: 'center',
                                padding: '10px 0',
                                borderTop: i ? `1px solid ${theme.borderColorWeak || theme.borderColor}` : undefined,
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                                    <strong>{example.title}</strong>
                                    <span
                                        style={{
                                            fontSize: '12px',
                                            padding: '0 6px',
                                            borderRadius: '8px',
                                            border: `1px solid ${theme.borderColor}`,
                                            color: theme.contentColorMuted,
                                        }}
                                    >
                                        {example.level}
                                    </span>
                                </div>
                                <p style={{ margin: '2px 0' }}>{example.summary}</p>
                                <p style={{ ...muted, fontSize: '12px' }}>{`Shows: ${example.features.join(', ')}`}</p>
                            </div>
                            <Button appearance="secondary" label="Open in builder" aria-label={`Open ${example.title} in builder`} onClick={() => openExample(example)} />
                        </li>
                    ))}
                </ul>
            </Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Close" onClick={onClose} />
                {canAdd && <Button appearance="primary" label={adding ? 'Adding examples…' : 'Add all examples'} disabled={adding} onClick={addAll} />}
            </Modal.Footer>
        </Modal>
    );
}
