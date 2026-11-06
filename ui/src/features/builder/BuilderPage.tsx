/* The job builder: a graph canvas of steps with a side panel for the selected step or
 * dependency, job-level tabs, undo/redo, and Validate/Save against the server. Save checks
 * first, and warns before an admin takes over someone else's job. */
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import Text from '@splunk/react-ui/Text';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import * as client from '../../api/client';
import type { Destination, Issue, Job, JobDefinition, Me, RunFilters, RunSummary, SaveResponse, ValidateResponse } from '../../api/types';
import PageShell, { pageHref } from '../../components/PageShell';
import Canvas, { Selection } from './Canvas';
import EdgePanel from './EdgePanel';
import { findIssues, issuesByStep } from './graphLogic';
import { stepLabel } from './GraphView';
import JobTabs from './JobTabs';
import PreviewBar from './PreviewBar';
import type { PreviewContext } from './previewLogic';
import usePreviews, { PreviewApi, previewNote } from './usePreviews';
import { blankJob, initialState, nextStepId, reducer } from './reducer';
import StepPanel, { IssueList } from './StepPanel';

export interface BuilderApi extends PreviewApi {
    getJob: (jobId: string) => Promise<Job>;
    validateJob: (job: JobDefinition) => Promise<ValidateResponse>;
    createJob: (job: JobDefinition) => Promise<SaveResponse>;
    updateJob: (jobId: string, job: JobDefinition) => Promise<SaveResponse>;
    listDestinations: () => Promise<Destination[]>;
    listJobs: () => Promise<Job[]>;
    me: () => Promise<Me>;
    previewDefaults: (job: JobDefinition) => Promise<{ scheduled_time: number }>;
    listRuns: (filters: RunFilters) => Promise<RunSummary[]>;
}

const defaultApi: BuilderApi = {
    getJob: client.getJob,
    validateJob: client.validateJob,
    createJob: client.createJob,
    updateJob: client.updateJob,
    listDestinations: client.listDestinations,
    listJobs: client.listJobs,
    me: client.me,
    previewDefaults: client.previewDefaults,
    listRuns: client.listRuns,
    startPreview: client.startPreview,
    previewStatus: client.previewStatus,
    previewResults: client.previewResults,
    cancelPreview: client.cancelPreview,
};

export interface BuilderPageProps {
    /** From ?job_id=; none means a new job. */
    jobId?: string | null;
    api?: BuilderApi;
}

type Notice = { type: 'success' | 'error' | 'info'; text: string } | null;

const errorsIn = (issues: Issue[]) => issues.filter((i) => i.level === 'error');
const sameIssue = (a: Issue, b: Issue) => a.code === b.code && (a.step || null) === (b.step || null);

