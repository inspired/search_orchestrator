/* Import jobs: paste or choose JSON. One job opens in the builder as a new, unsaved job (nothing
 * is created until the user saves it there). An export file (or a list of jobs) is saved as
 * jobs right away, keeping their ids; ids already taken are skipped, never replaced, and the
 * new jobs are turned off unless the user unticks that. */
import React, { useMemo, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import Switch from '@splunk/react-ui/Switch';
import TextArea from '@splunk/react-ui/TextArea';
import type { JobDefinition, SaveResponse } from '../../api/types';
import { pageHref } from '../../components/PageShell';
import { joinNames } from '../../format';
import { stashImportedJob } from '../builder/sourceLogic';
import { importJobs, parseJobsFile } from './jobsFile';
import type { ImportResult } from './jobsFile';

export interface ImportJobDialogProps {
    onClose: () => void;
    /** Opens the builder; the page sets window.location by default. */
    navigate?: (url: string) => void;
    returnFocus: React.MutableRefObject<HTMLElement | null>;
    /** Ids of the jobs there are, so an import skips them. */
    existingIds?: string[];
    /** Saves one job; without it, only a single job can be imported (into the builder). */
    createJob?: (job: JobDefinition) => Promise<SaveResponse>;
    /** Called after jobs were saved, to reload the list. */
    onImported?: () => void;
}

const go = (url: string) => {
    window.location.href = url;
};

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export default function ImportJobDialog({ onClose, navigate = go, returnFocus, existingIds = [], createJob, onImported }: ImportJobDialogProps) {
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [turnOff, setTurnOff] = useState(true);
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<ImportResult | null>(null);
    const parsed = useMemo(() => (text.trim() ? parseJobsFile(text) : null), [text]);
    const many = Boolean(parsed && parsed.many);
    const taken = new Set(existingIds);
    const fresh = many ? (parsed?.jobs || []).filter((j) => !(typeof j.id === 'string' && taken.has(j.id))) : [];
    const skipped = many ? (parsed?.jobs || []).length - fresh.length : 0;

    const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files && event.target.files[0];
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            setText(String(reader.result || ''));
            setError(null);
            setResult(null);
        };
        reader.onerror = () => setError(`The file could not be read: ${file.name}. Choose it again or paste its contents instead.`);
        reader.readAsText(file);
    };

    const openOne = () => {
        if (!parsed || !parsed.jobs) {
            setError(parsed && parsed.error ? parsed.error : 'Paste a job, or choose a .json file');
            return;
        }
        if (!stashImportedJob(parsed.jobs[0])) {
            setError('The job could not be passed to the builder because the browser blocks session storage. Allow site data for this page and try again.');
            return;
        }
        navigate(pageHref('builder', { import: '1' }));
    };

    const importMany = async () => {
        if (!parsed || !parsed.jobs || !createJob) {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const out = await importJobs(parsed.jobs, existingIds, createJob, turnOff);
            setResult(out);
            if (out.added.length && onImported) {
                onImported();
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open onRequestClose={onClose} returnFocus={returnFocus} style={{ width: '640px' }}>
            <Modal.Header title="Import jobs" />
            <Modal.Body>
                {error && (
                    <Message type="error" appearance="default">
                        {error}
                    </Message>
                )}
                {result ? (
                    <div data-testid="import-result">
                        {result.added.length > 0 && (
                            <Message type="success" appearance="default">
                                {`Imported ${plural(result.added.length, 'job')}: ${joinNames(result.added)}.${turnOff ? ' They are turned off; turn each on in the Jobs list when it is ready.' : ''}`}
                            </Message>
                        )}
                        {result.skipped.length > 0 && (
                            <Message type="info" appearance="default">
                                {`Skipped ${plural(result.skipped.length, 'job')} whose id is already taken: ${joinNames(result.skipped)}. Nothing was replaced.`}
                            </Message>
                        )}
                        {result.failed.map((f) => (
                            <Message key={f.name} type="error" appearance="default">
                                {`${f.name} was not imported: ${f.message}`}
                            </Message>
                        ))}
                    </div>
                ) : (
                    <>
                        <ControlGroup label="Paste one job, or a jobs export file" labelFor="import-job-text" labelPosition="top">
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
                        {many && parsed && parsed.jobs && (
                            <div data-testid="import-summary" style={{ marginTop: '12px' }}>
                                <p style={{ margin: '0 0 6px' }}>
                                    {`${plural(parsed.jobs.length, 'job')} in the file: ${joinNames(parsed.jobs.map((j) => String(j.name)))}.`}
                                    {skipped > 0 && ` ${plural(skipped, 'job')} with an id already taken will be skipped; nothing is replaced.`}
                                </p>
                                <Switch appearance="checkbox" selected={turnOff} onClick={() => setTurnOff(!turnOff)}>
                                    Turn the imported jobs off, so none runs before you check it
                                </Switch>
                                {!createJob && <p>Importing several jobs needs permission to create jobs.</p>}
                            </div>
                        )}
                    </>
                )}
            </Modal.Body>
            <Modal.Footer>
                {result ? (
                    <Button appearance="primary" label="Done" onClick={onClose} />
                ) : (
                    <>
                        <Button appearance="secondary" label="Cancel" onClick={onClose} />
                        {many ? (
                            <Button appearance="primary" label={saving ? 'Importing…' : `Import ${plural(fresh.length, 'job')}`} disabled={saving || !fresh.length || !createJob} onClick={importMany} />
                        ) : (
                            <Button appearance="primary" label="Open in builder" onClick={openOne} />
                        )}
                    </>
                )}
            </Modal.Footer>
        </Modal>
    );
}
