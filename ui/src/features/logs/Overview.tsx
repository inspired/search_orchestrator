/* The top of the Troubleshooting page: health tiles (engine, errors, warnings, failed
 * requests, slow requests, failed actions, failed runs), each a filter when clicked, and the
 * graphs to switch between (activity, requests, engine, Splunk calls, events). */
import React, { useMemo } from 'react';
import Link from '@splunk/react-ui/Link';
import TabBar from '@splunk/react-ui/TabBar';
import { createURL } from '@splunk/splunk-utils/url';
import type { LogBreakdown, LogFilters, LogSummary, SearchLink } from '../../api/logs';
import { eventLabel } from './catalog';
import type { Tone } from './catalog';
import { BarList, useTheme } from './charts';
import GraphDashboard from './GraphDashboard';
import type { GraphPanel } from './GraphDashboard';
import { ToneIcon, ago, toneColor } from './look';
import { paletteOf } from './palette';
import type { Palette } from './palette';

export interface Pick {
    filters?: Partial<LogFilters>;
    graph?: GraphId;
}

interface Tile {
    id: string;
    label: string;
    value: string;
    sub: string;
    tone: Tone;
    pick?: Pick;
    help: string;
}

function ms(v: number | null | undefined): string {
    if (v === null || v === undefined) {
        return '—';
    }
    return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
}

export function tiles(summary: LogSummary | null, breakdown: LogBreakdown | null, nowEpoch: number): Tile[] {
    const t = summary ? summary.totals : null;
    const engine = summary ? summary.engine : null;
    const seen = engine && engine.last_seen ? nowEpoch - engine.last_seen : null;
    const failedReq = t ? t.req_4xx + t.req_5xx : 0;
    const actionsAll = t ? t.actions_done + t.actions_failed : 0;
    const runsAll = t ? t.runs_failed + t.runs_succeeded : 0;
    const p95 = breakdown ? breakdown.requests_p95 : null;
    return [
        {
            id: 'engine',
            label: 'Engine',
            value: engine ? (engine.running ? 'Running' : 'Stopped') : '—',
            sub: seen !== null ? `last tick ${ago(seen)}` : 'never seen',
            tone: !engine ? 'muted' : engine.running ? 'ok' : 'error',
            pick: { filters: { process: 'engine', event: '', level: '' }, graph: 'engine' },
            help: 'From the engine lease: the engine renews it every tick. Stopped means no tick for 90 seconds.',
        },
        {
            id: 'errors',
            label: 'Errors',
            value: t ? String(t.error) : '—',
            sub: 'lines at level ERROR',
            tone: t && t.error ? 'error' : 'ok',
            pick: { filters: { level: 'ERROR', event: '', process: '' }, graph: 'activity' },
            help: 'Failures the app could not handle: failed ticks or requests, with a traceback.',
        },
        {
            id: 'warnings',
            label: 'Warnings',
            value: t ? String(t.warning) : '—',
            sub: 'retries and skipped work',
            tone: t && t.warning ? 'warning' : 'ok',
            pick: { filters: { level: 'WARNING', event: '', process: '' }, graph: 'activity' },
            help: 'Things that went wrong but were retried or skipped, such as a search status that could not be read.',
        },
        {
            id: 'requests',
            label: 'Failed requests',
            value: t ? String(failedReq) : '—',
            sub: t ? `of ${t.requests}${t.req_5xx ? ` · ${t.req_5xx} server error${t.req_5xx === 1 ? '' : 's'}` : ''}` : '',
            tone: t && t.req_5xx ? 'error' : failedReq ? 'warning' : 'ok',
            pick: { filters: { event: 'request', level: 'DEBUG', process: '' }, graph: 'requests' },
            help: 'Requests from the screens, the alert action and | orchestrate that answered 400 or more.',
        },
        {
            id: 'slow',
            label: 'Response time',
            value: ms(p95),
            sub: '95% answered within',
            tone: p95 === null ? 'muted' : p95 >= 5000 ? 'error' : p95 >= 2000 ? 'warning' : 'ok',
            pick: { filters: { event: 'request', level: 'DEBUG', process: '' }, graph: 'requests' },
            help: 'How long the slowest 5% of requests took. Previews and searches are slower by nature.',
        },
        {
            id: 'actions',
            label: 'Failed actions',
            value: t ? String(t.actions_failed) : '—',
            sub: actionsAll ? `of ${actionsAll} actions` : 'no actions sent',
            tone: t && t.actions_failed ? 'error' : 'ok',
            pick: { filters: { event: 'action_failed', level: '', process: '' } },
            help: 'Emails, webhooks, lookups and other actions that failed after all their retries.',
        },
        {
            id: 'schedules',
            label: 'Skipped schedules',
            value: t ? String((t.schedules_skipped || 0) + (t.schedules_missed || 0)) : '—',
            sub: t ? `${t.schedules_skipped || 0} disabled · ${t.schedules_missed || 0} missed` : '',
            tone: t && (t.schedules_skipped || t.schedules_missed) ? 'warning' : 'ok',
            pick: { filters: { event: 'schedule_skipped,schedule_missed', level: '', process: '' } },
            help: 'Scheduled times that did not get a run: the job was disabled, or nothing checked the schedule (the engine was stopped) and the catch-up setting left them out.',
        },
        {
            id: 'runs',
            label: 'Failed runs',
            value: t ? String(t.runs_failed) : '—',
            sub: runsAll ? `of ${runsAll} finished runs` : 'no finished runs',
            tone: t && t.runs_failed ? 'error' : 'ok',
            pick: { filters: { event: 'run_state', text: 'to="failed"', level: '', process: '' } },
            help: 'Runs that ended failed in this time range.',
        },
    ];
}

