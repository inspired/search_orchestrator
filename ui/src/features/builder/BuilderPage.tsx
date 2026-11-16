/* The job builder: the Flow tab's node editor (steps, triggers, actions, conditions and the
 * whole job) with a side panel for the selected node, the other job tabs, undo/redo, automatic
 * checking against the server, and Save. Save checks first, and warns before an admin takes
 * over someone else's job. */
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
import FlowCanvas, { FlowSelection, ScreenPoint } from './FlowCanvas';
import { layoutFlow } from './flowLayout';
import { CLIENT_ISSUE_CODES, findIssues, issuesByStep } from './graphLogic';
import type { Pos } from './graphLogic';
import { stepLabel } from './GraphView';
import JobTabs, { TabId } from './JobTabs';
import { ChecklistItem, readiness } from './readiness';
import IssueSummary from './IssueSummary';
import { nodeForIssue, tabForIssue } from './issueTabs';
import { targetKinds } from './nodeCatalog';
import { JOB_KEY, buildGraph, stepKey } from './nodeModel';
import type { NodeKind, PortId } from './nodeModel';
import NodePanel from './NodePanel';
import QuickAdd from './QuickAdd';
import RemoveNodeModal from './RemoveNodeModal';
import SetupChecklist from './SetupChecklist';
import PreviewBar from './PreviewBar';
import type { PreviewContext } from './previewLogic';
import useAutoValidate from './useAutoValidate';
import usePreviews, { PreviewApi, previewNote } from './usePreviews';
import { addNodeKey, blankJob, initialState, isDirty, keyAfterConnect, reducer } from './reducer';
import type { BuilderAction } from './reducer';
import { IssueList } from './StepPanel';
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