export default function BuilderPage({ jobId: initialId = null, api = defaultApi }: BuilderPageProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [jobId, setJobId] = useState<string | null>(initialId);
    const [state, dispatch] = useReducer(reducer, blankJob(), initialState);
    const [loading, setLoading] = useState(Boolean(initialId));
    const [loadError, setLoadError] = useState<string | null>(null);
    const [meta, setMeta] = useState<{ owner: string | null; canEdit: boolean }>({ owner: null, canEdit: true });
    const [me, setMe] = useState<Me | null>(null);
    const [destinations, setDestinations] = useState<Destination[]>([]);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [selected, setSelected] = useState<Selection>(null);
    const [serverIssues, setServerIssues] = useState<Issue[]>([]);
    const [checkedJob, setCheckedJob] = useState<JobDefinition | null>(null);
    const [notice, setNotice] = useState<Notice>(null);
    const [busy, setBusy] = useState(false);
    const [ownerConfirm, setOwnerConfirm] = useState<{ newOwner: string } | null>(null);
    const [removing, setRemovingState] = useState<string | null>(null);
    const [scheduledTime, setScheduledTime] = useState(() => Math.floor(Date.now() / 1000));
    const timeTouched = useRef(false);
    const [paramValues, setParamValues] = useState<Record<string, string>>({});
    const [source, setSource] = useState('live');
    const [runs, setRuns] = useState<RunSummary[]>([]);
    const returnFocus = useRef<HTMLElement | null>(null);
    const rememberFocus = () => {
        returnFocus.current = document.activeElement as HTMLElement | null;
    };
    const setRemoving = (id: string | null) => {
        if (id) {
            rememberFocus();
        }
        setRemovingState(id);
    };

    useEffect(() => {
        let live = true;
        api.me()
            .then((m) => live && setMe(m))
            .catch(() => undefined);
        api.listDestinations()
            .then((d) => live && setDestinations(d))
            .catch(() => undefined);
        api.listJobs()
            .then((j) => live && setJobs(j))
            .catch(() => undefined);
        if (initialId) {
            api.listRuns({ job_id: initialId, limit: 20 })
                .then((r) => live && setRuns(r.filter((run) => run.job_id === initialId)))
                .catch(() => undefined);
            api.getJob(initialId)
                .then((job) => {
                    if (!live) {
                        return;
                    }
                    setMeta({ owner: job.owner, canEdit: job.permissions ? job.permissions.can_edit : true });
                    dispatch({ type: 'load', job: client.toDefinition(job) });
                    setLoading(false);
                })
                .catch((err: Error) => {
                    if (live) {
                        setLoadError(err.message);
                        setLoading(false);
                    }
                });
        }
        return () => {
            live = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const { job } = state;

    // "As if scheduled at" defaults once, when the job is ready, to its latest cron slot.
    const defaultsAsked = useRef(false);
    useEffect(() => {
        if (loading || loadError || defaultsAsked.current) {
            return;
        }
        defaultsAsked.current = true;
        api.previewDefaults({ ...job, id: jobId || undefined })
            .then((d) => {
                if (!timeTouched.current) {
                    setScheduledTime(d.scheduled_time);
                }
            })
            .catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, loadError]);
    const previewJob = useMemo(() => ({ ...job, id: jobId || undefined }), [job, jobId]);
    const previewCtx = useMemo<PreviewContext>(() => {
        const params: Record<string, string> = {};
        Object.keys(paramValues).forEach((k) => {
            if (paramValues[k] !== '') {
                params[k] = paramValues[k];
            }
        });
        return { scheduledTime, params, source };
    }, [scheduledTime, paramValues, source]);
    const previews = usePreviews(previewJob, previewCtx, api);
    const notes = useMemo(() => {
        const out: Record<string, ReturnType<typeof previewNote>> = {};
        Object.keys(previews.previews).forEach((id) => {
            out[id] = previewNote(previews.previews[id]);
        });
        return out;
    }, [previews.previews]);
    // Server warnings stay until the next check; server errors only while the job is the
    // one that was checked (the client check covers what an edit fixes).
    const issues = useMemo(() => {
        const server = checkedJob === job ? serverIssues : serverIssues.filter((i) => i.level === 'warning');
        const local = findIssues(job).filter((i) => !server.some((s) => sameIssue(s, i)));
        return [...server, ...local];
    }, [job, serverIssues, checkedJob]);
    const byStep = issuesByStep(issues);
    const jobLevel = byStep[''] || [];

    const owner = meta.owner || (me ? me.user : '');
    const selectedStep = selected && selected.kind === 'step' && job.steps.some((s) => s.id === selected.id) ? selected.id : null;
    const selectedEdge =
        selected && selected.kind === 'edge' && (job.edges || []).some((e) => e.from === selected.from && e.to === selected.to)
            ? selected
            : null;

    const runCheck = async (): Promise<ValidateResponse | null> => {
        try {
            const res = await api.validateJob({ ...job, id: jobId || undefined });
            setServerIssues(res.issues || []);
            setCheckedJob(job);
            return res;
        } catch (err) {
            const e = err as client.ApiError;
            setServerIssues(e.issues || []);
            setCheckedJob(job);
            setNotice({ type: 'error', text: `The job could not be checked: ${e.message}` });
            return null;
        }
    };

    const onValidate = async () => {
        setBusy(true);
        setNotice(null);
        const res = await runCheck();
        setBusy(false);
        if (res) {
            const errors = errorsIn(res.issues || []).length;
            const warnings = (res.issues || []).length - errors;
            setNotice(
                errors
                    ? { type: 'error', text: `${errors} error${errors === 1 ? '' : 's'} to fix before saving.` }
                    : { type: 'success', text: warnings ? `No errors. ${warnings} warning${warnings === 1 ? '' : 's'}.` : 'No problems found.' }
            );
        }
    };

    const doSave = async () => {
        setOwnerConfirm(null);
        setBusy(true);
        setNotice(null);
        try {
            const res = jobId ? await api.updateJob(jobId, job) : await api.createJob(job);
            setServerIssues(res.issues || []);
            setCheckedJob(job);
            setMeta({ owner: res.job.owner, canEdit: true });
            if (!jobId) {
                setJobId(res.job.id);
                try {
                    window.history.replaceState(null, '', pageHref('builder', { job_id: res.job.id }));
                } catch (err) {
                    // the page still works; a reload would open a new job
                }
            }
            setNotice({ type: 'success', text: 'Saved.' });
        } catch (err) {
            const e = err as client.ApiError;
            setServerIssues(e.issues || []);
            setCheckedJob(job);
            setNotice({ type: 'error', text: `The job was not saved: ${e.message}` });
        } finally {
            setBusy(false);
        }
    };

    const onSave = async () => {
        if (errorsIn(findIssues(job)).length) {
            setNotice({ type: 'error', text: 'Fix the errors shown on the steps before saving.' });
            return;
        }
        setBusy(true);
        setNotice(null);
        const res = await runCheck();
        setBusy(false);
        if (!res) {
            return;
        }
        if (errorsIn(res.issues || []).length) {
            setNotice({ type: 'error', text: 'The job has errors and was not saved.' });
            return;
        }
        if (res.owner_will_change) {
            rememberFocus();
            setOwnerConfirm({ newOwner: res.owner });
            return;
        }
        await doSave();
    };

    const canvasArea = useRef<HTMLDivElement | null>(null);

    // After a confirmed delete, focus moves to the next step, else the previous one, else
    // the canvas. Applied once the modal has closed and handed focus back.
    const [focusNext, setFocusNext] = useState<{ id: string | null } | null>(null);
    useEffect(() => {
        if (!focusNext || removing) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            const area = canvasArea.current;
            if (area) {
                const nodes = Array.from(area.querySelectorAll<HTMLElement>('[data-node-id]'));
                const node = nodes.find((n) => n.getAttribute('data-node-id') === focusNext.id);
                const target = node || area.querySelector<HTMLElement>('[data-canvas]');
                if (target) {
                    target.focus();
                }
            }
            setFocusNext(null);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [focusNext, removing]);

    const confirmRemove = () => {
        if (removing) {
            const ids = job.steps.map((s) => s.id);
            const at = ids.indexOf(removing);
            const next = ids[at + 1] !== undefined ? ids[at + 1] : ids[at - 1];
            returnFocus.current = null;
            setFocusNext({ id: next === undefined ? null : next });
            dispatch({ type: 'removeStep', id: removing });
            if (selected && selected.kind === 'step' && selected.id === removing) {
                setSelected(null);
            }
        }
        setRemoving(null);
    };

    const removingStep = removing ? job.steps.find((s) => s.id === removing) : undefined;

    const sidePanel = () => {
        if (selectedStep) {
            return (
                <StepPanel
                    key={selectedStep}
                    job={job}
                    stepId={selectedStep}
                    issues={byStep[selectedStep] || []}
                    dispatch={dispatch}
                    destinations={destinations}
                    onRename={(_from, to) => setSelected({ kind: 'step', id: to })}
                    onRequestRemove={setRemoving}
                    preview={previews.previews[selectedStep]}
                    onPreview={
                        meta.canEdit
                            ? (id, opts) => {
                                  previews.preview(id, opts);
                              }
                            : undefined
                    }
                    onCancelPreview={previews.cancel}
                />
            );
        }
        if (selectedEdge) {
            return (
                <EdgePanel
                    job={job}
                    from={selectedEdge.from}
                    to={selectedEdge.to}
                    issues={(byStep[selectedEdge.to] || []).filter((i) => i.code === 'bad_expression' || i.code === 'unknown_token')}
                    dispatch={dispatch}
                    onRemoved={() => setSelected(null)}
                />
            );
        }
        return (
            <p style={{ color: theme.contentColorMuted }}>
                Select a step to edit it, or add one. Drag from the circle under a step onto another step to make it depend on that step, or use
                the step&apos;s &quot;Depends on&quot; field.
            </p>
        );
    };

    const stepsTab = (
        <>
        <PreviewBar
            scheduledTime={scheduledTime}
            onScheduledTime={(t) => {
                timeTouched.current = true;
                setScheduledTime(t);
            }}
            params={job.params || []}
            values={paramValues}
            onValues={setParamValues}
            source={source}
            onSource={setSource}
            runs={runs}
        />
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <Button
                        appearance="secondary"
                        label="Add step"
                        onClick={() => {
                            const id = nextStepId(job.steps);
                            dispatch({ type: 'addStep', step: { id } });
                            setSelected({ kind: 'step', id });
                        }}
                    />
                    <Button appearance="secondary" label="Auto layout" onClick={() => dispatch({ type: 'layout' })} />
                </div>
                <div ref={canvasArea}>
                <Canvas
                    steps={job.steps}
                    edges={job.edges || []}
                    positions={state.positions}
                    selected={selected}
                    issues={issues}
                    onSelect={setSelected}
                    onMove={(id, x, y) => dispatch({ type: 'moveStep', id, x, y })}
                    onConnect={(from, to) => dispatch({ type: 'connect', from, to })}
                    onRequestRemove={setRemoving}
                    notes={notes}
                />
                </div>
            </div>
            <div
                style={{
                    width: '360px',
                    flex: 'none',
                    borderLeft: `1px solid ${theme.borderColor}`,
                    paddingLeft: '16px',
                    maxHeight: '80vh',
                    overflowY: 'auto',
                }}
            >
                {sidePanel()}
            </div>
        </div>
        </>
    );

    const actions = (
        <>
            <Button appearance="subtle" label="Undo" disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })} />
            <Button appearance="subtle" label="Redo" disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })} />
            <Button appearance="secondary" label="Validate" disabled={busy || loading} onClick={onValidate} />
            <Button appearance="primary" label="Save" disabled={busy || loading || !meta.canEdit} onClick={onSave} />
        </>
    );

    return (
        <PageShell title={job.name || (jobId ? jobId : 'New job')} actions={actions}>
            {loadError && (
                <Message type="error" appearance="default">
                    {`The job could not be loaded: ${loadError}`}
                </Message>
            )}
            {!meta.canEdit && (
                <Message type="info" appearance="default">
                    You can view this job but not save changes to it.
                </Message>
            )}
            {notice && (
                <Message type={notice.type} appearance="default">
                    {notice.text}
                </Message>
            )}
            <IssueList issues={jobLevel} />
            {loading ? (
                <WaitSpinner size="medium" />
            ) : (
                <>
                    <ControlGroup label="Job name" labelFor="job-name" labelPosition="top">
                        <Text
                            inputId="job-name"
                            value={job.name}
                            onChange={(_e: unknown, { value }: { value: string }) => dispatch({ type: 'setJobField', field: 'name', value })}
                        />
                    </ControlGroup>
                    <JobTabs
                        job={job}
                        dispatch={dispatch}
                        owner={owner}
                        roles={me ? me.roles : []}
                        jobs={jobs}
                        destinations={destinations}
                        steps={stepsTab}
                    />
                </>
            )}
            {ownerConfirm && (
                <Modal open onRequestClose={() => setOwnerConfirm(null)} returnFocus={returnFocus} style={{ width: '520px' }}>
                    <Modal.Header title="Take over this job?" />
                    <Modal.Body>
                        <Message type="warning" appearance="default">
                            {`This job belongs to ${meta.owner}. Saving it makes ${ownerConfirm.newOwner} the owner, and its searches will run as ${ownerConfirm.newOwner} from now on.`}
                        </Message>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button appearance="secondary" label="Cancel" onClick={() => setOwnerConfirm(null)} />
                        <Button appearance="primary" label="Save and take ownership" onClick={doSave} />
                    </Modal.Footer>
                </Modal>
            )}
            {removing && (
                <Modal open onRequestClose={() => setRemoving(null)} returnFocus={returnFocus} style={{ width: '480px' }}>
                    <Modal.Header title={`Remove ${removingStep ? stepLabel(removingStep) : removing}?`} />
                    <Modal.Body>
                        <p>Its dependencies are removed too. Undo brings it back.</p>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button appearance="secondary" label="Cancel" onClick={() => setRemoving(null)} />
                        <Button appearance="destructive" label="Remove step" onClick={confirmRemove} />
                    </Modal.Footer>
                </Modal>
            )}
        </PageShell>
    );
}