/** Single values in one row, as in a Splunk dashboard: a label, the value and a line under it.
 * Every value is coloured by its state with the page palette (the charts' colours) and has its
 * state's icon, so green means fine, orange a warning and red an error. */
export function HealthStrip({ summary, breakdown, onPick, nowEpoch }: { summary: LogSummary | null; breakdown: LogBreakdown | null; onPick: (p: Pick) => void; nowEpoch: number }) {
    const t = useTheme();
    const items = tiles(summary, breakdown, nowEpoch);
    return (
        <div role="list" aria-label="Health" style={{ display: 'flex', flexWrap: 'wrap', margin: '16px 0 20px', borderTop: `1px solid ${t.borderColorWeak || t.borderColor}`, borderBottom: `1px solid ${t.borderColorWeak || t.borderColor}` }}>
            {items.map((x, i) => {
                return (
                    <button
                        key={x.id}
                        type="button"
                        role="listitem"
                        data-testid={`tile-${x.id}`}
                        data-tone={x.tone}
                        title={`${x.help} Click to show these lines.`}
                        onClick={() => x.pick && onPick(x.pick)}
                        style={{
                            flex: '1 1 140px',
                            textAlign: 'left',
                            font: 'inherit',
                            color: t.contentColorDefault,
                            background: 'none',
                            border: 0,
                            borderLeft: i ? `1px solid ${t.borderColorWeak || t.borderColor}` : 0,
                            padding: '12px 16px',
                            cursor: 'pointer',
                            minWidth: 0,
                        }}
                    >
                        <div style={{ fontSize: '12px', color: t.contentColorMuted }}>{x.label}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '28px', lineHeight: 1.25, fontWeight: 400, color: toneColor(t, x.tone) }}>
                            <ToneIcon tone={x.tone} size={18} />
                            {x.value}
                        </div>
                        <div style={{ fontSize: '12px', color: t.contentColorMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.sub}</div>
                    </button>
                );
            })}
        </div>
    );
}

export type GraphId = 'activity' | 'requests' | 'engine' | 'calls' | 'events';

function Hint({ children }: { children: React.ReactNode }) {
    const t = useTheme();
    return <p style={{ color: t.contentColorMuted, fontSize: '12px', margin: '6px 0 0' }}>{children}</p>;
}

