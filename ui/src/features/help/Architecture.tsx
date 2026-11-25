/* How it works: a technical drawing of the app for the help page. Three parts:
 *  1. A component map in areas: the browser, then two columns (what runs when you use the
 *     app, and the engine that runs on its own), then the gateway down to storage and Splunk.
 *     Only the hand-offs between areas are drawn (a few arrows); click a part to light up
 *     what it talks to and read what it does, which files hold it and its calls.
 *  2. The life of a run, as a sequence diagram across the parts.
 *  3. Every Python module in bin/so with what it does.
 * Everything scales to the help column (no sideways scrolling). Colours come from theme
 * tokens only, so it follows light and dark mode. */
import React, { useState } from 'react';
import TabBar from '@splunk/react-ui/TabBar';
import { useTheme } from './illustrationKit';
import type { Theme } from './illustrationKit';

type Layer = 'browser' | 'entry' | 'logic' | 'storage' | 'splunk';

export interface Part {
    id: string;
    label: string;
    sub: string;
    layer: Layer;
    x: number;
    y: number;
    w: number;
    h?: number;
    files: string[];
    text: string;
}

export interface Link {
    from: string;
    to: string;
    label: string;
}

export const WIDTH = 900;
export const HEIGHT = 560;
const BOX_H = 46;
/** Rough text widths, for the fit check in the tests: bold 13 px label, 10.5 px mono sub. */
export const LABEL_PX = 7.6;
export const SUB_PX = 6.4;
export const PAD_PX = 22;

/** The areas drawn behind the parts, each with its title. */
export const AREAS: { x: number; y: number; w: number; h: number; label: string }[] = [
    { x: 6, y: 6, w: 888, h: 86, label: 'In the browser (Splunk Web)' },
    { x: 6, y: 110, w: 440, h: 252, label: 'When you use the app' },
    { x: 454, y: 110, w: 440, h: 252, label: 'On its own, every 5 seconds' },
    { x: 6, y: 384, w: 888, h: 170, label: 'Through the gateway to splunkd' },
];

/** The hand-offs between areas: the only arrows drawn. */
export const ARROWS: { x1: number; y1: number; x2: number; y2: number; label: string; labelY?: number }[] = [
    { x1: 226, y1: 92, x2: 226, y2: 188, label: 'HTTPS /orchestrator', labelY: 105 },
    { x1: 118, y1: 180, x2: 118, y2: 188, label: '' },
    { x1: 334, y1: 180, x2: 334, y2: 188, label: '' },
    { x1: 226, y1: 236, x2: 226, y2: 244, label: '' },
    { x1: 674, y1: 236, x2: 674, y2: 244, label: '' },
    { x1: 226, y1: 348, x2: 226, y2: 406, label: 'as you, or as the system' },
    { x1: 674, y1: 348, x2: 674, y2: 406, label: 'as the job owner' },
];

