/* Troubleshooting: what the app itself did and why, from its own log lines (bin/so/logs.py)
 * in _internal, searched as the viewer (bin/so/logs_api.py).
 *
 *  - Health tiles: engine, errors, warnings, failed and slow requests, failed actions and
 *    runs. Each is a filter when clicked.
 *  - Graphs to switch between: activity by level, requests and response time, engine tick
 *    time and active runs, the slowest Splunk calls, the most frequent events.
 *  - Three views: What happened (each line in words, with why and what to do for known
 *    failures), Problems (errors grouped by cause) and Run story (one run from created to
 *    finished, with the waits explained).
 *
 * Filters (time, job, level, part, text, run, event) live in the address, so a view can
 * be shared; Live refreshes every 10 seconds while the tab is visible. The run page and step
 * drawer link here with run_id and step_id filled in. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Chip from '@splunk/react-ui/Chip';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Link from '@splunk/react-ui/Link';
import Message from '@splunk/react-ui/Message';
import RadioBar from '@splunk/react-ui/RadioBar';
import Select from '@splunk/react-ui/Select';
import Switch from '@splunk/react-ui/Switch';
import TabBar from '@splunk/react-ui/TabBar';
import Text from '@splunk/react-ui/Text';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import { createURL } from '@splunk/splunk-utils/url';
import { listJobs, listRuns } from '../../api/client';
import { logBreakdown, logProblems, logSummary, searchLogs } from '../../api/logs';
import type { LogBreakdown, LogFilters, LogNames, LogProblems, LogRange, LogSummary, LogsResponse } from '../../api/logs';
import type { Job, RunSummary } from '../../api/types';
import { pageHref, queryParam } from '../../components/PageShell';
import { formatTime } from '../../format';
import { eventLabel } from './catalog';
import { useTheme } from './charts';
import LinesTable from './LinesTable';
import { Graphs, HealthStrip } from './Overview';
import type { GraphId, Pick } from './Overview';
import ProblemsView from './ProblemsView';
import RunStory, { RunPicker } from './RunStory';

export type View = 'lines' | 'problems' | 'story';
const VIEWS: View[] = ['lines', 'problems', 'story'];
const GRAPHS: GraphId[] = ['activity', 'requests', 'engine', 'calls', 'events'];
const LIVE_MS = 10000;

const RANGES: { value: LogRange; label: string }[] = [
    { value: '15m', label: '15 min' },
    { value: '1h', label: '1 hour' },
    { value: '24h', label: '24 hours' },
    { value: '7d', label: '7 days' },
];

export function initialFilters(): LogFilters {
    const range = queryParam('range') as LogRange | null;
    const level = (queryParam('level') || '').toUpperCase();
    const process = queryParam('process');
    return {
        run_id: queryParam('run_id') || '',
        job_id: queryParam('job_id') || '',
        step_id: queryParam('step_id') || '',
        event: queryParam('event') || '',
        process: process === 'engine' || process === 'rest' ? process : '',
        level: (['ERROR', 'WARNING', 'INFO', 'DEBUG'].includes(level) ? level : '') as LogFilters['level'],
        text: queryParam('text') || '',
        range: range && RANGES.some((r) => r.value === range) ? range : '24h',
    };
}

export function initialView(): View {
    const v = queryParam('view') as View | null;
    return v && VIEWS.includes(v) ? v : 'lines';
}

function initialGraph(): GraphId {
    const g = queryParam('graph') as GraphId | null;
    return g && GRAPHS.includes(g) ? g : 'activity';
}

function writeAddress(filters: LogFilters, view: View, graph: GraphId) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
        if (v && !(k === 'range' && v === '24h')) {
            params.set(k, String(v));
        }
    });
    if (view !== 'lines') {
        params.set('view', view);
    }
    if (graph !== 'activity') {
        params.set('graph', graph);
    }
    const q = params.toString();
    try {
        window.history.replaceState(null, '', q ? `?${q}` : window.location.pathname);
    } catch (e) {
        // the address only helps sharing; the page works without it
    }
}

export interface LogsApi {
    searchLogs: typeof searchLogs;
    logSummary: typeof logSummary;
    logBreakdown: typeof logBreakdown;
    logProblems: typeof logProblems;
    listJobs: () => Promise<Job[]>;
    listRuns: typeof listRuns;
}

const defaultApi: LogsApi = { searchLogs, logSummary, logBreakdown, logProblems, listJobs, listRuns };

const nowSeconds = () => Math.floor(Date.now() / 1000);

export default function LogsPage({ api = defaultApi }: { api?: LogsApi }) {
    const t = useTheme();
    const [draft, setDraft] = useState<LogFilters>(initialFilters);
    const [view, setView] = useState<View>(initialView);
    const [graph, setGraph] = useState<GraphId>(initialGraph);
    const [live, setLive] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lines, setLines] = useState<LogsResponse | null>(null);
    const [problems, setProblems] = useState<LogProblems | null>(null);
    const [story, setStory] = useState<LogsResponse | null>(null);
    const [summary, setSummary] = useState<LogSummary | null>(null);
    const [breakdown, setBreakdown] = useState<LogBreakdown | null>(null);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [runs, setRuns] = useState<RunSummary[]>([]);
    const [loadedAt, setLoadedAt] = useState(nowSeconds);
    const current = useRef({ filters: draft, view });

    useEffect(() => {
        api.listJobs().then(setJobs).catch(() => undefined);
        api.listRuns({}).then((r) => setRuns(r.slice(0, 12))).catch(() => undefined);
    }, [api]);

    const load = useCallback(
        async (filters: LogFilters, v: View, quiet = false) => {
            current.current = { filters, view: v };
            if (!quiet) {
                setBusy(true);
            }
            setError(null);
            const overall = { ...filters, event: '', text: '', level: '' as const, step_id: '' };
            const tasks: Promise<unknown>[] = [
                api.logSummary(overall).then(setSummary, () => setSummary(null)),
                api.logBreakdown(overall).then(setBreakdown, () => setBreakdown(null)),
            ];
            if (v === 'lines') {
                tasks.push(api.searchLogs(filters).then(setLines));
            } else if (v === 'problems') {
                tasks.push(api.logProblems(filters).then(setProblems));
            } else if (filters.run_id) {
                tasks.push(api.searchLogs({ run_id: filters.run_id, step_id: filters.step_id, range: filters.range === '15m' || filters.range === '1h' ? '24h' : filters.range, level: 'DEBUG', sort: 'oldest', limit: 1000 }).then(setStory));
            }
            try {
                await Promise.all(tasks);
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setLoadedAt(nowSeconds());
                if (!quiet) {
                    setBusy(false);
                }
            }
        },
        [api]
    );

    useEffect(() => {
        load(initialFilters(), initialView());
    }, [load]);

    useEffect(() => {
        if (!live) {
            return undefined;
        }
        const id = window.setInterval(() => {
            if (document.visibilityState !== 'hidden') {
                load(current.current.filters, current.current.view, true);
            }
        }, LIVE_MS);
        return () => window.clearInterval(id);
    }, [live, load]);

    const apply = (patch: Partial<LogFilters> = {}, nextView: View = view, nextGraph: GraphId = graph) => {
        const next = { ...draft, ...patch };
        setDraft(next);
        setView(nextView);
        setGraph(nextGraph);
        writeAddress(next, nextView, nextGraph);
        load(next, nextView);
    };
    const set = (patch: Partial<LogFilters>) => setDraft((d) => ({ ...d, ...patch }));
    const onFilter = (patch: Partial<LogFilters>, toStory = false) => apply(patch, toStory ? 'story' : 'lines');
    const onPick = (p: Pick) => apply(p.filters || {}, 'lines', p.graph || graph);

    const names: LogNames = {};
    jobs.forEach((j) => {
        names[j.id] = { name: j.name, steps: {} };
    });
    [lines, problems, story].forEach((r) => {
        Object.entries((r && r.names) || {}).forEach(([k, v]) => {
            names[k] = v;
        });
    });

    const chips: Array<{ key: keyof LogFilters; label: string }> = [];
    if (draft.event) {
        chips.push({ key: 'event', label: `Event: ${eventLabel(draft.event)}` });
    }
    if (draft.run_id) {
        chips.push({ key: 'run_id', label: `Run: ${draft.run_id}` });
    }
    if (draft.step_id) {
        chips.push({ key: 'step_id', label: `Step: ${draft.step_id}` });
    }
    const text = (key: 'run_id' | 'text', label: string, width: string) => (
        <div style={{ width }}>
            <ControlGroup label={label} labelFor={`logs-${key}`} labelPosition="top">
                <Text
                inputId={`logs-${key}`}
                value={(draft[key] as string) || ''}
                onChange={(_e: unknown, { value }: { value: string }) => set({ [key]: value })}
                onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && apply()}
                />
            </ControlGroup>
        </div>
    );
    const result = view === 'lines' ? lines : view === 'problems' ? problems : story;
    const notes = [...((result && result.notes) || []), ...((summary && summary.notes) || [])].filter((n, i, all) => all.indexOf(n) === i);
    const recent = runs.map((r) => ({ id: r.id, label: `${(names[r.job_id] && names[r.job_id].name) || r.job_id} · ${formatTime(r.scheduled_time)} · ${r.state}` }));

    return (
        <div>
            <p style={{ maxWidth: '900px', margin: '0 0 8px' }}>
                {'What the app itself did and why: the engine (schedules, runs, searches, conditions, actions, approvals) and the screens and API. '}
                {summary && (
                    <>
                        {`Log level is ${summary.log_level}`}
                        {summary.log_level !== 'DEBUG' ? ' (engine ticks and Splunk calls appear at Debug)' : ''}
                        {'; change it in '}
                        <Link to={pageHref('settings')}>Settings</Link>
                        {'.'}
                    </>
                )}
            </p>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <ControlGroup label="Time" labelPosition="top">
                    <RadioBar aria-label="Time" value={draft.range} onChange={(_e: unknown, { value }: { value: unknown }) => apply({ range: value as LogRange })}>
                        {RANGES.map((r) => (
                            <RadioBar.Option key={r.value} label={r.label} value={r.value} />
                        ))}
                    </RadioBar>
                </ControlGroup>
                <ControlGroup label="Job" labelFor="logs-job" labelPosition="top">
                    <Select inputId="logs-job" value={draft.job_id || ''} onChange={(_e: unknown, { value }: { value: unknown }) => apply({ job_id: String(value || '') })} filter>
                        <Select.Option value="" label="All jobs" />
                        {[...jobs]
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((j) => (
                                <Select.Option key={j.id} value={j.id} label={j.name} />
                            ))}
                    </Select>
                </ControlGroup>
                <ControlGroup label="Level" labelFor="logs-level" labelPosition="top">
                    <Select inputId="logs-level" value={draft.level || ''} onChange={(_e: unknown, { value }: { value: unknown }) => apply({ level: value as LogFilters['level'] })}>
                        <Select.Option value="" label="Info and up" />
                        <Select.Option value="ERROR" label="Errors" />
                        <Select.Option value="WARNING" label="Warnings and up" />
                        <Select.Option value="DEBUG" label="Everything" />
                    </Select>
                </ControlGroup>
                <ControlGroup label="Part" labelFor="logs-process" labelPosition="top">
                    <Select inputId="logs-process" value={draft.process || ''} onChange={(_e: unknown, { value }: { value: unknown }) => apply({ process: value as LogFilters['process'] })}>
                        <Select.Option value="" label="All" />
                        <Select.Option value="engine" label="Engine" />
                        <Select.Option value="rest" label="Screens and API" />
                    </Select>
                </ControlGroup>
                {text('text', 'Text', '180px')}
                {text('run_id', 'Run ID', '200px')}
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', paddingTop: '22px' }}>
                    <Button appearance="primary" label={busy ? 'Searching…' : 'Search'} disabled={busy} onClick={() => apply()} />
                    <Switch value="live" selected={live} appearance="toggle" onClick={() => setLive((v) => !v)}>
                        {live ? `Live (every ${LIVE_MS / 1000} s)` : 'Live'}
                    </Switch>
                </div>
            </div>
            {chips.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '8px 0 0' }}>
                    {chips.map((c) => (
                        <Chip key={c.key} value={c.key} onRequestRemove={() => apply({ [c.key]: '' } as Partial<LogFilters>)}>
                            {c.label}
                        </Chip>
                    ))}
                    <Link onClick={() => apply({ event: '', run_id: '', step_id: '', text: '', level: '', process: '', job_id: '' })}>Clear all filters</Link>
                </div>
            )}
            <HealthStrip summary={summary} breakdown={breakdown} onPick={onPick} nowEpoch={loadedAt} />
            <Graphs summary={summary} breakdown={breakdown} graph={graph} onGraph={(g) => { setGraph(g); writeAddress(draft, view, g); }} onPick={onPick} />
            <TabBar activeTabId={view} onChange={(_e: unknown, { selectedTabId }: { selectedTabId?: string }) => apply({}, (selectedTabId as View) || 'lines')}>
                <TabBar.Tab label="What happened" tabId="lines" />
                <TabBar.Tab label={problems ? `Problems (${problems.problems.length})` : 'Problems'} tabId="problems" />
                <TabBar.Tab label="Run story" tabId="story" />
            </TabBar>
            <div style={{ paddingTop: '10px' }}>
                {error && (
                    <Message type="error" appearance="default">
                        {`The logs could not be searched: ${error}`}
                    </Message>
                )}
                {notes.length > 0 && (
                    <Message type="info" appearance="default">
                        {notes.join(' ')}
                    </Message>
                )}
                {busy && !result && <WaitSpinner size="medium" />}
                {result && view !== 'story' && (
                    <p style={{ margin: '0 0 8px', fontSize: '13px', color: t.contentColorMuted }}>
                        {view === 'lines' && lines ? `${lines.lines.length} line${lines.lines.length === 1 ? '' : 's'}, newest first. Click a line for the details. ` : ''}
                        {view === 'problems' && problems ? 'Errors and warnings grouped by what went wrong, the most serious first; the search below builds this table. ' : ''}
                        <Link to={createURL('/app/search/search', { q: result.spl, earliest: result.earliest, latest: result.latest })} openInNewContext>
                            Open this search in Search
                        </Link>
                    </p>
                )}
                {view === 'lines' && lines && <LinesTable lines={lines.lines} names={names} base={lines} onFilter={onFilter} />}
                {view === 'problems' && problems && <ProblemsView problems={problems.problems} names={names} onFilter={(f) => apply(f, 'lines')} nowEpoch={loadedAt} />}
                {view === 'story' && !draft.run_id && <RunPicker runs={recent} onPick={(id) => apply({ run_id: id }, 'story')} />}
                {view === 'story' && draft.run_id && story && <RunStory runId={draft.run_id} lines={story.lines} names={names} />}
            </div>
        </div>
    );
}