function SearchText({ link }: { link?: SearchLink }) {
    if (!link) {
        return null;
    }
    return (
        <Link to={createURL('/app/search/search', { q: link.spl, earliest: link.earliest, latest: link.latest })} openInNewContext>
            Open in Search
        </Link>
    );
}

export function Graphs({ summary, breakdown, graph, onGraph, onPick, live = false }: { summary: LogSummary | null; breakdown: LogBreakdown | null; graph: GraphId; onGraph: (g: GraphId) => void; onPick: (p: Pick) => void; live?: boolean }) {
    const t = useTheme();
    const debugOff = summary && summary.log_level !== 'DEBUG';
    const p = paletteOf(t);
    const levelPick = (key: string) => {
        const level = ({ error: 'ERROR', warning: 'WARNING', info: 'INFO', debug: 'DEBUG' } as Record<string, string>)[key];
        if (level) {
            onPick({ filters: { level: level as LogFilters['level'], event: '' } });
        }
    };
    const box: React.CSSProperties = { margin: '0 0 24px' };
    const panels = useMemo(() => graphPanels(p), [p]);
    const activity = summary ? summary.searches.activity : undefined;
    const dashboard = (id: 'activity' | 'requests' | 'engine', label: string) =>
        activity ? <GraphDashboard base={activity} panels={panels[id]} live={live} label={label} /> : null;
    return (
        <section aria-label="Graphs" style={box}>
            <TabBar activeTabId={graph} onChange={(_e: unknown, { selectedTabId }: { selectedTabId?: string }) => onGraph((selectedTabId as GraphId) || 'activity')}>
                <TabBar.Tab label="Activity" tabId="activity" />
                <TabBar.Tab label="Requests" tabId="requests" />
                <TabBar.Tab label="Engine" tabId="engine" />
                <TabBar.Tab label="Splunk calls" tabId="calls" />
                <TabBar.Tab label="Events" tabId="events" />
            </TabBar>
            <div style={{ paddingTop: '10px' }} data-testid={`graph-${graph}`}>
                {!summary && <Hint>Loading…</Hint>}
                {summary && graph === 'activity' && (
                    <>
                        {dashboard('activity', 'Log lines over time by level')}
                        <Hint>
                            {`Log lines per ${summary.span}. A spike of errors or warnings shows when something broke; a gap with no lines at all means nothing was running or the engine was down. Point at a column for its numbers; point at the graph and use the magnifying glass at its top right to open it in Search.`}
                        </Hint>
                        <div data-testid="level-links" style={{ display: 'flex', gap: '16px', fontSize: '12px', marginTop: '4px' }}>
                            {[
                                ['error', 'Show the errors'],
                                ['warning', 'Show the warnings'],
                                ['info', 'Show info and above'],
                            ].map(([key, text]) => (
                                <Link key={key} onClick={() => levelPick(key)}>
                                    {text}
                                </Link>
                            ))}
                        </div>
                    </>
                )}
                {summary && graph === 'requests' && (
                    <>
                        {dashboard('requests', 'Requests over time')}
                        <div style={{ fontSize: '12px', fontWeight: 600, margin: '12px 0 6px' }}>Slowest routes (95th percentile)</div>
                        <BarList
                            unit="ms"
                            empty="No requests in this range."
                            rows={(breakdown ? breakdown.routes : []).map((r) => ({
                                key: `${r.method} ${r.route}`,
                                label: `${r.method} ${r.route || '/'}`,
                                value: r.p95 || 0,
                                note: `${r.count} request${r.count === 1 ? '' : 's'}${r.failed ? ` · ${r.failed} failed` : ''} · max ${ms(r.max)}`,
                                color: r.failed ? p.warning : undefined,
                            }))}
                        />
                        <Hint>
                            {'Info level logs only changes and failed requests; at Debug every request is logged, reads too. '}
                            <SearchText link={breakdown ? breakdown.searches.routes : undefined} />
                        </Hint>
                    </>
                )}
                {summary && graph === 'engine' && (
                    <>
                        {dashboard('engine', 'The engine over time')}
                        <Hint>
                            {debugOff
                                ? 'Ticks are logged at Debug level only: set Log level to Debug in Settings to fill these graphs.'
                                : 'Each tick advances every active run; a tick normally takes well under a second. A gap means the engine did not tick (stopped, or another engine held the lease); slow ticks mean slow KV Store or Splunk calls (see Splunk calls).'}
                        </Hint>
                    </>
                )}
                {summary && graph === 'calls' && (
                    <>
                        <BarList
                            unit="ms"
                            empty={debugOff ? 'Splunk calls are logged at Debug level only: set Log level to Debug in Settings.' : 'No Splunk calls in this range.'}
                            rows={(breakdown ? breakdown.calls : []).map((c) => ({
                                key: `${c.method} ${c.endpoint}`,
                                label: `${c.method} ${c.endpoint}`,
                                value: c.p95 || 0,
                                note: `${c.count} call${c.count === 1 ? '' : 's'}${c.errors ? ` · ${c.errors} failed` : ''} · avg ${ms(c.avg)}`,
                                color: c.errors ? p.warning : undefined,
                            }))}
                        />
                        <Hint>
                            {'Every call the app makes to splunkd (KV Store, saved searches, search jobs), slowest first by 95th percentile. Slow KV Store calls slow down every tick and every page. '}
                            <SearchText link={breakdown ? breakdown.searches.calls : undefined} />
                        </Hint>
                    </>
                )}
                {summary && graph === 'events' && (
                    <>
                        <BarList
                            empty="No events in this range."
                            onPick={(key) => onPick({ filters: key === '(no event)' ? { event: '', level: 'WARNING' } : { event: key, level: 'DEBUG' } })}
                            rows={summary.events.map((e) => ({
                                key: e.event,
                                label: eventLabel(e.event),
                                value: e.count,
                                note: e.event,
                                color: e.levels.ERROR ? p.error : e.levels.WARNING ? p.warning : undefined,
                            }))}
                        />
                        <Hint>
                            {'What the app did most, in this range. Click one to show its lines. '}
                            <SearchText link={summary.searches.counts} />
                        </Hint>
                    </>
                )}
            </div>
        </section>
    );
}