export const PARTS: Part[] = [
    // Browser
    { id: 'ui_build', label: 'Jobs and builder', sub: 'pages/jobs, builder', layer: 'browser', x: 16, y: 34, w: 168, files: ['ui/src/pages/jobs', 'ui/src/pages/builder', 'ui/src/features/builder', 'ui/src/features/simple'], text: 'React pages where you list, build and save jobs: the Jobs list (next run and how soon, the newest runs, the last run against its usual time, warnings about missing or disabled jobs a job starts or follows, export and import of many jobs, and run, enable, disable, tag or delete many at once), and three builder views of one job: Simple (a list), Standard (steps only, with a Triggers tab and step actions) and Advanced (every node). Preview and Test condition run real searches through the API.' },
    { id: 'ui_runs', label: 'Runs and run page', sub: 'pages/runs, run', layer: 'browser', x: 192, y: 34, w: 168, files: ['ui/src/pages/runs', 'ui/src/pages/run', 'ui/src/features/run', 'ui/src/components/ApprovalAlert.tsx'], text: 'Follow runs: grouped by job, timeline, graph, performance, approvals. Polls GET runs and runs/<id> every 5 seconds while a run is active; Approve, Pause, Re-run and Cancel post commands, one run at a time or for many ticked runs at once (POST runs/bulk).' },
    { id: 'ui_plan', label: 'Calendar views', sub: 'calendar, dependencies', layer: 'browser', x: 368, y: 34, w: 168, files: ['ui/src/pages/calendar', 'ui/src/pages/dependencies', 'ui/src/features/calendar'], text: 'Day, week and month views of schedules, runs and backfills (GET calendar), and the graph of which jobs start which.' },
    { id: 'ui_admin', label: 'Settings and logs', sub: 'pages/settings, logs', layer: 'browser', x: 544, y: 34, w: 168, files: ['ui/src/pages/settings', 'ui/src/pages/logs', 'ui/src/features/logs'], text: 'Limits, retention, building blocks, fallback, webhook destinations and the log level (admins), and Troubleshooting: health values (engine, errors, warnings, failed requests, response time, failed actions, skipped schedules, failed runs), graphs (a small Dashboard Studio dashboard drawn by Splunk\'s dashboard-core: Splunk runs a base search and a chain search per graph from the browser, with Open in search in the action bar of each panel), every log line in words with why and what to do, problems grouped by cause and the story of a run.' },
    { id: 'ui_dash', label: 'Run health', sub: 'run_health page', layer: 'browser', x: 720, y: 34, w: 164, files: ['pages/run_health', 'so/run_health_api.py', 'default/macros.conf'], text: 'The app\'s own page, like Troubleshooting: tiles, Splunk charts and tables per section (runs, steps, actions, late runs, engine, performance). The REST endpoint runs its searches as the viewer: audit events in _audit, and _internal and _introspection, so Splunk\'s index access decides what each viewer sees.' },
    // When you use the app
    { id: 'alert', label: 'Alert action', sub: 'start_orchestrator_job.py', layer: 'entry', x: 16, y: 134, w: 204, files: ['bin/start_orchestrator_job.py', 'default/alert_actions.conf'], text: '"Start orchestrator job" on any alert: posts to the REST endpoint over loopback with the alert owner\'s session, so the same checks apply as on the screens.' },
    { id: 'cmd', label: '| orchestrate', sub: 'orchestrate.py', layer: 'entry', x: 232, y: 134, w: 204, files: ['bin/orchestrate.py', 'default/commands.conf', 'default/searchbnf.conf'], text: 'start, status, cancel, rerun, approve, backfill, jobs and selftest from a search. Each calls the REST endpoint over loopback as the person running the search.' },
    { id: 'rest', label: 'REST handler', sub: 'orchestrator_rest.py · /orchestrator', layer: 'entry', x: 16, y: 190, w: 420, files: ['bin/orchestrator_rest.py', 'default/restmap.conf', 'default/web.conf'], text: 'A persistent splunkd handler at /services/orchestrator. Every screen call lands here with the caller\'s session and the system session; it builds two gateways (as the user, as the system) and hands the request to the API router. Logs one line per request.' },
    { id: 'api', label: 'API router', sub: 'api.py, authz, *_api.py', layer: 'logic', x: 16, y: 246, w: 204, files: ['so/api.py', 'so/authz.py', 'so/approval_api.py', 'so/backfill_api.py', 'so/calendar_api.py', 'so/history_api.py', 'so/snippets.py', 'so/follows.py', 'so/blocks.py'], text: 'Matches the path to a route, checks capabilities and job permissions (authz), and runs the route: jobs (with their tags and warnings, refusing building blocks an admin turned off), follows, runs and actions on many runs, approvals, backfills, calendar, versions, snippets, settings (with the events scanned limit), destinations, and the schedule preview with other jobs in the same minute.' },
    { id: 'model', label: 'Validation', sub: 'model.py, tokens.py', layer: 'logic', x: 232, y: 246, w: 204, files: ['so/model.py', 'so/tokens.py', 'so/expr.py', 'so/history.py', 'so/hidden.py', 'so/names.py'], text: 'Checks a job before it is saved: steps, lines, cycles, triggers, tokens, parameters and conditions. Saving keeps a version and writes one hidden saved search per step.' },
    { id: 'preview', label: 'Preview and test', sub: 'preview_api, condition_test', layer: 'logic', x: 16, y: 302, w: 204, files: ['so/preview_api.py', 'so/preview.py', 'so/condition_test.py', 'so/output_view.py'], text: 'Runs a step\'s search, a condition or a read-only view of an output (lookup, summary index, email, event) as you, with the tokens filled, and returns the rows.' },
    { id: 'insight', label: 'Why and how fast', sub: 'queue_info, perf, logs_api', layer: 'logic', x: 232, y: 302, w: 204, files: ['so/queue_info.py', 'so/perf.py', 'so/logs_api.py', 'so/run_health_api.py', 'so/schedule.py', 'so/schedule_api.py', 'so/saturation_api.py'], text: 'Why a run is queued or a step waits (from the lease and the other runs), the Runs timeline and busy times (with every Splunk search against splunkd\'s limit), what each search cost (engine numbers, _audit and _introspection), the Run health sections (audit events, splunkd.log and _introspection searched as the viewer), and the Troubleshooting routes: the log lines with their fields and names, a summary for the health values and graphs, the slowest routes and splunkd calls, and errors grouped into problems by the search itself (stats by signature), so Search shows the same table.' },
    // On its own
    { id: 'engine_in', label: 'Engine process', sub: 'orchestrator_engine.py · modular input', layer: 'entry', x: 464, y: 190, w: 420, files: ['bin/orchestrator_engine.py', 'default/inputs.conf'], text: 'One long-running modular input. Ticks the engine every 5 seconds, reloads its session key when it expires, and writes audit events through the modular input stream. On a cluster only the lease holder works; the others wait.' },
    { id: 'tick', label: 'Engine tick', sub: 'engine.py, lease.py', layer: 'logic', x: 464, y: 246, w: 204, files: ['so/engine.py', 'so/lease.py'], text: 'Each tick: take or renew the lease, fire cron (logging a disabled job\'s skipped slot and slots missed while the engine was down), apply commands (pause, resume, cancel, re-run, approve), feed backfills, promote queued runs (logging why a run waits), advance every active run (logging a step that waits for a search slot), pump actions, prune old runs, and every 5 minutes log a heartbeat.' },
    { id: 'sched', label: 'Scheduler', sub: 'scheduler, cron, backfill', layer: 'logic', x: 680, y: 246, w: 204, files: ['so/scheduler.py', 'so/cron.py', 'so/backfill.py', 'so/deadline.py'], text: 'Finds due cron slots in the job\'s time zone, catches up missed ones, plans backfills and creates runs (one per slot; the queue cap is checked), each with its deadline. Run now from the API creates runs here too.' },
    { id: 'steps', label: 'Steps and conditions', sub: 'state.py, expr.py, approval', layer: 'logic', x: 464, y: 302, w: 204, files: ['so/state.py', 'so/expr.py', 'so/approval.py', 'so/tokens.py'], text: 'The pure evaluator: from each step\'s state and the lines (success, failure, always, if, delayed, late), decides which steps start, wait, are skipped or fail. Conditions are evaluated safely; approval steps wait for a decision or time out.' },
    { id: 'actions', label: 'Actions', sub: 'actions.py, presets.py', layer: 'logic', x: 680, y: 302, w: 204, files: ['so/actions.py', 'so/presets.py', 'so/alert_forms.py'], text: 'The action outbox (so_action_runs): email, webhooks with Slack, Teams, PagerDuty and ServiceNow presets, lookups, summary index, events, alert actions and starting other jobs. Retries (3, from 30 s, or what the action sets), falls back to the fallback notification, and tells the people who follow the job.' },
    // Through the gateway
    { id: 'gateway', label: 'Gateway', sub: 'gateway.py, store.py · every call to splunkd', layer: 'storage', x: 16, y: 408, w: 868, h: 30, files: ['so/gateway.py', 'so/store.py'], text: 'The only door to splunkd: KV Store reads and writes (store.py over the so_* collections), saved searches, search jobs, secrets and email. Times out within the engine lease; logs each call at debug level.' },
    { id: 'kv', label: 'KV Store', sub: '12 so_* collections', layer: 'storage', x: 16, y: 448, w: 284, files: ['so_jobs', 'so_job_versions', 'so_runs', 'so_step_runs', 'so_action_runs', 'so_commands', 'so_locks', 'so_settings', 'so_backfills', 'so_snippets', 'so_follows', 'so_selftest'], text: 'Everything the app remembers: jobs and their versions, runs and step attempts, the action outbox, commands from the screens, the engine lease, settings, backfills, snippets and who follows which job.' },
    { id: 'saved', label: 'Hidden saved searches', sub: 'one private search per step', layer: 'storage', x: 308, y: 448, w: 284, files: ['so/hidden.py', 'so/names.py'], text: 'Each step\'s SPL is a private saved search owned by the job owner, so a step runs with the owner\'s permissions. The engine dispatches it with the run\'s tokens as arguments.' },
    { id: 'secrets', label: 'Secrets', sub: 'storage/passwords', layer: 'storage', x: 600, y: 448, w: 284, files: ['storage/passwords (realm search_orchestrator)'], text: 'Webhook URLs and headers are kept encrypted in Splunk\'s password store, never in KV Store or logs.' },
    { id: 'search', label: 'Search jobs', sub: 'dispatch and poll', layer: 'splunk', x: 16, y: 502, w: 168, files: ['saved/searches/<name>/dispatch', 'search/jobs/<sid>'], text: 'Splunk runs each step as a normal search job. The engine polls its status every tick and reads the result count and the first row for tokens.' },
    { id: 'out', label: 'Outside the app', sub: 'email, webhook, lookup', layer: 'splunk', x: 192, y: 502, w: 168, files: ['sendemail', 'Slack, Teams, PagerDuty, ServiceNow, webhooks', 'outputlookup, collect'], text: 'Where actions land: emails, webhook posts (with presets), lookups, summary indexes, events, alert actions, and other jobs started by a chain.' },
    { id: 'audit', label: 'index=_audit', sub: 'audit events', layer: 'splunk', x: 368, y: 502, w: 168, files: ['so/audit.py', 'default/inputs.conf'], text: 'One JSON event per change (sourcetype orchestrator:audit): job saved, run created, step dispatched, approval decided, action done, and more. Splunk\'s own audit index, so by default only admins may search it. The run health dashboard and your own searches read it.' },
    { id: 'internal', label: '_internal', sub: 'app log files', layer: 'splunk', x: 544, y: 502, w: 168, files: ['so/logs.py', '$SPLUNK_HOME/var/log/splunk/search_orchestrator.<process>.log', 'default/savedsearches.conf (health alerts)'], text: 'The troubleshooting logs: one key=value file per process (engine, rest), sourcetype orchestrator:log. Every audit event (failures at WARNING), request and error, why a job did not start (schedule_skipped, schedule_missed, run_waiting, step_waiting, completion_not_fired), the engine heartbeat and, at debug level, each tick, search status and splunkd call. Three app health alerts (savedsearches.conf, off until an admin turns them on) watch these lines: engine not running, missed schedules, errors.' },
    { id: 'intro', label: '_introspection', sub: 'and _audit: CPU, time', layer: 'splunk', x: 720, y: 502, w: 164, files: ['index=_introspection', 'index=_audit'], text: 'Read on request for the Performance tab: peak CPU and memory of each search process, and run numbers for old steps.' },
];

