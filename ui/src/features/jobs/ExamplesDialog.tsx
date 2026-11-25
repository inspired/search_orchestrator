/* Browse examples: the example jobs shipped with the app on one page, from Simple to Advanced,
 * each as a card with a picture of its flow and the builder view it opens in. Open one in the
 * builder, in its view, as a new, unsaved job (like Import jobs), add
 * one as a job, or add every missing one; all are added turned off. An example that starts or
 * waits for other examples brings those along (added first), so its Start job actions and After
 * another job triggers point at jobs that exist. */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { JobDefinition, SaveResponse } from '../../api/types';
import { pageHref } from '../../components/PageShell';
import { joinNames } from '../../format';
import { turnedOffIn } from '../builder/nodeCatalog';
import { stashImportedJob } from '../builder/sourceLogic';
import ExampleDiagram from './ExampleDiagram';
import type { BuilderView } from '../simple/useBuilderView';
import { AddExamplesResult, EXAMPLE_JOBS, ExampleJob, VIEWS, addExamples, examplesNeeded } from './examples';

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
    /** Called after examples were saved. */
    onAdded?: () => void;
    /** Building blocks an admin turned off: examples that use one can't be added. */
    turnedOff?: string[];
}

const go = (url: string) => {
    window.location.href = url;
};

const list = (examples: ExampleJob[]) => examples.map((e) => e.title).join(', ');

export default function ExamplesDialog({ onClose, returnFocus, navigate = go, canAdd, existingIds, createJob, onAdded, turnedOff = [] }: ExamplesDialogProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [error, setError] = useState<string | null>(null);
    const [adding, setAdding] = useState<string | null>(null);
    const [result, setResult] = useState<AddExamplesResult | null>(null);
    const [added, setAdded] = useState<string[]>([]);
    const exists = (id: string) => existingIds.includes(id) || added.includes(id);
    /** Turned-off blocks an example (or an example it brings along) uses. */
    const blockedBy = (example: ExampleJob): string[] =>
        [example, ...examplesNeeded(example)].flatMap((e) => turnedOffIn(e.job, turnedOff)).filter((l, i, all) => all.indexOf(l) === i);
    const addable = EXAMPLE_JOBS.filter((e) => !blockedBy(e).length);

    const run = async (key: string, which?: ExampleJob[]) => {
        setError(null);
        setResult(null);
        setAdding(key);
        try {
            const out = await addExamples([...existingIds, ...added], createJob, which);
            setResult(out);
            setAdded((a) => [...a, ...out.added.map((e) => e.job.id)]);
            if (out.added.length && onAdded) {
                onAdded();
            }
            return out;
        } finally {
            setAdding(null);
        }
    };

    const openExample = async (example: ExampleJob) => {
        // The jobs it starts or waits for are added first, so its links don't point at nothing.
        const missing = examplesNeeded(example).filter((e) => !exists(e.job.id));
        if (missing.length && canAdd) {
            const out = await run(`open:${example.job.id}`, missing);
            if (out.failed.length) {
                return;
            }
        }
        if (!stashImportedJob(example.job as unknown as Record<string, unknown>)) {
            setError('The example could not be passed to the builder because the browser blocks session storage. Allow site data for this page and try again.');
            return;
        }
        navigate(pageHref('builder', { import: '1', view: example.view }));
    };

    const shown = EXAMPLE_JOBS;
    const viewLabel = (v: BuilderView) => (VIEWS.find((x) => x.id === v) || VIEWS[0]).label;
    const muted = { color: theme.contentColorMuted, margin: '2px 0', fontSize: '12px' };

    return (
        <Modal open onRequestClose={onClose} returnFocus={returnFocus} style={{ width: '1040px', maxWidth: '96vw' }}>
            <Modal.Header title="Example jobs" />
            <Modal.Body>
                <p style={{ marginTop: 0 }}>
                    {`${EXAMPLE_JOBS.length} jobs that use only data every Splunk has. Open one to look at it in the builder, or add it as a job. Examples are added turned off, so nothing runs until you turn one on. Email actions go to you@example.com until you change them.`}
                </p>
                {error && (
                    <Message type="error" appearance="default">
                        {error}
                    </Message>
                )}
                {result && (result.added.length > 0 || !result.failed.length) && (
                    <Message type="success" appearance="default">
                        {result.added.length
                            ? `Added ${result.added.length} example${result.added.length === 1 ? '' : 's'}: ${list(result.added)}. They're turned off; turn one on from its Settings when you're ready.`
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
                <ul aria-label="Examples" style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
                    {shown.map((example) => {
                        const needs = examplesNeeded(example);
                        const isThere = exists(example.job.id);
                        const blocked = blockedBy(example);
                        return (
                            <li key={example.job.id} data-testid={`example-${example.job.id}`} style={{ border: `1px solid ${theme.borderColor}`, borderRadius: '4px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <ExampleDiagram job={example.job} title={example.title} height={150} />
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                                    <strong>{example.title}</strong>
                                    <span style={{ fontSize: '12px', color: theme.contentColorMuted }}>{`Opens in ${viewLabel(example.view)}`}</span>
                                </div>
                                <p style={{ margin: 0 }}>{example.summary}</p>
                                <p style={muted}>{`Shows: ${example.features.join(', ')}`}</p>
                                {blocked.length > 0 && (
                                    <p style={muted} data-testid="example-blocked">{`Uses ${joinNames(blocked)}, which an admin turned off in Settings > Building blocks, so it can't be added.`}</p>
                                )}
                                {needs.length > 0 && <p style={muted}>{`Uses ${joinNames(needs.map((n) => n.title))}, ${canAdd ? 'added with it' : 'which must be jobs too'}.`}</p>}
                                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', flexWrap: 'wrap' }}>
                                    <Button appearance="secondary" label="Open in builder" aria-label={`Open ${example.title} in builder`} disabled={Boolean(adding)} onClick={() => openExample(example)} />
                                    {canAdd && (
                                        <Button
                                            appearance="secondary"
                                            label={isThere ? 'Added' : adding === `add:${example.job.id}` ? 'Adding…' : 'Add as a job'}
                                            aria-label={`Add ${example.title} as a job`}
                                            disabled={isThere || blocked.length > 0 || Boolean(adding)}
                                            onClick={() => run(`add:${example.job.id}`, [example])}
                                        />
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Close" onClick={onClose} />
                {canAdd && <Button appearance="primary" label={adding === 'all' ? 'Adding examples…' : 'Add all examples'} disabled={Boolean(adding)} onClick={() => run('all', turnedOff.length ? addable : undefined)} />}
            </Modal.Footer>
        </Modal>
    );
}
