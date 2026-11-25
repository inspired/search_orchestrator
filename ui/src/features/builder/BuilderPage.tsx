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
import { standardGraph, standardLineLabels } from './standardGraph';
import StandardAddStep from './StandardAddStep';
import TriggersTab from './TriggersTab';
import { readSimple } from '../simple/simpleModel';
import { ViewSwitch, useBuilderView } from '../simple/useBuilderView';
import useCompactPref from './useCompactPref';
import useFlowLayout from './useFlowLayout';
import { CLIENT_ISSUE_CODES, findIssues, issuesByStep } from './graphLogic';
import { stepLabel } from './GraphView';
import JobTabs, { TabId } from './JobTabs';
import IssueSummary from './IssueSummary';
import { nodeForIssue, standardTarget, tabForIssue } from './issueTabs';
import { buildGraph, stepKey, STEP_KINDS } from './nodeModel';
import type { PortId } from './nodeModel';
import NodePanel from './NodePanel';
import RemoveNodeModal from './RemoveNodeModal';
import PreviewBar from './PreviewBar';
import { previewRefusal } from './previewLogic';
import type { PreviewContext } from './previewLogic';
import useAutoValidate from './useAutoValidate';
import useBuilderData from './useBuilderData';
import BuilderToolbarExtras from './BuilderToolbarExtras';
import useFillHeight from './useFillHeight';
import useLeaveWarning from './useLeaveWarning';
import useClipboard from './useClipboard';
import forgetChecklist from './forgetChecklist';
import useSnippets from './useSnippets';
import useFlowMenus from './useFlowMenus';
import useSelection from './useSelection';
import useGroups from './useGroups';
import usePreviews, { PreviewApi } from './usePreviews';
import usePreviewViews from './usePreviewViews';
import { addNodeKey, blankJob, initialState, isDirty, keyAfterConnect, reducer } from './reducer';
import { IssueList } from './StepPanel';
import { allTags } from '../jobs/tags';

export interface BuilderApi extends PreviewApi {
    getJob: (jobId: string) => Promise<Job>;
    validateJob: (job: JobDefinition) => Promise<ValidateResponse>;
    createJob: (job: JobDefinition) => Promise<SaveResponse>;
    updateJob: (jobId: string, job: JobDefinition, baseRevision?: number) => Promise<SaveResponse>;
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
    listJobs: client.listJobsBrief,
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
    /** From Import jobs: a new, unsaved job to start from. */
    imported?: JobDefinition | null;
    /** The view a new job opens in (?view=, an example's view); else Standard. */
    initialView?: string | null;
    api?: BuilderApi;
}

type Notice = { type: 'success' | 'error' | 'info'; text: string } | null;

/** The canvas is never shorter than this. */
const MIN_CANVAS = 480;

const errorsIn = (issues: Issue[]) => issues.filter((i) => i.level === 'error');
const sameIssue = (a: Issue, b: Issue) => a.code === b.code && (a.step || null) === (b.step || null);

