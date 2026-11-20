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
import type { AlertAction, Destination, Issue, Job, JobDefinition, Me, RunFilters, RunSummary, SaveResponse, SchedulePreviewResponse, ValidateResponse } from '../../api/types';
import PageShell, { pageHref } from '../../components/PageShell';
import FlowCanvas, { FlowSelection } from './FlowCanvas';
import SidePanel, { usePanelLayout } from './SidePanel';
import SimpleView from '../simple/SimpleView';
import { ViewSwitch, useBuilderView } from '../simple/useBuilderView';
import useCompactPref from './useCompactPref';
import useFlowLayout from './useFlowLayout';
import { CLIENT_ISSUE_CODES, findIssues, issuesByStep } from './graphLogic';
import { stepLabel } from './GraphView';
import JobTabs, { TabId } from './JobTabs';
import { ChecklistItem, readiness } from './readiness';
import IssueSummary from './IssueSummary';
import { nodeForIssue, tabForIssue } from './issueTabs';
import { buildGraph, stepKey } from './nodeModel';
import type { PortId } from './nodeModel';
import NodePanel from './NodePanel';
import RemoveNodeModal from './RemoveNodeModal';
import SetupChecklist from './SetupChecklist';
import useChecklistHidden from './useChecklistHidden';
import PreviewBar from './PreviewBar';
import { previewRefusal } from './previewLogic';
import type { PreviewContext } from './previewLogic';
import useAutoValidate from './useAutoValidate';
import useBuilderData from './useBuilderData';
import BuilderToolbarExtras from './BuilderToolbarExtras';
import useFillHeight from './useFillHeight';
import useLeaveWarning from './useLeaveWarning';
import useClipboard from './useClipboard';
import useSnippets from './useSnippets';
import useFlowMenus from './useFlowMenus';
import useSelection from './useSelection';
import useGroups from './useGroups';
import usePreviews, { PreviewApi } from './usePreviews';
import usePreviewViews from './usePreviewViews';
import { blankJob, initialState, isDirty, keyAfterConnect, reducer } from './reducer';
import { IssueList } from './StepPanel';
import TemplatePicker from './TemplatePicker';
import { templateByKey } from './templates';
import { allTags } from '../jobs/tags';

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
    /** Other jobs' load around a draft's schedules, for the busy-times strip; none hides it. */
    schedulePreview?: (job: JobDefinition) => Promise<SchedulePreviewResponse>;
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
    schedulePreview: client.schedulePreview,
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
    /** From Import jobs: a new, unsaved job to start from. */
    imported?: JobDefinition | null;
    api?: BuilderApi;
}

type Notice = { type: 'success' | 'error' | 'info'; text: string } | null;

/** The canvas is never shorter than this. */
const MIN_CANVAS = 480;

const errorsIn = (issues: Issue[]) => issues.filter((i) => i.level === 'error');
const sameIssue = (a: Issue, b: Issue) => a.code === b.code && (a.step || null) === (b.step || null);

