/* Re-run from a step. If the job changed since the run, the user must pick the latest or
 * the original definition; nothing is preselected. */
import React, { useEffect, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Checkbox from '@splunk/react-ui/Checkbox';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import RadioList from '@splunk/react-ui/RadioList';
import Select from '@splunk/react-ui/Select';
import { ApiError, rerun as defaultRerun } from '../../api/client';
import type { DefinitionChoice, RerunRequest, RunDetail } from '../../api/types';
import ErrorMessage from './ErrorMessage';

export interface RerunDialogProps {
    run: RunDetail;
    open: boolean;
    /** The step the dialog starts on, such as a failed step. */
    initialStep?: string;
    onClose: () => void;
    onStarted: () => void;
    rerun?: (runId: string, body: RerunRequest) => Promise<unknown>;
}

function firstStep(run: RunDetail, initial?: string): string {
    if (initial) {
        return initial;
    }
    const steps = run.definition.steps || [];
    const failed = steps.find((s) => run.steps && run.steps[s.id] && run.steps[s.id].state === 'failed');
    return (failed || steps[0] || { id: '' }).id;
}

export default function RerunDialog({ run, open, initialStep, onClose, onStarted, rerun = defaultRerun }: RerunDialogProps) {
    const [step, setStep] = useState(() => firstStep(run, initialStep));
    const [definition, setDefinition] = useState<'latest' | 'original' | undefined>();
    const [restart, setRestart] = useState(false);
    const [serverChoices, setServerChoices] = useState<DefinitionChoice[] | undefined>();
    const [error, setError] = useState<ApiError | Error | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (open) {
            setStep(firstStep(run, initialStep));
            setDefinition(undefined);
            setRestart(false);
            setServerChoices(undefined);
            setError(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, run.id, initialStep]);

    const latest = (run.rerun_latest || {})[step] || { available: true, reason: null };
    const choices: DefinitionChoice[] =
        serverChoices && serverChoices.length
            ? serverChoices
            : [
                  { definition: 'latest', available: latest.available, reason: latest.reason },
                  { definition: 'original', available: true, reason: null },
              ];
    const mustChoose = run.definition_changed || Boolean(serverChoices);
    const ready = Boolean(step) && (!mustChoose || definition !== undefined);

    const submit = async () => {
        setSubmitting(true);
        setError(null);
        const body: RerunRequest = { step, restart_downstream_jobs: restart };
        if (mustChoose && definition) {
            body.definition = definition;
        }
        try {
            await rerun(run.id, body);
            onStarted();
        } catch (err) {
            const apiErr = err as ApiError;
            if (apiErr.code === 'definition_choice_required' && apiErr.choices) {
                setServerChoices(apiErr.choices);
                setDefinition(undefined);
            }
            setError(apiErr);
        } finally {
            setSubmitting(false);
        }
    };

    const label = (id: string) => {
        const s = (run.definition.steps || []).find((x) => x.id === id);
        return (s && s.name) || id;
    };

    return (
        <Modal open={open} onRequestClose={onClose} returnFocus={() => undefined} style={{ width: '560px' }}>
            <Modal.Header title="Re-run" />
            <Modal.Body>
                {error && <ErrorMessage error={error} />}
                <Message type="warning" appearance="default">
                    Steps that write results, such as to a summary index or a lookup, write again when they re-run.
                    Check for duplicate writes before you continue.
                </Message>
                <ControlGroup label="Start from step" labelFor="rerun-step" labelPosition="top">
                    <Select
                        inputId="rerun-step"
                        value={step}
                        onChange={(_e: unknown, { value }: { value: unknown }) => {
                            setStep(String(value));
                            setDefinition(undefined);
                        }}
                    >
                        {(run.definition.steps || []).map((s) => (
                            <Select.Option key={s.id} label={label(s.id)} value={s.id} />
                        ))}
                    </Select>
                </ControlGroup>
                {mustChoose && (
                    <ControlGroup
                        label="Definition to use"
                        labelPosition="top"
                        help="The job changed after this run started."
                    >
                        <RadioList
                            value={definition}
                            onChange={(_e: unknown, { value }: { value: unknown }) =>
                                setDefinition(value as 'latest' | 'original')
                            }
                            required
                        >
                            {choices.map((c) => (
                                <RadioList.Option
                                    key={c.definition}
                                    value={c.definition}
                                    disabled={!c.available}
                                    description={
                                        !c.available && c.reason
                                            ? `Not available: ${c.reason}.`
                                            : c.definition === 'latest'
                                            ? 'The job as it is saved now.'
                                            : 'The job as it was when this run started.'
                                    }
                                >
                                    {c.definition === 'latest' ? 'Latest definition' : 'Original definition'}
                                </RadioList.Option>
                            ))}
                        </RadioList>
                    </ControlGroup>
                )}
                <Checkbox checked={restart} onChange={(_e: unknown, { checked }: { checked: boolean | 'indeterminate' }) => setRestart(checked === true)} value="restart">
                    Start downstream jobs again
                </Checkbox>
            </Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Cancel" onClick={onClose} />
                <Button appearance="primary" label="Re-run" disabled={!ready || submitting} onClick={submit} />
            </Modal.Footer>
        </Modal>
    );
}