/** Who calls whom: shown when a part is clicked (lit parts and the details list). */
export const LINKS: Link[] = [
    { from: 'ui_build', to: 'rest', label: 'jobs, preview' },
    { from: 'ui_runs', to: 'rest', label: 'runs, commands' },
    { from: 'ui_plan', to: 'rest', label: 'calendar' },
    { from: 'ui_admin', to: 'rest', label: 'settings, logs' },
    { from: 'ui_dash', to: 'rest', label: 'run health' },
    { from: 'alert', to: 'rest', label: 'loopback POST' },
    { from: 'cmd', to: 'rest', label: 'loopback calls' },
    { from: 'rest', to: 'api', label: 'handle()' },
    { from: 'api', to: 'model', label: 'validate, save' },
    { from: 'api', to: 'preview', label: 'preview' },
    { from: 'api', to: 'insight', label: 'why, perf, logs' },
    { from: 'insight', to: 'audit', label: 'run health searches' },
    { from: 'api', to: 'sched', label: 'run now' },
    { from: 'api', to: 'gateway', label: 'KV (system session)' },
    { from: 'model', to: 'saved', label: 'step searches' },
    { from: 'preview', to: 'search', label: 'as you' },
    { from: 'insight', to: 'intro', label: 'CPU, memory' },
    { from: 'insight', to: 'internal', label: 'log lines' },
    { from: 'engine_in', to: 'tick', label: 'every 5 s' },
    { from: 'tick', to: 'sched', label: 'cron due' },
    { from: 'tick', to: 'steps', label: 'evaluate' },
    { from: 'tick', to: 'actions', label: 'pump the outbox' },
    { from: 'tick', to: 'gateway', label: 'lease, runs' },
    { from: 'sched', to: 'kv', label: 'queued run' },
    { from: 'gateway', to: 'kv', label: 'read, write' },
    { from: 'steps', to: 'saved', label: 'dispatch' },
    { from: 'saved', to: 'search', label: 'search job' },
    { from: 'actions', to: 'out', label: 'send' },
    { from: 'actions', to: 'secrets', label: 'webhook URLs' },
    { from: 'tick', to: 'audit', label: 'audit events' },
    { from: 'api', to: 'audit', label: 'audit events' },
    { from: 'tick', to: 'internal', label: 'log lines' },
    { from: 'rest', to: 'internal', label: 'log lines' },
];