export default function BuilderPage({ jobId: initialId = null, template = null, imported = null, api = defaultApi }: BuilderPageProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [jobId, setJobId] = useState<string | null>(initialId);
    const startJob = initialId ? null : imported || templateByKey(template || null)?.build() || null;
    const [state, dispatch] = useReducer(reducer, startJob, (j: JobDefinition | null) => initialState(j || blankJob(), blankJob()));
    const [choosingTemplate, setChoosingTemplate] = useState(!initialId && !startJob);
    const [activeTab, setActiveTab] = useState<TabId>('steps');
    const checklistPref = useChecklistHidden(initialId);
    const checklistDismissed = checklistPref.hidden;
    const [fullScreen, setFullScreen] = useState(false);
    const [notice, setNotice] = useState<Notice>(null);
    const [showSummary, setShowSummary] = useState(false);
    const [busy, setBusy] = useState(false);
    const [ownerConfirm, setOwnerConfirm] = useState<{ newOwner: string } | null>(null);
    const [scheduledTime, setScheduledTime] = useState(() => Math.floor(Date.now() / 1000));
    const timeTouched = useRef(false);
    const [paramValues, setParamValues] = useState<Record<string, string>>({});
    const [source, setSource] = useState('live');
    const [resultRetention, setResultRetention] = useState<number | undefined>(undefined);
    const returnFocus = useRef<HTMLElement | null>(null);
    const rememberFocus = () => {
        returnFocus.current = document.activeElement as HTMLElement | null;
    };
    // Selecting anything (or clicking the empty canvas) closes the popups (see useFlowMenus).
    const setSelected = (sel: FlowSelection) => {
        menus.close();
        setSelectedState(sel);
    };
    const setSelectedState = (sel: FlowSelection) => picked.setSelected(sel);
    // A node hidden in a collapsed group (the issue list, the checklist) shows its group first.
    const selectNode = (key: string) => (grouping.reveal({ kind: 'node', key }), setSelected({ kind: 'node', key }));

    const { loading, loadError, meta, setMeta, me, destinations, alertActions, jobs, runs, loadRuns } = useBuilderData(api, initialId, dispatch);
    const { job } = state;

    // The job is checked against the server as it is edited, once it is ready to edit.
    const checkJob = useCallback((j: JobDefinition) => api.validateJob({ ...j, id: jobId || undefined }), [api, jobId]);
    const auto = useAutoValidate(job, checkJob, { enabled: !loading && !loadError && !choosingTemplate });
    const serverIssues = auto.issues;
    const checkedJob = auto.checkedJob;

    // Tags other jobs use, offered in Settings > Tags (a failure just offers none).
    const [knownTags, setKnownTags] = useState<string[]>([]);
    useEffect(() => {
        let live = true;
        api.listJobs()
            .then((jobs) => live && setKnownTags(allTags(jobs)))
            .catch(() => undefined);
        return () => {
            live = false;
        };
    }, [api]);

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
    const { previewFields, nodePreviews } = usePreviewViews(previews.previews);
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
            checklistPref.hideQuietly();
        }
    }, [allReady, loading, choosingTemplate]); // eslint-disable-line react-hooks/exhaustive-deps
    const byStep = issuesByStep(issues);
    const jobLevel = byStep[''] || [];
    const errorIssues = errorsIn(issues);
    const stepNames = useMemo(() => Object.fromEntries(job.steps.map((s) => [s.id, stepLabel(s)])), [job.steps]);
    const graph = useMemo(() => buildGraph(job), [job]);
    const [compact, toggleCompact] = useCompactPref();
    const { positions, move, tidy, arrange } = useFlowLayout(job, graph, compact, dispatch);
    const picked = useSelection({ job, graph, dispatch, rememberFocus, returnFocus, focusAfterRemove: (key) => setFocusNext({ key }) });
    const { selection, removing, requestRemove, confirmRemove } = picked;
    const grouping = useGroups({ job, graph, positions, dispatch, selection, select: setSelectedState, rememberFocus, returnFocus });
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
            menus.openQuick({ kinds: item.addKinds, screen: { left: 8, top: 8 } });
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

    const afterSaved = (res: SaveResponse, saved: JobDefinition, text: string) => {
        auto.accept(saved, res);
        dispatch({ type: 'saved', job: saved });
        setMeta({ owner: res.job.owner, canEdit: true });
        loadRuns(res.job.id);
        setNotice({ type: 'success', text });
    };

    const doSave = async () => {
        setOwnerConfirm(null);
        setBusy(true);
        setNotice(null);
        try {
            const res = jobId ? await api.updateJob(jobId, job) : await api.createJob(job);
            afterSaved(res, job, 'Saved.');
            if (!jobId) {
                setJobId(res.job.id);
                try {
                    window.history.replaceState(null, '', pageHref('builder', { job_id: res.job.id }));
                } catch (err) {
                    // the page still works; a reload would open a new job
                }
            }
        } catch (err) {
            const e = err as client.ApiError;
            auto.accept(job, { issues: e.issues || [] });
            setNotice({ type: 'error', text: `The job was not saved: ${e.message}` });
        } finally {
            setBusy(false);
        }
    };

    useLeaveWarning(isDirty(state));

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

    // A line onto an action can move it to another list: keep the selection on it.
    const connectLine = (from: string, port: PortId, to: string) => {
        if (selection && selection.kind === 'node') {
            const next = keyAfterConnect(job, { from, port, to }, selection.key);
            if (next !== selection.key) {
                setSelectedState({ kind: 'node', key: next });
            }
        }
        dispatch({ type: 'connectPort', from, port, to });
    };

    // The step whose name field to focus once its panel shows (right-click, Rename).
    const [renaming, setRenaming] = useState<string | null>(null);
    useEffect(() => {
        if (!renaming) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            document.getElementById(`step-${renaming}-name`)?.focus();
            setRenaming(null);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [renaming]);

    const clipboard = useClipboard({ job, positions, selection, dispatch, select: setSelectedState, notify: (text) => menus.notify(text), compact });
    const snippets = useSnippets({ job, positions, me, put: clipboard.put });
    const menus = useFlowMenus({
        job,
        graph,
        positions,
        compact,
        snippets,
        dispatch,
        select: setSelectedState,
        focusNode: (key) => setFocusNext({ key }),
        connectLine,
        returnFocus,
        rememberFocus,
        canvas: () => canvasArea.current && canvasArea.current.querySelector('[data-canvas]'),
        context: {
            rename: (key) => {
                setSelectedState({ kind: 'node', key });
                setRenaming(key.slice('step:'.length));
            },
            duplicate: clipboard.onDuplicate,
            copy: clipboard.onCopy,
            paste: clipboard.onPaste,
            tidy,
            arrange,
            requestRemove,
            requestRemoveNodes: picked.requestRemoveNodes,
            group: grouping.group,
            preview: meta.canEdit ? (id) => previews.preview(id) : undefined,
            previewRefusal: (id) => previewRefusal(job, id, source === 'live'),
        },
    });


    // Full screen: the canvas and panel over the whole page. Escape leaves, unless something
    // (a popup, the canvas clearing its selection, a modal) used it first.
    const modalOpen = Boolean(removing || ownerConfirm || grouping.modalOpen);
    useEffect(() => {
        if (!fullScreen) {
            return undefined;
        }
        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape' && !ev.defaultPrevented && !modalOpen) {
                setFullScreen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [fullScreen, modalOpen]);
    const canvasHeight = useFillHeight(() => canvasArea.current && canvasArea.current.querySelector('[data-canvas]'), MIN_CANVAS, fullScreen);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const panel = usePanelLayout();
    const [view, setView] = useBuilderView(job);
    const panelHeight = useFillHeight(() => panelRef.current, MIN_CANVAS, fullScreen);

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
        <ViewSwitch view={view} onView={setView} />
        {view === 'simple' ? (
            <SimpleView
                job={job}
                dispatch={dispatch}
                canEdit={meta.canEdit}
                issues={issues}
                jobs={jobs}
                destinations={destinations}
                nextSlots={api.nextSlots}
                schedulePreview={api.schedulePreview}
                savedJobId={jobId}
                scheduledTime={scheduledTime}
                resolveTimeRange={api.resolveTimeRange}
                previews={previews.previews}
                onPreview={meta.canEdit ? (id, opts) => void previews.preview(id, opts) : undefined}
                onCancelPreview={previews.cancel}
                onOpenFlow={() => setView('flow')}
                onOpenSettings={() => setActiveTab('settings')}
                onRequestRemove={requestRemove}
                previewFields={previewFields}
            />
        ) : (
        <div
            data-testid="flow-area"
            style={
                fullScreen
                    ? { position: 'fixed', inset: 0, zIndex: 1000, padding: '16px', background: theme.backgroundColorPage, overflow: 'hidden' }
                    : undefined
            }
        >
        {menus.notice}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div ref={canvasArea} style={{ flex: 1, minWidth: 0 }}>
                <FlowCanvas
                    graph={graph}
                    positions={positions}
                    selected={selection}
                    issues={issues}
                    previews={nodePreviews}
                    compact={compact}
                    onToggleCompact={toggleCompact}
                    onSelect={setSelected}
                    onMove={move}
                    onConnect={connectLine}
                    onPlus={menus.onPlus}
                    onDropOnNode={menus.onDropOnNode}
                    onDropOnCanvas={menus.onDropOnCanvas}
                    onLineMenu={menus.onLineMenu}
                    onContext={menus.onContext}
                    onSplice={menus.onSplice}
                    canSpliceNode={menus.canSpliceNode}
                    onRequestRemove={requestRemove}
                    onRequestRemoveNodes={picked.requestRemoveNodes}
                    onRemoveLink={menus.removeLink}
                    onCopy={clipboard.onCopy}
                    onDuplicate={clipboard.onDuplicate}
                    onPaste={clipboard.onPaste}
                    onQuickAdd={(at, screen) => menus.openQuick({ at, screen })}
                    onTidy={() => tidy()}
                    overlay={menus.overlay}
                    height={canvasHeight}
                    fullScreen={fullScreen}
                    onToggleFullScreen={() => setFullScreen((f) => !f)}
                    panelOpen={panel.open}
                    onTogglePanel={panel.toggle}
                    {...grouping.canvas}
                />
            </div>
            <SidePanel ref={panelRef} open={panel.open} width={panel.width} onOpen={panel.setOpen} onWidth={panel.setWidth} maxHeight={panelHeight}>
                <NodePanel
                    job={job}
                    graph={graph}
                    selection={selection}
                    byStep={byStep}
                    dispatch={dispatch}
                    onSelect={setSelected}
                    onRequestRemove={requestRemove}
                    onRequestRemoveNodes={picked.requestRemoveNodes}
                    onRemoveLink={menus.removeLink}
                    onArrange={arrange}
                    onTidy={tidy}
                    onOpenSettings={() => setActiveTab('settings')}
                    destinations={destinations}
                    alertActions={alertActions}
                    jobs={jobs}
                    nextSlots={api.nextSlots}
                schedulePreview={api.schedulePreview}
                savedJobId={jobId}
                    previewFields={previewFields}
                    scheduledTime={scheduledTime}
                    resolveTimeRange={api.resolveTimeRange}
                    previews={previews.previews}
                    previewJob={previewJob}
                    previewCtx={previewCtx}
                    inputFor={previews.inputFor}
                    onPreview={meta.canEdit ? (id, opts) => void previews.preview(id, opts) : undefined}
                    onCancelPreview={previews.cancel}
                    previewLive={source === 'live'}
                    groupPanel={grouping.panel}
                    roles={me ? me.roles : []}
                    onSaveSnippet={snippets.canUse ? snippets.requestSave : undefined}
                />
            </SidePanel>
        </div>
        </div>
        )}
        </>
    );

    const actions = (
        <>
            <Button appearance="subtle" label="Undo" disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })} />
            <Button appearance="subtle" label="Redo" disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })} />
            <BuilderToolbarExtras jobId={jobId} job={job} me={me} snippets={snippets} />
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
                    {!allReady && (checklistDismissed ? <Button appearance="subtle" label="Show checklist" onClick={checklistPref.show} /> : <SetupChecklist items={checklist} onGo={goToItem} onHide={checklistPref.hide} />)}
                    <JobTabs
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                        job={job}
                        dispatch={dispatch}
                        owner={owner}
                        roles={me ? me.roles : []}
                        steps={stepsTab}
                        issues={issues}
                        canEdit={meta.canEdit}
                        knownTags={knownTags}
                        destinations={destinations}
                        alertActions={alertActions}
                        history={{ jobId, dirty: isDirty(state), canEdit: meta.canEdit, onRestored: (r, n) => (dispatch({ type: 'load', job: client.toDefinition(r.job) }), afterSaved(r, client.toDefinition(r.job), `Restored version ${n}.`)) }}
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
            {grouping.modal}
            {removing && (
                <RemoveNodeModal job={job} nodeKey={removing} returnFocus={returnFocus} onCancel={picked.cancelRemove} onConfirm={confirmRemove} />
            )}
        </PageShell>
    );
}
