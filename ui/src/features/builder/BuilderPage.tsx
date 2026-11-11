/* The job builder: a graph canvas of steps with a side panel for the selected step or
 * dependency, job-level tabs, undo/redo, and automatic checking against the server, and Save. Save checks
 * first, and warns before an admin takes over someone else's job. */
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import Text from '@splunk/react-ui/Text';
import Typography from '@splunk/react-ui/Typography';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import * as client from '../../api/client';
import type { AlertAction, Destination, Issue, Job, JobDefinition, Me, RunFilters, RunSummary, SaveResponse, ValidateResponse } from '../../api/types';
import PageShell, { pageHref } from '../../components/PageShell';
import Canvas, { Selection } from './Canvas';
import EdgePanel from './EdgePanel';
import { CLIENT_ISSUE_CODES, findIssues, issuesByStep } from './graphLogic';
import { stepLabel } from './GraphView';
import JobTabs, { TabId } from './JobTabs';
import { readiness } from './readiness';
import IssueSummary from './IssueSummary';
import { tabForIssue } from './issueTabs';
import SetupChecklist from './SetupChecklist';
import PreviewBar from './PreviewBar';
import type { PreviewContext } from './previewLogic';
import useAutoValidate from './useAutoValidate';
import usePreviews, { PreviewApi, previewNote } from './usePreviews';
import { blankJob, initialState, isDirty, nextStepId, reducer } from './reducer';
import StepPanel, { IssueList } from './StepPanel';
import TemplatePicker from './TemplatePicker';
import { JobTemplate, templateByKey } from './templates';

export interface BuilderApi extends PreviewApi {
    getJob: (jobId: string) => Promise<Job>;
    validateJob: (job: JobDefinition) => Promise<ValidateResponse>;
    createJob: (job: JobDefinition) => Promise<SaveResponse>;
    updateJob: (jobId: string, job: JobDefinition) => Promise<SaveResponse>;
    listDestinations: () => Promise<Destination[]>;
    listAlertActions: () => Promise<AlertAction[]>;
    listJobs: () => Promise<Job[]>;
    me: () => Promise<Me>;
    previewDefaults: (job: JobDefinition) => Promise<{ scheduled_time: number; result_retention?: number }>;
    listRuns: (filters: RunFilters) => Promise<RunSummary[]>;
    resolveTimeRange: (earliest: string, latest: string, scheduledTime: number) => Promise<{ earliest: number | null; latest: number }>;
    nextSlots: (cron: string, timezone: string | null, count?: number) => Promise<client.NextSlotsResponse>;
}

const defaultApi: BuilderApi = {
    getJob: client.getJob,
    validateJob: client.validateJob,
    createJob: client.createJob,
    updateJob: client.updateJob,
    listDestinations: client.listDestinations,
    listAlertActions: client.listAlertActions,
    listJobs: client.listJobs,
    me: client.me,
    previewDefaults: client.previewDefaults,
    listRuns: client.listRuns,
    nextSlots: client.nextSlots,
    resolveTimeRange: client.resolveTimeRange,
    startPreview: client.startPreview,
    previewStatus: client.previewStatus,
    previewResults: client.previewResults,
    cancelPreview: client.cancelPreview,
};

export interface BuilderPageProps {
    /** From ?job_id=; none means a new job. */
    jobId?: string | null;
    /** From ?template=; a known key skips the picker. */
    template?: string | null;
    api?: BuilderApi;
}

type Notice = { type: 'success' | 'error' | 'info'; text: string } | null;

const errorsIn = (issues: Issue[]) => issues.filter((i) => i.level === 'error');
const sameIssue = (a: Issue, b: Issue) => a.code === b.code && (a.step || null) === (b.step || null);