const byId = new Map(PARTS.map((p) => [p.id, p]));

const LAYER_TOKEN: Record<Layer, string> = {
    browser: 'statusColorInfo',
    entry: 'statusColorMedium',
    logic: 'statusColorNormal',
    storage: 'contentColorMuted',
    splunk: 'statusColorLow',
};

function ComponentMap({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
    const t = useTheme();
    const near = new Set<string>();
    LINKS.forEach((l) => {
        if (l.from === selected || l.to === selected) {
            near.add(l.from);
            near.add(l.to);
        }
    });
    const accent = t.contentColorActive || t.statusColorInfo;
    const muted = t.contentColorMuted;
    return (
        <svg
            role="img"
            aria-label="Component map of Search Orchestrator: the browser pages, what runs when you use the app, the engine that runs on its own, and the gateway to storage and Splunk"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            style={{ width: '100%', height: 'auto', display: 'block' }}
        >
            <defs>
                <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill={muted} />
                </marker>
            </defs>
            {AREAS.map((a) => (
                <g key={a.label}>
                    <rect x={a.x} y={a.y} width={a.w} height={a.h} rx={8} fill="none" stroke={t.borderColorWeak || t.borderColor} strokeDasharray="4 4" />
                    <text x={a.x + 10} y={a.y + 17} fontSize={12} fontWeight={600} fill={muted} fontFamily={t.fontFamily}>
                        {a.label}
                    </text>
                </g>
            ))}
            {ARROWS.map((a) => (
                <g key={`${a.x1},${a.y1}`} data-testid="arch-arrow">
                    <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={muted} strokeWidth={1.6} markerEnd="url(#arch-arrow)" />
                    {a.label && (
                        <text
                            x={a.x1 + 8}
                            y={a.labelY ?? (a.y1 + a.y2) / 2 + 4}
                            fontSize={10.5}
                            fill={muted}
                            stroke={t.backgroundColorSection || t.backgroundColor}
                            strokeWidth={4}
                            paintOrder="stroke"
                            fontFamily={t.fontFamily}
                        >
                            {a.label}
                        </text>
                    )}
                </g>
            ))}
            {PARTS.map((p) => {
                const h = p.h || BOX_H;
                const isSel = selected === p.id;
                const lit = near.has(p.id) && !isSel;
                const dim = selected !== null && !isSel && !lit;
                const color = t[LAYER_TOKEN[p.layer]] || muted;
                const flat = h < BOX_H;
                return (
                    <g
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSel}
                        aria-label={`${p.label}: ${p.sub}`}
                        data-testid={`arch-part-${p.id}`}
                        data-lit={lit ? 'true' : 'false'}
                        onClick={() => onSelect(isSel ? null : p.id)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSelect(isSel ? null : p.id);
                            }
                        }}
                        style={{ cursor: 'pointer', opacity: dim ? 0.3 : 1, outline: 'none' }}
                    >
                        <rect
                            x={p.x}
                            y={p.y}
                            width={p.w}
                            height={h}
                            rx={6}
                            fill={t.backgroundColorPopup || t.backgroundColor}
                            stroke={isSel || lit ? accent : color}
                            strokeWidth={isSel ? 3 : lit ? 2.2 : 1.4}
                        />
                        <rect x={p.x} y={p.y} width={5} height={h} rx={2} fill={color} />
                        {flat ? (
                            <text x={p.x + 14} y={p.y + h / 2 + 4} fontSize={13} fill={t.contentColorDefault} fontFamily={t.fontFamily}>
                                <tspan fontWeight={600}>{p.label}</tspan>
                                <tspan dx={10} fontSize={10.5} fill={muted} fontFamily={t.fontFamilyMono || 'monospace'}>
                                    {p.sub}
                                </tspan>
                            </text>
                        ) : (
                            <>
                                <text x={p.x + 14} y={p.y + 20} fontSize={13} fontWeight={600} fill={t.contentColorDefault} fontFamily={t.fontFamily}>
                                    {p.label}
                                </text>
                                <text x={p.x + 14} y={p.y + 37} fontSize={10.5} fill={muted} fontFamily={t.fontFamilyMono || 'monospace'}>
                                    {p.sub}
                                </text>
                            </>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}

function Details({ id }: { id: string | null }) {
    const t = useTheme();
    const p = id ? byId.get(id) : undefined;
    if (!p) {
        return (
            <p style={{ color: t.contentColorMuted, margin: '8px 0' }}>
                Arrows show the hand-offs between areas. Click a part to light up the parts it talks to and read what it does.
            </p>
        );
    }
    const out = LINKS.filter((l) => l.from === p.id);
    const into = LINKS.filter((l) => l.to === p.id);
    const name = (pid: string) => (byId.get(pid) as Part).label;
    return (
        <div data-testid="arch-details" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', margin: '8px 0', fontSize: '13px' }}>
            <div style={{ flex: '2 1 320px', minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '15px' }}>{p.label}</div>
                <p style={{ margin: '4px 0 8px' }}>{p.text}</p>
                <div style={{ color: t.contentColorMuted }}>Files and names</div>
                <ul style={{ margin: '2px 0 0', paddingLeft: '18px', fontFamily: t.fontFamilyMono || 'monospace', fontSize: '12px', overflowWrap: 'anywhere' }}>
                    {p.files.map((f) => (
                        <li key={f}>{f}</li>
                    ))}
                </ul>
            </div>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                {into.length > 0 && (
                    <>
                        <div style={{ color: t.contentColorMuted }}>Called by</div>
                        <ul style={{ margin: '2px 0 8px', paddingLeft: '18px' }}>
                            {into.map((l) => (
                                <li key={l.from}>{`${name(l.from)} (${l.label})`}</li>
                            ))}
                        </ul>
                    </>
                )}
                {out.length > 0 && (
                    <>
                        <div style={{ color: t.contentColorMuted }}>Calls</div>
                        <ul style={{ margin: '2px 0 0', paddingLeft: '18px' }}>
                            {out.map((l) => (
                                <li key={l.to}>{`${name(l.to)} (${l.label})`}</li>
                            ))}
                        </ul>
                    </>
                )}
            </div>
        </div>
    );
}

// -- the life of a run ----------------------------------------------------------

const LANES = ['You (browser)', 'REST and API', 'KV Store', 'Engine tick', 'Splunk search', 'Outside'];

export const LIFE: { from: number; to: number; text: string }[] = [
    { from: 0, to: 1, text: '1  Save the job (PUT jobs/<id>)' },
    { from: 1, to: 2, text: '2  Validate; store the job and a version' },
    { from: 1, to: 4, text: '3  Write one hidden saved search per step' },
    { from: 3, to: 2, text: '4  Tick: take the lease, cron slot due → insert a queued run' },
    { from: 3, to: 2, text: '5  Promote: one run per job, within the search limits → running' },
    { from: 3, to: 4, text: '6  Dispatch the ready steps’ saved searches, tokens filled' },
    { from: 4, to: 3, text: '7  Poll each tick: done, result count, first row' },
    { from: 3, to: 3, text: '8  Evaluate lines and conditions → next steps (back to 6)' },
    { from: 3, to: 2, text: '9  Queue actions in the outbox (so_action_runs)' },
    { from: 3, to: 5, text: '10 Send: email, webhook, lookup, summary index, start job' },
    { from: 0, to: 1, text: '11 Follow: GET runs/<id> every 5 s; Approve → so_commands' },
    { from: 3, to: 2, text: '12 Next tick applies the command; the run ends; chained jobs queue' },
    { from: 3, to: 3, text: '13 Anything that did not start says why in the log: skipped or missed schedule, a wait' },
    { from: 3, to: 4, text: '14 Every 5 min a heartbeat (ticks, average and slowest, most runs at once); the Engine graphs and the health alerts read it' },
];

function LifeOfARun() {
    const t = useTheme();
    const laneW = 146;
    const left = 12;
    const top = 40;
    const rowH = 34;
    const height = top + LIFE.length * rowH + 30;
    const x = (i: number) => left + i * laneW + laneW / 2;
    const ink = t.contentColorDefault;
    return (
        <svg role="img" aria-label="The life of a run, step by step, across the browser, the API, KV Store, the engine, Splunk search and the outside world" viewBox={`0 0 ${left * 2 + laneW * LANES.length} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
            <defs>
                <marker id="life-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill={t.statusColorInfo || ink} />
                </marker>
            </defs>
            {LANES.map((name, i) => (
                <g key={name}>
                    <rect x={x(i) - 68} y={6} width={136} height={24} rx={5} fill={t.backgroundColorPopup || t.backgroundColor} stroke={t.borderColor} />
                    <text x={x(i)} y={22} textAnchor="middle" fontSize={12} fontWeight={600} fill={ink} fontFamily={t.fontFamily}>
                        {name}
                    </text>
                    <line x1={x(i)} y1={30} x2={x(i)} y2={height - 10} stroke={t.borderColorWeak || t.borderColor} strokeDasharray="3 4" />
                </g>
            ))}
            {LIFE.map((m, i) => {
                const y = top + i * rowH + 16;
                const self = m.from === m.to;
                const x1 = x(m.from);
                const x2 = x(m.to);
                const textX = self ? x1 + 40 : Math.min(x1, x2) + 8;
                return (
                    <g key={m.text}>
                        {self ? (
                            <path d={`M${x1},${y - 6} h30 v12 h-26`} fill="none" stroke={t.statusColorInfo || ink} strokeWidth={1.6} markerEnd="url(#life-arrow)" />
                        ) : (
                            <line x1={x1} y1={y} x2={x2 + (x2 > x1 ? -4 : 4)} y2={y} stroke={t.statusColorInfo || ink} strokeWidth={1.6} markerEnd="url(#life-arrow)" />
                        )}
                        <text
                            x={textX}
                            y={y - 5}
                            fontSize={11}
                            fill={ink}
                            stroke={t.backgroundColorSection || t.backgroundColor}
                            strokeWidth={3}
                            paintOrder="stroke"
                            fontFamily={t.fontFamily}
                        >
                            {m.text}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

// -- every module ----------------------------------------------------------------

export const MODULES: Array<[string, string, string]> = [
    ['orchestrator_engine.py', 'Engine', 'The modular input: ticks the engine, reloads an expired session, releases the lease on stop.'],
    ['orchestrator_rest.py', 'Ways in', 'The REST handler: two gateways per request, the API router, one log line per request.'],
    ['start_orchestrator_job.py', 'Ways in', 'The alert action: starts a job through the REST endpoint as the alert owner.'],
    ['orchestrate.py', 'Ways in', 'The | orchestrate search command: start, status, cancel, rerun, approve, backfill, jobs, selftest.'],
    ['so/api.py', 'API', 'Routes, permission checks, jobs (and their warnings), runs (and runs/bulk), settings, destinations, health, me.'],
    ['so/authz.py', 'API', 'Who may view, build, run, approve and administer, from capabilities, roles and job sharing.'],
    ['so/approval_api.py · approval.py', 'API · Engine', 'Approve or reject a step; the approval step’s shape, timeout and approver roles.'],
    ['so/backfill_api.py · backfill.py', 'API · Engine', 'Create, list and cancel backfills; plan the slots and feed them to the engine a few at a time.'],
    ['so/calendar_api.py', 'API', 'Schedules, runs and backfills for a day, week or month.'],
    ['so/history_api.py · history.py', 'API', 'Version history: every save is a version; compare and restore.'],
    ['so/snippets.py', 'API', 'Saved sub-flows shared between builders.'],
    ['so/follows.py', 'API', 'Following a job: the follow routes, and which followers to tell when a job fails, is late, is delayed or succeeds.'],
    ['so/blocks.py', 'API', 'Building blocks an admin turned off in Settings: which node kinds a job uses, and refusing a save that adds one that is off (jobs that already use it keep it).'],
    ['so/preview_api.py · preview.py', 'API', 'Preview a step’s search as you, with tokens from earlier previews.'],
    ['so/condition_test.py', 'API', 'Test a condition against a preview’s rows.'],
    ['so/output_view.py', 'API', 'Read-only view of what a write step or action produced.'],
    ['so/queue_info.py', 'API', 'Why a run is queued or a step waits; whether the engine is running.'],
    ['so/perf.py', 'API', 'Runtime, events scanned, results, disk, CPU and memory per step.'],
    ['so/schedule.py', 'API', 'Projects every job\'s runs over a window (past, running and scheduled, each scheduled run as long as its steps last took) and the concurrent searches they add up to; suggests a quieter start time.'],
    ['so/schedule_api.py', 'API', 'The Runs timeline (GET schedule) and the busy-times strip under a schedule (POST schedule/preview); jobs the user may not see are listed as hidden ones.'],
    ['so/saturation_api.py', 'API', "Every Splunk search on the timeline (GET schedule/splunk): what ran, from _audit, Splunk's scheduled saved searches projected from their schedule and usual runtime, and splunkd's own search limits; searched as the viewer, counts only."],
    ['so/run_health_api.py', 'API', 'The Run health page (GET runhealth/<section>): its searches of the audit events, splunkd.log and _introspection, run as the viewer and summed up per section.'],
    ['so/logs_api.py · logs.py', 'API · All', 'The troubleshooting logs: files, key=value lines, failures at WARNING, level from Settings; the logs, summary, breakdown and problems routes.'],
    ['so/model.py', 'Validation', 'Job model: validation, order of steps, triggers and defaults.'],
    ['so/tokens.py', 'Validation', 'Tokens such as $step.first.field$, saved-search arguments, parameter checks.'],
    ['so/expr.py', 'Validation · Engine', 'The safe expression language for conditions and run when.'],
    ['so/hidden.py · names.py', 'Storage', 'The hidden saved searches the app owns, and their names.'],
    ['so/engine.py', 'Engine', 'The tick: cron, commands, backfills, promotion, advancing runs, dispatch and poll (with the events scanned limit), conditions, actions, pruning, the 5-minute heartbeat.'],
    ['so/state.py', 'Engine', 'The pure run-state evaluator: which steps start, wait, skip or fail.'],
    ['so/scheduler.py · cron.py', 'Engine', 'Cron slots in a time zone, catch-up and run creation with the queue cap.'],
    ['so/deadline.py', 'Engine', 'Finish-by and finish-within deadlines, and Late alerts.'],
    ['so/lease.py', 'Engine', 'The engine leader lease in so_locks: one engine works at a time.'],
    ['so/actions.py · presets.py · alert_forms.py', 'Engine', 'The action outbox: email, webhooks with presets, lookups, summary index, events, alert actions, start job.'],
    ['so/gateway.py', 'Storage', 'Every call to splunkd: KV Store, saved searches, search jobs, secrets, email.'],
    ['so/store.py', 'Storage', 'The so_* collections as functions: jobs, runs, step runs, commands, settings.'],
    ['so/audit.py', 'Storage', 'Audit events to index=_audit, sourcetype orchestrator:audit (and a copy to the log file).'],
    ['so/selftest.py', 'Tools', 'Built-in self-test jobs and the server probe (| orchestrate selftest).'],
];

function ModuleTable({ t }: { t: Theme }) {
    return (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <thead>
                <tr>
                    {['File', 'Part', 'What it does'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: `1px solid ${t.borderColor}`, color: t.contentColorMuted, width: h === 'What it does' ? undefined : '1%', whiteSpace: 'nowrap' }}>
                            {h}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {MODULES.map(([file, part, text]) => (
                    <tr key={file} style={{ borderTop: `1px solid ${t.borderColorWeak || t.borderColor}` }}>
                        <td style={{ padding: '6px 8px', fontFamily: t.fontFamilyMono || 'monospace', fontSize: '12px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                            {file.split(' · ').map((f, i) => (
                                <div key={f}>{i && file.startsWith('so/') ? `so/${f}` : f}</div>
                            ))}
                        </td>
                        <td style={{ padding: '6px 8px', color: t.contentColorMuted, verticalAlign: 'top', fontSize: '12px' }}>{part}</td>
                        <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>{text}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

type View = 'parts' | 'life' | 'modules';

export default function Architecture() {
    const t = useTheme();
    const [selected, setSelected] = useState<string | null>(null);
    const [view, setView] = useState<View>('parts');
    const box: React.CSSProperties = {
        margin: '8px 0 16px',
        padding: '12px 14px',
        background: t.backgroundColorSection || t.backgroundColor,
        border: `1px solid ${t.borderColorWeak || t.borderColor}`,
        borderRadius: '8px',
    };
    const h = { fontWeight: 600, fontSize: '14px', margin: '0 0 6px' } as React.CSSProperties;
    return (
        <div data-testid="help-architecture">
            <TabBar activeTabId={view} onChange={(_e: unknown, { selectedTabId }: { selectedTabId?: string }) => setView((selectedTabId as View) || 'parts')}>
                <TabBar.Tab tabId="parts" label="The parts" />
                <TabBar.Tab tabId="life" label="The life of a run" />
                <TabBar.Tab tabId="modules" label={`Every module (${MODULES.length})`} />
            </TabBar>
            {view === 'parts' && (
                <figure data-testid="help-figure" style={box}>
                    <div style={h}>The parts and how they call each other</div>
                    <ComponentMap selected={selected} onSelect={setSelected} />
                    <Details id={selected} />
                </figure>
            )}
            {view === 'life' && (
                <figure style={box}>
                    <div style={h}>The life of a run</div>
                    <LifeOfARun />
                    <figcaption style={{ marginTop: '6px', fontSize: '12px', color: t.contentColorMuted }}>
                        Every numbered change also writes an audit event to index=_audit and a line to the app&apos;s log in _internal.
                    </figcaption>
                </figure>
            )}
            {view === 'modules' && (
                <figure style={box}>
                    <div style={h}>Every module</div>
                    <ModuleTable t={t} />
                </figure>
            )}
        </div>
    );
}