/** An open quick-add box: which kinds it offers, the line it continues, and where. */
interface QuickAddState {
    kinds?: NodeKind[];
    from?: { key: string; port: PortId };
    /** Canvas point for the new node; none lets the layout place it. */
    at?: Pos;
    screen: ScreenPoint;
}

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
    const [selected, setSelectedState] = useState<FlowSelection>(null);
    const [quick, setQuick] = useState<QuickAddState | null>(null);
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
    const setRemoving = (key: string | null) => {
        if (key) {
            rememberFocus();
        }
        setRemovingState(key);
    };
    // Selecting anything (or clicking the empty canvas) closes the quick-add box.
    const setSelected = (sel: FlowSelection) => {
        setQuick(null);
        setSelectedState(sel);
    };
    const selectNode = (key: string) => setSelected({ kind: 'node', key });

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
    const graph = useMemo(() => buildGraph(job), [job]);
    const positions = useMemo(() => layoutFlow(graph, job.layout?.nodes), [graph, job.layout]);
    // A selection whose node or line is gone (removed, undone, renamed) counts as none.
    const selection: FlowSelection =
        selected &&
        (selected.kind === 'node' ? graph.nodes.some((n) => n.key === selected.key) : graph.links.some((l) => l.key === selected.key))
            ? selected
            : null;
    const goToIssue = (issue: Issue) => {
        setActiveTab(tabForIssue(issue));
        const key = nodeForIssue(job, issue);
        if (key) {
            selectNode(key);
        }
    };
    const goToItem = (item: ChecklistItem) => {
        setActiveTab(item.tab);
        if (item.node) {
            selectNode(item.node);
        } else if (item.addKinds) {
            rememberFocus();
            setQuick({ kinds: item.addKinds, screen: { left: 8, top: 8 } });
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

    // After a confirmed delete, focus moves to the next step, else the previous one, else the
    // canvas; after adding a node, to the new node. Applied once the modal or quick-add box has
    // closed and handed focus back.
    const [focusNext, setFocusNext] = useState<{ key: string | null } | null>(null);
    useEffect(() => {
        if (!focusNext || removing) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            const area = canvasArea.current;
            if (area) {
                const nodes = Array.from(area.querySelectorAll<HTMLElement>('[data-node-key]'));
                const node = nodes.find((n) => n.getAttribute('data-node-key') === focusNext.key);
                const target = node || area.querySelector<HTMLElement>('[data-canvas]');
                if (target) {
                    target.focus();
                }
            }
            setFocusNext(null);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [focusNext, removing]);

    const requestRemove = (key: string) => {
        if (key !== JOB_KEY) {
            setRemoving(key);
        }
    };

    const confirmRemove = (action: BuilderAction) => {
        if (removing) {
            let next: string | null = null;
            if (action.type === 'removeStep') {
                const ids = job.steps.map((s) => s.id);
                const at = ids.indexOf(action.id);
                const id = ids[at + 1] !== undefined ? ids[at + 1] : ids[at - 1];
                next = id === undefined ? null : stepKey(id);
            }
            returnFocus.current = null;
            setFocusNext({ key: next });
            dispatch(action);
            // Later actions in the same list, and later triggers, move down a place, so a
            // selection among them would point at a different node: drop it.
            const shifting = removing.startsWith('action:')
                ? removing.slice(0, removing.lastIndexOf(':') + 1)
                : removing.startsWith('trigger:')
                  ? 'trigger:'
                  : null;
            const key = selection && selection.kind === 'node' ? selection.key : null;
            if (key && (key === removing || (shifting && key.startsWith(shifting)))) {
                setSelected(null);
            }
        }
        setRemoving(null);
    };

    const closeQuick = () => {
        setQuick(null);
        const back = returnFocus.current;
        returnFocus.current = null;
        if (back && back.isConnected) {
            back.focus();
        } else {
            setFocusNext({ key: null });
        }
    };

    const chooseNode = (kind: NodeKind) => {
        if (!quick) {
            return;
        }
        const key = addNodeKey(job, kind, quick.from);
        dispatch({ type: 'addNode', kind, at: quick.at, from: quick.from, shown: quick.at ? positions : undefined });
        returnFocus.current = null;
        setQuick(null);
        if (key) {
            setSelectedState({ kind: 'node', key });
            setFocusNext({ key });
        }
    };

    const openQuick = (state: QuickAddState) => {
        if (state.kinds && !state.kinds.length) {
            return;
        }
        rememberFocus();
        setQuick(state);
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
            <div ref={canvasArea} style={{ flex: 1, minWidth: 0 }}>
                <FlowCanvas
                    graph={graph}
                    positions={positions}
                    selected={selection}
                    issues={issues}
                    notes={notes}
                    onSelect={setSelected}
                    // Every shown position is written with the move, so nodes the layout placed
                    // stay where they are instead of being placed again around the moved one.
                    onMove={(moved) => dispatch({ type: 'moveNodes', positions: { ...positions, ...moved } })}
                    onConnect={(from, port, to) => {
                        // A line onto an action can move it to another list: keep the selection on it.
                        if (selection && selection.kind === 'node') {
                            const next = keyAfterConnect(job, { from, port, to }, selection.key);
                            if (next !== selection.key) {
                                setSelectedState({ kind: 'node', key: next });
                            }
                        }
                        dispatch({ type: 'connectPort', from, port, to });
                    }}
                    onDropOnCanvas={(from, port, at, screen) => {
                        const node = graph.nodes.find((n) => n.key === from);
                        // A condition already leads somewhere; its line is moved, not continued.
                        if (node && node.kind !== 'condition') {
                            openQuick({ kinds: targetKinds(port, node.kind), from: { key: from, port }, at, screen });
                        }
                    }}
                    onRequestRemove={requestRemove}
                    onQuickAdd={(at, screen) => openQuick({ at, screen })}
                    onTidy={() => dispatch({ type: 'tidyLayout' })}
                    overlay={
                        quick && (
                            <QuickAdd
                                open
                                at={{ left: Math.max(0, quick.screen.left), top: Math.max(0, quick.screen.top) }}
                                kinds={quick.kinds}
                                onChoose={chooseNode}
                                onClose={closeQuick}
                            />
                        )
                    }
                />
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
                <NodePanel
                    job={job}
                    graph={graph}
                    selection={selection}
                    byStep={byStep}
                    dispatch={dispatch}
                    onSelect={setSelected}
                    onRequestRemove={requestRemove}
                    onOpenSettings={() => setActiveTab('settings')}
                    destinations={destinations}
                    alertActions={alertActions}
                    jobs={jobs}
                    nextSlots={api.nextSlots}
                    previewFields={previewFields}
                    scheduledTime={scheduledTime}
                    resolveTimeRange={api.resolveTimeRange}
                    previews={previews.previews}
                    onPreview={
                        meta.canEdit
                            ? (id, opts) => {
                                  previews.preview(id, opts);
                              }
                            : undefined
                    }
                    onCancelPreview={previews.cancel}
                />
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
                            selectNode(stepKey(built.steps[0].id));
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
                    {!checklistDismissed && !allReady && <SetupChecklist items={checklist} onGo={goToItem} onHide={() => setChecklistDismissed(true)} />}
                    <JobTabs
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                        job={job}
                        dispatch={dispatch}
                        owner={owner}
                        roles={me ? me.roles : []}
                        steps={stepsTab}
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
                <RemoveNodeModal job={job} nodeKey={removing} returnFocus={returnFocus} onCancel={() => setRemoving(null)} onConfirm={confirmRemove} />
            )}
        </PageShell>
    );
}