export default function BuilderPage({ jobId: initialId = null, template = null, api = defaultApi }: BuilderPageProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [jobId, setJobId] = useState<string | null>(initialId);
    const startTemplate = initialId ? null : templateByKey(template || null);
    const [state, dispatch] = useReducer(reducer, startTemplate, (t: JobTemplate | null) => initialState(t ? t.build() : blankJob(), blankJob()));
    const [choosingTemplate, setChoosingTemplate] = useState(!initialId && !startTemplate);
    const [activeTab, setActiveTab] = useState<TabId>('steps');
    const [checklistDismissed, setChecklistDismissed] = useState(false);
    const [loading, setLoading] = useState(Boolean(initialId));
    const [loadError, setLoadError] = useState<string | null>(null);
    const [meta, setMeta] = useState<{ owner: string | null; canEdit: boolean }>({ owner: null, canEdit: true });
    const [me, setMe] = useState<Me | null>(null);
    const [destinations, setDestinations] = useState<Destination[]>([]);
    const [alertActions, setAlertActions] = useState<AlertAction[] | null>(null);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [selected, setSelected] = useState<Selection>(null);
    const [notice, setNotice] = useState<Notice>(null);
    const [showSummary, setShowSummary] = useState(false);
    const [busy, setBusy] = useState(false);
    const [ownerConfirm, setOwnerConfirm] = useState<{ newOwner: string } | null>(null);
    const [removing, setRemovingState] = useState<string | null>(null);
    const [scheduledTime, setScheduledTime] = useState(() => Math.floor(Date.now() / 1000));
    const timeTouched = useRef(false);
    const [paramValues, setParamValues] = useState<Record<string, string>>({});
    const [source, setSource] = useState('live');
    const [runs, setRuns] = useState<RunSummary[]>([]);
    const [resultRetention, setResultRetention] = useState<number | undefined>(undefined);
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

    /** This job's recent runs for "Input from": loaded with the job, after a save, and
     * each time the list is opened. */
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);
    const loadRuns = (id: string | null) => {
        if (!id) {
            return;
        }
        api.listRuns({ job_id: id, limit: 20 })
            .then((r) => mountedRef.current && setRuns(r.filter((run) => run.job_id === id)))
            .catch(() => undefined);
    };

    useEffect(() => {
        let live = true;
        api.me()
            .then((m) => live && setMe(m))
            .catch(() => undefined);
        api.listDestinations()
            .then((d) => live && setDestinations(d))
            .catch(() => undefined);
        api.listAlertActions()
            .then((a) => live && setAlertActions(a))
            .catch(() => undefined);
        api.listJobs()
            .then((j) => live && setJobs(j))
            .catch(() => undefined);
        if (initialId) {
            loadRuns(initialId);
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

    // The job is checked against the server as it is edited, once it is ready to edit.
    const checkJob = useCallback((j: JobDefinition) => api.validateJob({ ...j, id: jobId || undefined }), [api, jobId]);
    const auto = useAutoValidate(job, checkJob, { enabled: !loading && !loadError && !choosingTemplate });
    const serverIssues = auto.issues;
    const checkedJob = auto.checkedJob;

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
                setResultRetention(d.result_retention);
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
    // Result fields of each step's current preview, for the first-row tokens.
    const previewFields = useMemo(() => {
        const out: Record<string, string[]> = {};
        Object.keys(previews.previews).forEach((id) => {
            const p = previews.previews[id];
            if (p && !p.stale && p.results) {
                out[id] = p.results.fields;
            }
        });
        return out;
    }, [previews.previews]);
    const notes = useMemo(() => {
        const out: Record<string, ReturnType<typeof previewNote>> = {};
        Object.keys(previews.previews).forEach((id) => {
            out[id] = previewNote(previews.previews[id]);
        });
        return out;
    }, [previews.previews]);
    // Server warnings stay until the next check. Once the job is edited, server errors the
    // client check also finds are recomputed live; the rest stay until the next check.
    const issues = useMemo(() => {
        const server =
            checkedJob === job
                ? serverIssues
                : serverIssues.filter((i) => i.level === 'warning' || !CLIENT_ISSUE_CODES.has(i.code));
        const local = findIssues(job).filter((i) => !server.some((s) => sameIssue(s, i)));
        return [...server, ...local];
    }, [job, serverIssues, checkedJob]);
    const checklist = useMemo(() => readiness(job), [job]);
    const allReady = checklist.every((i) => i.done);
    // Once everything is done the checklist stays away until the page reloads.
    useEffect(() => {
        if (allReady && !loading && !choosingTemplate) {
            setChecklistDismissed(true);
        }
    }, [allReady, loading, choosingTemplate]);
    const byStep = issuesByStep(issues);
    const jobLevel = byStep[''] || [];
    const errorIssues = errorsIn(issues);
    const stepNames = useMemo(() => Object.fromEntries(job.steps.map((s) => [s.id, stepLabel(s)])), [job.steps]);
    const goToIssue = (issue: Issue) => {
        setActiveTab(tabForIssue(issue));
        if (issue.step) {
            setSelected({ kind: 'step', id: issue.step });
        }
    };
    // The list stays until the next save attempt or until nothing is left to fix: no live
    // client errors and no server errors kept from the last check.
    useEffect(() => {
        if (showSummary && !errorIssues.length) {
            setShowSummary(false);
        }
    }, [showSummary, errorIssues.length]);

    const owner = meta.owner || (me ? me.user : '');
    const selectedStep = selected && selected.kind === 'step' && job.steps.some((s) => s.id === selected.id) ? selected.id : null;
    const selectedEdge =
        selected && selected.kind === 'edge' && (job.edges || []).some((e) => e.from === selected.from && e.to === selected.to)
            ? selected
            : null;

    const runCheck = async (): Promise<ValidateResponse | null> => {
        try {
            const res = await api.validateJob({ ...job, id: jobId || undefined });
            auto.accept(job, res);
            return res;
        } catch (err) {
            const e = err as client.ApiError;
            auto.accept(job, { issues: e.issues || [] });
            setNotice({ type: 'error', text: `The job could not be checked: ${e.message}` });
            return null;
        }
    };

    const doSave = async () => {
        setOwnerConfirm(null);
        setBusy(true);
        setNotice(null);
        try {
            const res = jobId ? await api.updateJob(jobId, job) : await api.createJob(job);
            auto.accept(job, res);
            dispatch({ type: 'saved', job });
            setMeta({ owner: res.job.owner, canEdit: true });
            if (!jobId) {
                setJobId(res.job.id);
                try {
                    window.history.replaceState(null, '', pageHref('builder', { job_id: res.job.id }));
                } catch (err) {
                    // the page still works; a reload would open a new job
                }
            }
            loadRuns(res.job.id);
            setNotice({ type: 'success', text: 'Saved.' });
        } catch (err) {
            const e = err as client.ApiError;
            auto.accept(job, { issues: e.issues || [] });
            setNotice({ type: 'error', text: `The job was not saved: ${e.message}` });
        } finally {
            setBusy(false);
        }
    };

    const dirty = isDirty(state);
    useEffect(() => {
        if (!dirty) {
            return undefined;
        }
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const onSave = async () => {
        setNotice(null);
        setShowSummary(false);
        if (errorsIn(findIssues(job)).length) {
            setShowSummary(true);
            return;
        }
        setBusy(true);
        const res = await runCheck();
        setBusy(false);
        if (!res) {
            return;
        }
        if (errorsIn(res.issues || []).length) {
            setShowSummary(true);
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
                    scheduledTime={scheduledTime}
                    resolveTimeRange={api.resolveTimeRange}
                    issues={byStep[selectedStep] || []}
                    dispatch={dispatch}
                    destinations={destinations}
                    alertActions={alertActions}
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
                    previewFields={previewFields}
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
                    previewFields={previewFields}
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
            onOpenRuns={() => loadRuns(jobId)}
            resultRetention={resultRetention}
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
                </div>
                <div ref={canvasArea}>
                <Canvas
                    steps={job.steps}
                    edges={job.edges || []}
                    selected={selected}
                    issues={issues}
                    onSelect={setSelected}
                    onConnect={(from, to) => dispatch({ type: 'connect', from, to })}
                    onAddFrom={(from) => {
                        const id = nextStepId(job.steps);
                        dispatch({ type: 'addStepFrom', from, id });
                        setSelected({ kind: 'step', id });
                    }}
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
            {auto.checking && <Typography as="span" variant="body">Checking…</Typography>}
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
            {showSummary && errorIssues.length > 0 && <IssueSummary issues={errorIssues} stepNames={stepNames} onGo={goToIssue} />}
            <IssueList issues={jobLevel} />
            {loading ? (
                <WaitSpinner size="medium" />
            ) : choosingTemplate ? (
                <TemplatePicker
                    onChoose={(t) => {
                        const built = t.build();
                        dispatch({ type: 'applyTemplate', job: built });
                        setChoosingTemplate(false);
                        if (built.steps.length) {
                            setSelected({ kind: 'step', id: built.steps[0].id });
                        }
                    }}
                />
            ) : (
                <>
                    <ControlGroup label="Job name" labelFor="job-name" labelPosition="top">
                        <Text
                            inputId="job-name"
                            value={job.name}
                            onChange={(_e: unknown, { value }: { value: string }) => dispatch({ type: 'setJobField', field: 'name', value })}
                        />
                    </ControlGroup>
                    {!checklistDismissed && !allReady && <SetupChecklist items={checklist} onTabChange={setActiveTab} onHide={() => setChecklistDismissed(true)} />}
                    <JobTabs
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                        job={job}
                        dispatch={dispatch}
                        owner={owner}
                        roles={me ? me.roles : []}
                        jobs={jobs}
                        destinations={destinations}
                        alertActions={alertActions}
                        steps={stepsTab}
                        nextSlots={api.nextSlots}
                        previewFields={previewFields}
                        issues={issues}
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
                        <p>{`${removingStep ? stepLabel(removingStep) : removing} and its connections are removed. Undo brings them back.`}</p>
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