/** The panels of each graph tab, in the page palette's colours. */
export function graphPanels(p: Palette): Record<'activity' | 'requests' | 'engine', GraphPanel[]> {
    return {
        activity: [
            {
                id: 'levels',
                title: 'Log lines over time by level',
                kind: 'column',
                stacked: true,
                height: 260,
                series: [
                    { key: 'error', label: 'Errors', color: p.error },
                    { key: 'warning', label: 'Warnings', color: p.warning },
                    { key: 'info', label: 'Info', color: p.info },
                    { key: 'debug', label: 'Debug', color: p.muted },
                ],
            },
        ],
        requests: [
            {
                id: 'requests',
                title: 'Requests over time by result',
                kind: 'column',
                stacked: true,
                height: 230,
                series: [
                    { key: 'req_5xx', label: 'Server errors (5xx)', color: p.error },
                    { key: 'req_4xx', label: 'Refused (4xx)', color: p.warning },
                    { key: 'req_ok', label: 'OK', color: p.ok },
                ],
            },
            { id: 'p95', title: 'Response time, 95th percentile', kind: 'line', unit: 'ms', height: 200, series: [{ key: 'req_p95', label: '95th percentile', color: p.info }] },
        ],
        engine: [
            {
                id: 'ticks',
                title: 'Tick time',
                kind: 'line',
                unit: 'ms',
                height: 210,
                series: [
                    { key: 'tick_avg', label: 'Average', color: p.info },
                    { key: 'tick_max', label: 'Slowest', color: p.warning, dashed: true },
                ],
            },
            { id: 'active', title: 'Active runs', kind: 'line', height: 190, series: [{ key: 'active_runs', label: 'Active runs', color: p.info }] },
        ],
    };
}