export default function BuilderPage({ jobId: initialId = null, imported = null, initialView = null, api = defaultApi }: BuilderPageProps) {
    useEffect(forgetChecklist, []);
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [jobId, setJobId] = useState<string | null>(initialId);
    const startJob = initialId ? null : imported || null;
    const [state, dispatch] = useReducer(reducer, startJob, (j: JobDefinition | null) => initialState(j || blankJob(), blankJob()));
    const [activeTab, setActiveTab] = useState<TabId>('steps');
    const [fullScreen, setFullScreen] = useState(false);
    const [notice, setNotice] = useState<Notice>(null);
    const [showSummary, setShowSummary] = useState(false);
    const [busy, setBusy] = useState(false);
    const [ownerConfirm, setOwnerConfirm] = useState<{ newOwner: string } | null>(null);
    /** The save was refused because someone saved the job after you opened it. */
    const [conflict, setConflict] = useState<{ by: string; at: number | null } | null>(null);
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
    // A node hidden in a collapsed group (from the issue list) shows its group first.
    // Groups are drawn in Advanced only, so only Advanced opens a collapsed one to show a node.
    const selectNode = (key: string) => (view === 'advanced' && grouping.reveal({ kind: 'node', key }), setSelected({ kind: 'node', key }));

    const { loading, loadError, meta, setMeta, me, destinations, alertActions, jobs, runs, loadRuns } = useBuilderData(api, initialId, dispatch);
    const { job } = state;

    // The job is checked against the server as it is edited, once it is ready to edit.
    const checkJob = useCallback((j: JobDefinition) => api.validateJob({ ...j, id: jobId || undefined }), [api, jobId]);
    const auto = useAutoValidate(job, checkJob, { enabled: !loading && !loadError });
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
    const byStep = issuesByStep(issues);
    const jobLevel = byStep[''] || [];
    const errorIssues = errorsIn(issues);
    const stepNames = useMemo(() => Object.fromEntries(job.steps.map((s) => [s.id, stepLabel(s)])), [job.steps]);
    const graph = useMemo(() => buildGraph(job), [job]);
    const asked = initialView === 'simple' || initialView === 'standard' || initialView === 'advanced' ? initialView : null;
    const [view, setView] = useBuilderView(job, !initialId, asked);
    const standard = view === 'standard';
    // Standard draws the steps only; triggers and actions are in tabs and the step's panel.
    const shownGraph = useMemo(() => (standard ? standardGraph(job) : graph), [standard, job, graph]);
    const standardLabels = useMemo(() => (standard ? standardLineLabels(job) : undefined), [standard, job]);
    const [compact, toggleCompact] = useCompactPref();
    const { positions, move, tidy, arrange } = useFlowLayout(job, graph, compact, dispatch);
    const picked = useSelection({ job, graph: shownGraph, dispatch, rememberFocus, returnFocus, focusAfterRemove: (key) => setFocusNext({ key }) });
    const { selection, removing, requestRemove, confirmRemove } = picked;
    const grouping = useGroups({ job, graph, positions, dispatch, selection, select: setSelectedState, rememberFocus, returnFocus });
    // Standard: the action "Go to" opens inside its step's panel (n re-opens the same one).
    const [openAction, setOpenAction] = useState<{ stepId: string; index: number; n: number } | null>(null);
    const goToIssue = (issue: Issue) => {
        setActiveTab(tabForIssue(issue, view));
        const key = nodeForIssue(job, issue);
        if (!key) {
            return;
        }
        if (!standard) {
            selectNode(key);
            return;
        }
        const target = standardTarget(key);
        if (target.select) {
            setSelected(target.select);
        }
        if (target.openAction) {
            setOpenAction({ ...target.openAction, n: Date.now() });
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
        setMeta({ owner: res.job.owner, canEdit: true, revision: res.job.revision || 0 });
        loadRuns(res.job.id);
        setNotice({ type: 'success', text });
    };

    const doSave = async (overwrite = false) => {
        setOwnerConfirm(null);
        setConflict(null);
        setBusy(true);
        setNotice(null);
        try {
            const res = jobId ? await api.updateJob(jobId, job, overwrite ? undefined : meta.revision) : await api.createJob(job);
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
            if (e.code === 'job_changed') {
                const extra = (e.extra || {}) as { updated_by?: string; updated_at?: number };
                rememberFocus();
                setConflict({ by: extra.updated_by || 'Someone', at: extra.updated_at || null });
                return;
            }
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
        onlyKinds: standard ? STEP_KINDS : undefined,
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
    const modalOpen = Boolean(removing || ownerConfirm || conflict || grouping.modalOpen);
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
    const removeStandardLine = (key: string) => {
        const link = shownGraph.links.find((l) => l.key === key);
        if (link) {
            dispatch({ type: 'disconnect', from: link.from.slice('step:'.length), to: link.to.slice('step:'.length) });
            setSelected(null);
        }
    };
    const connectSteps = (from: string, to: string) => {
        if (from.startsWith('step:') && to.startsWith('step:') && from !== to) {
            connectLine(from, 'success', to);
        }
    };
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
        <ViewSwitch view={view} onView={setView} lockedReasons={readSimple(job).reasons} />
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
                onOpenAdvanced={() => setView('advanced')}
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
        {standard && meta.canEdit && (
            <StandardAddStep
                onAdd={(kind) => {
                    const key = addNodeKey(job, kind);
                    dispatch({ type: 'addNode', kind });
                    if (key) {
                        setSelected({ kind: 'node', key });
                    }
                }}
            />
        )}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div ref={canvasArea} style={{ flex: 1, minWidth: 0 }}>
                <FlowCanvas
                    graph={shownGraph}
                    lineLabels={standardLabels}
                    positions={positions}
                    selected={selection}
                    issues={issues}
                    previews={nodePreviews}
                    compact={compact}
                    onToggleCompact={toggleCompact}
                    onSelect={setSelected}
                    onMove={move}
                    onConnect={standard ? (from, _port, to) => connectSteps(from, to) : connectLine}
                    onPlus={menus.onPlus}
                    onDropOnNode={menus.onDropOnNode}
                    onDropOnCanvas={menus.onDropOnCanvas}
                    onLineMenu={standard ? undefined : menus.onLineMenu}
                    onContext={standard ? undefined : menus.onContext}
                    onSplice={standard ? undefined : menus.onSplice}
                    canSpliceNode={standard ? undefined : menus.canSpliceNode}
                    onRequestRemove={requestRemove}
                    onRequestRemoveNodes={picked.requestRemoveNodes}
                    onRemoveLink={standard ? removeStandardLine : menus.removeLink}
                    onCopy={clipboard.onCopy}
                    onDuplicate={clipboard.onDuplicate}
                    onPaste={clipboard.onPaste}
                    onQuickAdd={(at, screen) => menus.openQuick({ at, screen })}
                    onTidy={() => (standard ? dispatch({ type: 'tidyLayout', keys: shownGraph.nodes.map((n) => n.key), compact }) : tidy())}
                    overlay={menus.overlay}
                    height={canvasHeight}
                    fullScreen={fullScreen}
                    onToggleFullScreen={() => setFullScreen((f) => !f)}
                    panelOpen={panel.open}
                    onTogglePanel={panel.toggle}
                    {...(standard ? {} : grouping.canvas)}
                />
            </div>
            <SidePanel ref={panelRef} open={panel.open} width={panel.width} onOpen={panel.setOpen} onWidth={panel.setWidth} maxHeight={panelHeight}>
                <NodePanel
                    job={job}
                    graph={shownGraph}
                    standard={standard}
                    openAction={openAction}
                    selection={selection}
                    byStep={byStep}
                    dispatch={dispatch}
                    onSelect={setSelected}
                    onRequestRemove={requestRemove}
                    onRequestRemoveNodes={picked.requestRemoveNodes}
                    onRemoveLink={standard ? removeStandardLine : menus.removeLink}
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
            {showSummary && errorIssues.length > 0 && <IssueSummary issues={errorIssues} stepNames={stepNames} onGo={goToIssue} view={view} />}
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
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                        job={job}
                        dispatch={dispatch}
                        owner={owner}
                        roles={me ? me.roles : []}
                        steps={stepsTab}
                        view={view}
                        triggers={
                            <TriggersTab
                                job={job}
                                jobs={jobs}
                                dispatch={dispatch}
                                nextSlots={api.nextSlots}
                                schedulePreview={api.schedulePreview}
                                savedJobId={jobId}
                                onOpenSettings={() => setActiveTab('settings')}
                                onRequestRemove={requestRemove}
                            />
                        }
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
                        <Button appearance="primary" label="Save and take ownership" onClick={() => void doSave()} />
                    </Modal.Footer>
                </Modal>
            )}
            {conflict && (
                <Modal open onRequestClose={() => setConflict(null)} returnFocus={returnFocus} style={{ width: '560px' }}>
                    <Modal.Header title="This job was changed" />
                    <Modal.Body>
                        <Message type="warning" appearance="default">
                            {`${conflict.by} changed this job${conflict.at ? ` at ${new Date(conflict.at * 1000).toLocaleString()}` : ''}, after you opened it. Saving now replaces their changes with yours. Reload their version to see what they did (your unsaved changes are lost).`}
                        </Message>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button appearance="secondary" label="Cancel" onClick={() => setConflict(null)} />
                        <Button appearance="secondary" label="Reload their version" onClick={() => window.location.reload()} />
                        <Button appearance="destructive" label="Save mine anyway" onClick={() => void doSave(true)} />
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
