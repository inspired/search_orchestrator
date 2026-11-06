/* Run now: a form built from the job's declared parameters. Values are checked here
 * first, and the server's bad_param errors are shown on the field they name. */
import React, { useEffect, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import Select from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';
import { ApiError, startRun as defaultStartRun, StartRunRequest } from '../../api/client';
import type { Job, ParamDecl } from '../../api/types';

const NUMBER_RE = /^-?(\d+(\.\d*)?|\.\d+)$/;
const PARAM_TOKEN_RE = /run\.param\.([A-Za-z][A-Za-z0-9_]*)/;

export interface RunNowDialogProps {
    job: Job;
    open: boolean;
    onClose: () => void;
    onStarted: (runId: string) => void;
    startRun?: (jobId: string, body: StartRunRequest) => Promise<{ run_id: string }>;
    /** Where focus goes when the dialog closes. */
    returnFocus?: React.ComponentProps<typeof Modal>['returnFocus'];
}

function initialValues(params: ParamDecl[]): Record<string, string> {
    const out: Record<string, string> = {};
    params.forEach((p) => {
        out[p.name] = p.default !== null && p.default !== undefined ? String(p.default) : '';
    });
    return out;
}

/** The first problem with a value, or null. Mirrors tokens.validate_param on the server. */
export function checkParam(decl: ParamDecl, value: string): string | null {
    if (value === '') {
        return decl.default === null || decl.default === undefined ? 'A value is required.' : null;
    }
    const type = decl.type || 'string';
    if (type === 'number' && !NUMBER_RE.test(value)) {
        return 'Enter a number.';
    }
    if (type === 'enum' && !(decl.values || []).includes(value)) {
        return 'Choose one of the allowed values.';
    }
    if (decl.regex) {
        try {
            if (!new RegExp(`^(?:${decl.regex})$`).test(value)) {
                return 'The value does not match the required pattern.';
            }
        } catch (err) {
            return null; // a pattern JavaScript can't read: leave it to the server
        }
    }
    return null;
}

export default function RunNowDialog({
    job,
    open,
    onClose,
    onStarted,
    startRun = defaultStartRun,
    returnFocus = () => undefined,
}: RunNowDialogProps) {
    const params = job.params || [];
    const [values, setValues] = useState<Record<string, string>>(() => initialValues(params));
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [formError, setFormError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (open) {
            setValues(initialValues(job.params || []));
            setErrors({});
            setFormError(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, job.id]);

    const setValue = (name: string, value: string) => {
        setValues((v) => ({ ...v, [name]: value }));
        setErrors((e) => {
            const next = { ...e };
            delete next[name];
            return next;
        });
    };

    const submit = async () => {
        const found: Record<string, string> = {};
        params.forEach((p) => {
            const problem = checkParam(p, values[p.name] || '');
            if (problem) {
                found[p.name] = problem;
            }
        });
        setErrors(found);
        setFormError(null);
        if (Object.keys(found).length) {
            return;
        }
        const sent: Record<string, string> = {};
        params.forEach((p) => {
            sent[p.name] = values[p.name] || '';
        });
        setSubmitting(true);
        try {
            const out = await startRun(job.id, { params: sent });
            onStarted(out.run_id);
        } catch (err) {
            const apiErr = err as ApiError;
            const match = apiErr.code === 'bad_param' ? PARAM_TOKEN_RE.exec(apiErr.message || '') : null;
            if (match && params.some((p) => p.name === match[1])) {
                const reason = apiErr.message.replace(/^parameter run\.param\.[A-Za-z0-9_]+:\s*/, '');
                setErrors({ [match[1]]: reason });
            } else {
                setFormError(apiErr.message || 'The run could not be started.');
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onRequestClose={onClose} returnFocus={returnFocus} style={{ width: '520px' }}>
            <Modal.Header title={`Run now: ${job.name}`}/>
            <Modal.Body>
                {formError && (
                    <Message type="error" appearance="default">
                        {formError}
                    </Message>
                )}
                {params.length === 0 && <p>This job has no parameters.</p>}
                {params.map((p) => {
                    const id = `run-now-param-${p.name}`;
                    const error = errors[p.name];
                    const help = error || p.description;
                    const label = p.label || p.name;
                    return (
                        <ControlGroup
                            key={p.name}
                            label={label}
                            labelFor={id}
                            labelPosition="top"
                            help={help}
                            error={Boolean(error)}
                        >
                            {p.type === 'enum' ? (
                                <Select
                                    inputId={id}
                                    value={values[p.name] || ''}
                                    onChange={(_e: unknown, { value }: { value: unknown }) => setValue(p.name, String(value))}
                                >
                                    {(p.values || []).map((v) => (
                                        <Select.Option key={v} label={v} value={v} />
                                    ))}
                                </Select>
                            ) : (
                                <Text
                                    inputId={id}
                                    value={values[p.name] || ''}
                                    placeholder={p.type === 'time' ? 'e.g. -1d@d' : undefined}
                                    error={Boolean(error)}
                                    onChange={(_e: unknown, { value }: { value: string }) => setValue(p.name, value)}
                                />
                            )}
                        </ControlGroup>
                    );
                })}
            </Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Cancel" onClick={onClose} />
                <Button appearance="primary" label="Start run" disabled={submitting} onClick={submit} />
            </Modal.Footer>
        </Modal>
    );
}
