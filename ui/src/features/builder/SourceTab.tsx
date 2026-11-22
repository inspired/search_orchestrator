/* The Source tab: the job as JSON text to copy, download, edit and apply back. Apply replaces
 * the whole job as one undo step; the id of the job is always kept. */
import React, { useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Message from '@splunk/react-ui/Message';
import type { JobDefinition } from '../../api/types';
import type { BuilderAction } from './reducer';
import JsonEditor from './JsonEditor';
import { jobToSource, parseJobSource } from './sourceLogic';

type Note = { type: 'error' | 'info' | 'success'; text: string } | null;

export interface SourceTabProps {
    job: JobDefinition;
    dispatch: (action: BuilderAction) => void;
    canEdit: boolean;
}

export default function SourceTab({ job, dispatch, canEdit }: SourceTabProps) {
    const current = jobToSource(job);
    const [text, setText] = useState(current);
    // The job text the editor last showed; edits are unapplied while `text` differs from it.
    const [base, setBase] = useState(current);
    const [note, setNote] = useState<Note>(null);
    const area = useRef<HTMLTextAreaElement | null>(null);

    // No unapplied edits: follow the job (an undo, a change on the canvas).
    if (current !== base && text === base) {
        setBase(current);
        setText(current);
    }
    const stale = current !== base;
    const changed = text !== current;

    const showNote = (type: 'error' | 'info' | 'success', message: string) => setNote({ type, text: message });

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            showNote('success', 'Copied to the clipboard.');
        } catch (err) {
            if (area.current) {
                area.current.focus();
                area.current.select();
            }
            showNote('info', 'Press Ctrl+C to copy');
        }
    };

    const download = () => {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${job.id || 'new-job'}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const apply = () => {
        const parsed = parseJobSource(text);
        if (parsed.error) {
            showNote('error', parsed.error);
            return;
        }
        const next = { ...parsed.job } as Record<string, unknown>;
        const pastedId = next.id;
        if (job.id) {
            next.id = job.id;
        } else {
            delete next.id;
        }
        dispatch({ type: 'applyTemplate', job: next as unknown as JobDefinition });
        const shown = jobToSource(next as unknown as JobDefinition);
        setBase(shown);
        setText(shown);
        if (pastedId !== undefined && pastedId !== job.id) {
            showNote(
                'info',
                job.id
                    ? `The id in the source was ignored; this job keeps the id ${job.id}.`
                    : 'The id in the source was ignored; this job gets its id when it is saved.'
            );
        } else {
            showNote('success', 'Applied. Undo restores the previous job.');
        }
    };

    const discard = () => {
        setBase(current);
        setText(current);
        setNote(null);
    };

    return (
        <div>
            {note && (
                <Message type={note.type} appearance="default">
                    {note.text}
                </Message>
            )}
            {canEdit && changed && stale && (
                <Message type="warning" appearance="default">
                    The job changed since you started editing. Discard changes to see the latest.
                </Message>
            )}
            <label htmlFor="job-source" style={{ display: 'block', paddingBottom: '4px' }}>
                {canEdit ? 'Job source (JSON)' : 'Job source (JSON, read only)'}
            </label>
            <JsonEditor
                inputId="job-source"
                ref={area}
                value={text}
                readOnly={!canEdit}
                rowsMin={20}
                rowsMax={40}
                onChange={(v) => canEdit && setText(v)}
            />
            <div style={{ display: 'flex', gap: '8px', paddingTop: '12px' }}>
                <Button appearance="secondary" label="Copy" onClick={copy} />
                <Button appearance="secondary" label="Download" onClick={download} />
                {canEdit && <Button appearance="primary" label="Apply changes" disabled={!changed || stale} onClick={apply} />}
                {canEdit && <Button appearance="subtle" label="Discard changes" disabled={!changed} onClick={discard} />}
            </div>
        </div>
    );
}
