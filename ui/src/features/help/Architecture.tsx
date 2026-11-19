/* How it works: a technical drawing of the app for the help page. Three parts:
 *  1. A component map, layer by layer (browser, ways in, app logic, storage, Splunk), with
 *     the calls between parts. Click a part to light up its lines and read what it does,
 *     which files hold it and what it talks to.
 *  2. The life of a run, as a sequence diagram across the parts.
 *  3. Every Python module in bin/so with what it does.
 * Colours come from theme tokens only, so it follows light and dark mode. */
import React, { useState } from 'react';
import { useTheme } from './illustrationKit';
import type { Theme } from './illustrationKit';

type Layer = 'browser' | 'entry' | 'logic' | 'storage' | 'splunk';

export interface Part {
    id: string;
    label: string;
    sub: string;
    layer: Layer;
    x: number;
    w: number;
    files: string[];
    text: string;
}

export interface Link {
    from: string;
    to: string;
    label: string;
}

const LAYERS: { id: Layer; label: string; y: number }[] = [
    { id: 'browser', label: 'In the browser (Splunk Web)', y: 34 },
    { id: 'entry', label: 'Ways in (splunkd processes)', y: 164 },
    { id: 'logic', label: 'App logic (bin/so)', y: 294 },
    { id: 'storage', label: 'Storage and the door to splunkd', y: 424 },
    { id: 'splunk', label: 'Splunk and the outside world', y: 554 },
];
const LAYER_Y: Record<Layer, number> = LAYERS.reduce((o, l) => ({ ...o, [l.id]: l.y }), {} as Record<Layer, number>);
const BOX_H = 54;
const WIDTH = 1120;
const HEIGHT = 640;

export const PARTS: Part[] = [
    // Browser
    { id: 'ui_build', label: 'Jobs and flow editor', sub: 'pages/jobs, builder', layer: 'browser', x: 20, w: 190, files: ['ui/src/pages/jobs', 'ui/src/pages/builder', 'ui/src/features/builder', 'ui/src/features/simple'], text: 'React pages where you list, build and save jobs: the flow editor (nodes, lines, groups) and the simple list view. Preview and Test condition run real searches through the API.' },
    { id: 'ui_runs', label: 'Runs and run page', sub: 'pages/runs, run', layer: 'browser', x: 230, w: 190, files: ['ui/src/pages/runs', 'ui/src/pages/run', 'ui/src/features/run', 'ui/src/components/ApprovalAlert.tsx'], text: 'Follow runs: grouped by job, timeline, graph, performance, approvals. Polls GET runs and runs/<id> every 5 seconds while a run is active; Approve, Pause, Re-run and Cancel post commands.' },
    { id: 'ui_plan', label: 'Calendar, Dependencies', sub: 'pages/calendar, dependencies', layer: 'browser', x: 440, w: 190, files: ['ui/src/pages/calendar', 'ui/src/pages/dependencies', 'ui/src/features/calendar'], text: 'Day, week and month views of schedules, runs and backfills (GET calendar), and the graph of which jobs start which.' },
    { id: 'ui_admin', label: 'Settings, Troubleshooting', sub: 'pages/settings, logs', layer: 'browser', x: 650, w: 200, files: ['ui/src/pages/settings', 'ui/src/pages/logs', 'ui/src/features/logs'], text: 'Limits, retention, fallback, webhook destinations and the log level (admins), and the Troubleshooting page that searches the app\'s own log lines.' },
    { id: 'ui_dash', label: 'Run health dashboard', sub: 'views/run_health.xml', layer: 'browser', x: 870, w: 230, files: ['app/.../default/data/ui/views/run_health.xml', 'default/macros.conf'], text: 'A Splunk dashboard built straight on searches: audit events for runs, steps and actions, and _internal and _introspection for engine health and performance.' },
    // Entry
    { id: 'rest', label: 'REST handler', sub: 'orchestrator_rest.py · /orchestrator', layer: 'entry', x: 20, w: 260, files: ['bin/orchestrator_rest.py', 'default/restmap.conf', 'default/web.conf'], text: 'A persistent splunkd handler at /services/orchestrator. Every screen call lands here with the caller\'s session and the system session; it builds two gateways (as the user, as the system) and hands the request to the API router. Logs one line per request.' },
    { id: 'alert', label: 'Alert action', sub: 'start_orchestrator_job.py', layer: 'entry', x: 300, w: 210, files: ['bin/start_orchestrator_job.py', 'default/alert_actions.conf'], text: '"Start orchestrator job" on any alert: posts to the REST endpoint over loopback with the alert owner\'s session, so the same checks apply as on the screens.' },
    { id: 'cmd', label: '| orchestrate', sub: 'orchestrate.py (search command)', layer: 'entry', x: 530, w: 210, files: ['bin/orchestrate.py', 'default/commands.conf', 'default/searchbnf.conf'], text: 'start, status, cancel, rerun, approve, backfill, jobs and selftest from a search. Each calls the REST endpoint over loopback as the person running the search.' },
    { id: 'engine_in', label: 'Engine process', sub: 'orchestrator_engine.py · modular input', layer: 'entry', x: 760, w: 340, files: ['bin/orchestrator_engine.py', 'default/inputs.conf'], text: 'One long-running modular input. Ticks the engine every 5 seconds, reloads its session key when it expires, and writes audit events through the modular input stream. On a cluster only the lease holder works; the others wait.' },
    // Logic
    { id: 'api', label: 'API router', sub: 'api.py + *_api.py', layer: 'logic', x: 20, w: 150, files: ['so/api.py', 'so/authz.py', 'so/approval_api.py', 'so/backfill_api.py', 'so/calendar_api.py', 'so/history_api.py', 'so/snippets.py'], text: 'Matches the path to a route, checks capabilities and job permissions (authz), and runs the route: jobs, runs, approvals, backfills, calendar, versions, snippets, settings, destinations.' },
    { id: 'model', label: 'Validation', sub: 'model.py, tokens.py', layer: 'logic', x: 180, w: 140, files: ['so/model.py', 'so/tokens.py', 'so/expr.py', 'so/history.py', 'so/hidden.py', 'so/names.py'], text: 'Checks a job before it is saved: steps, lines, cycles, triggers, tokens, parameters and conditions. Saving keeps a version and writes one hidden saved search per step.' },
    { id: 'preview', label: 'Preview and test', sub: 'preview_api.py …', layer: 'logic', x: 330, w: 150, files: ['so/preview_api.py', 'so/preview.py', 'so/condition_test.py', 'so/output_view.py'], text: 'Runs a step\'s search, a condition or a read-only view of an output (lookup, summary index, email, event) as you, with the tokens filled, and returns the rows.' },
    { id: 'insight', label: 'Why and how fast', sub: 'queue_info, perf, logs_api', layer: 'logic', x: 490, w: 160, files: ['so/queue_info.py', 'so/perf.py', 'so/logs_api.py'], text: 'Why a run is queued or a step waits (from the lease and the other runs), what each search cost (engine numbers, _audit and _introspection) and the app\'s log lines for Troubleshooting.' },
    { id: 'sched', label: 'Scheduler', sub: 'scheduler, cron, backfill', layer: 'logic', x: 660, w: 140, files: ['so/scheduler.py', 'so/cron.py', 'so/backfill.py', 'so/deadline.py'], text: 'Finds due cron slots in the job\'s time zone, catches up missed ones, plans backfills and creates runs (one per slot; the queue cap is checked), each with its deadline.' },
    { id: 'tick', label: 'Engine tick', sub: 'engine.py, lease.py', layer: 'logic', x: 810, w: 130, files: ['so/engine.py', 'so/lease.py'], text: 'Each tick: take or renew the lease, fire cron, apply commands (pause, resume, cancel, re-run, approve), feed backfills, promote queued runs, advance every active run, pump actions, prune old runs.' },
    { id: 'steps', label: 'Steps and conditions', sub: 'state.py, expr.py, approval', layer: 'logic', x: 950, w: 150, files: ['so/state.py', 'so/expr.py', 'so/approval.py', 'so/tokens.py'], text: 'The pure evaluator: from each step\'s state and the lines (success, failure, always, if, delayed, late), decides which steps start, wait, are skipped or fail. Conditions are evaluated safely; approval steps wait for a decision or time out.' },
    // Storage
    { id: 'gateway', label: 'Gateway', sub: 'gateway.py, store.py', layer: 'storage', x: 20, w: 200, files: ['so/gateway.py', 'so/store.py'], text: 'The only door to splunkd: KV Store reads and writes (store.py over the so_* collections), saved searches, search jobs, secrets and email. Times out within the engine lease; logs each call at debug level.' },
    { id: 'kv', label: 'KV Store', sub: '11 so_* collections', layer: 'storage', x: 240, w: 300, files: ['so_jobs', 'so_job_versions', 'so_runs', 'so_step_runs', 'so_action_runs', 'so_commands', 'so_locks', 'so_settings', 'so_backfills', 'so_snippets', 'so_selftest'], text: 'Everything the app remembers: jobs and their versions, runs and step attempts, the action outbox, commands from the screens, the engine lease, settings, backfills and snippets.' },
    { id: 'saved', label: 'Hidden saved searches', sub: 'one private search per step', layer: 'storage', x: 560, w: 240, files: ['so/hidden.py', 'so/names.py'], text: 'Each step\'s SPL is a private saved search owned by the job owner, so a step runs with the owner\'s permissions. The engine dispatches it with the run\'s tokens as arguments.' },
    { id: 'secrets', label: 'Secrets', sub: 'storage/passwords', layer: 'storage', x: 820, w: 280, files: ['storage/passwords (realm search_orchestrator)'], text: 'Webhook URLs and headers are kept encrypted in Splunk\'s password store, never in KV Store or logs.' },
    // Splunk
    { id: 'search', label: 'Search jobs', sub: 'dispatch, status, results', layer: 'splunk', x: 20, w: 200, files: ['saved/searches/<name>/dispatch', 'search/jobs/<sid>'], text: 'Splunk runs each step as a normal search job. The engine polls its status every tick and reads the result count and the first row for tokens.' },
    { id: 'out', label: 'Outside the app', sub: 'email, webhooks, lookups, indexes', layer: 'splunk', x: 240, w: 260, files: ['sendemail', 'Slack, Teams, PagerDuty, ServiceNow, webhooks', 'outputlookup, collect'], text: 'Where actions land: emails, webhook posts (with presets), lookups, summary indexes, events, alert actions, and other jobs started by a chain.' },
    { id: 'audit', label: 'index=orchestrator', sub: 'audit events (audit.py)', layer: 'splunk', x: 520, w: 190, files: ['so/audit.py', 'default/indexes.conf'], text: 'One JSON event per change: job saved, run created, step dispatched, approval decided, action done, and more. The run health dashboard and your own searches read it.' },
    { id: 'internal', label: '_internal', sub: 'app log files (logs.py)', layer: 'splunk', x: 730, w: 170, files: ['so/logs.py', '$SPLUNK_HOME/var/log/splunk/search_orchestrator.<process>.log'], text: 'The troubleshooting logs: one key=value file per process (engine, rest), with every audit event, request, error and, at debug level, each tick, search status and splunkd call.' },
    { id: 'intro', label: '_introspection, _audit', sub: 'CPU, memory, run times', layer: 'splunk', x: 920, w: 180, files: ['index=_introspection', 'index=_audit'], text: 'Read on request for the Performance tab: peak CPU and memory of each search process, and run numbers for old steps.' },
];

export const LINKS: Link[] = [
    { from: 'ui_build', to: 'rest', label: 'jobs, preview' },
    { from: 'ui_runs', to: 'rest', label: 'runs, commands' },
    { from: 'ui_plan', to: 'rest', label: 'calendar' },
    { from: 'ui_admin', to: 'rest', label: 'settings, logs' },
    { from: 'ui_dash', to: 'audit', label: 'searches' },
    { from: 'ui_dash', to: 'internal', label: 'engine health' },
    { from: 'alert', to: 'rest', label: 'loopback POST' },
    { from: 'cmd', to: 'rest', label: 'loopback calls' },
    { from: 'rest', to: 'api', label: 'handle()' },
    { from: 'api', to: 'model', label: 'validate, save' },
    { from: 'api', to: 'preview', label: 'preview' },
    { from: 'api', to: 'insight', label: 'why, perf, logs' },
    { from: 'api', to: 'sched', label: 'run now' },
    { from: 'api', to: 'gateway', label: 'KV (system session)' },
    { from: 'model', to: 'saved', label: 'step searches' },
    { from: 'preview', to: 'search', label: 'as you' },
    { from: 'insight', to: 'intro', label: 'CPU, memory' },
    { from: 'insight', to: 'internal', label: 'log lines' },
    { from: 'engine_in', to: 'tick', label: 'every 5 s' },
    { from: 'tick', to: 'sched', label: 'cron due' },
    { from: 'tick', to: 'steps', label: 'evaluate' },
    { from: 'tick', to: 'gateway', label: 'lease, runs' },
    { from: 'sched', to: 'kv', label: 'queued run' },
    { from: 'gateway', to: 'kv', label: 'read, write' },
    { from: 'gateway', to: 'secrets', label: 'webhook URLs' },
    { from: 'steps', to: 'saved', label: 'dispatch' },
    { from: 'saved', to: 'search', label: 'search job' },
    { from: 'tick', to: 'out', label: 'actions' },
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

function center(p: Part) {
    return { x: p.x + p.w / 2, y: LAYER_Y[p.layer] + BOX_H / 2 };
}

/** Where the line from a's centre to b's centre leaves a's box. */
function edgePoint(p: Part, toward: { x: number; y: number }) {
    const c = center(p);
    const dx = toward.x - c.x;
    const dy = toward.y - c.y;
    const sx = dx === 0 ? Infinity : p.w / 2 / Math.abs(dx);
    const sy = dy === 0 ? Infinity : BOX_H / 2 / Math.abs(dy);
    const s = Math.min(sx, sy);
    return { x: c.x + dx * s, y: c.y + dy * s };
}

function ComponentMap({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
    const t = useTheme();
    const lit = (l: Link) => selected !== null && (l.from === selected || l.to === selected);
    const near = new Set<string>();
    LINKS.forEach((l) => {
        if (lit(l)) {
            near.add(l.from);
            near.add(l.to);
        }
    });
    const accent = t.contentColorActive || t.statusColorInfo;
    return (
        <svg
            role="img"
            aria-label="Component map of Search Orchestrator: browser pages, ways in, app logic, storage and Splunk, with the calls between them"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            style={{ width: '100%', height: 'auto', display: 'block' }}
        >
            <defs>
                <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill={t.contentColorMuted} />
                </marker>
                <marker id="arch-arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill={accent} />
                </marker>
            </defs>
            {LAYERS.map((l) => (
                <g key={l.id}>
                    <rect x={6} y={l.y - 26} width={WIDTH - 12} height={BOX_H + 38} rx={8} fill="none" stroke={t.borderColorWeak || t.borderColor} strokeDasharray="4 4" />
                    <text x={16} y={l.y - 10} fontSize={12} fontWeight={600} fill={t.contentColorMuted} fontFamily={t.fontFamily}>
                        {l.label}
                    </text>
                </g>
            ))}
            {LINKS.map((l) => {
                const a = byId.get(l.from) as Part;
                const b = byId.get(l.to) as Part;
                const p1 = edgePoint(a, center(b));
                const p2 = edgePoint(b, center(a));
                const on = lit(l);
                const dim = selected !== null && !on;
                return (
                    <g key={`${l.from}>${l.to}`} data-testid={`arch-link-${l.from}-${l.to}`} data-lit={on ? 'true' : 'false'}>
                        <line
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                            stroke={on ? accent : t.contentColorMuted}
                            strokeOpacity={dim ? 0.15 : on ? 1 : 0.45}
                            strokeWidth={on ? 2.5 : 1.2}
                            markerEnd={`url(#${on ? 'arch-arrow-lit' : 'arch-arrow'})`}
                        />
                        {on && (
                            <text
                                x={(p1.x + p2.x) / 2}
                                y={(p1.y + p2.y) / 2 - 4}
                                textAnchor="middle"
                                fontSize={11}
                                fontWeight={600}
                                fill={accent}
                                stroke={t.backgroundColorSection || t.backgroundColor}
                                strokeWidth={4}
                                paintOrder="stroke"
                                fontFamily={t.fontFamily}
                            >
                                {l.label}
                            </text>
                        )}
                    </g>
                );
            })}
            {PARTS.map((p) => {
                const y = LAYER_Y[p.layer];
                const isSel = selected === p.id;
                const dim = selected !== null && !isSel && !near.has(p.id);
                const color = t[LAYER_TOKEN[p.layer]] || t.contentColorMuted;
                return (
                    <g
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSel}
                        aria-label={`${p.label}: ${p.sub}`}
                        data-testid={`arch-part-${p.id}`}
                        onClick={() => onSelect(isSel ? null : p.id)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSelect(isSel ? null : p.id);
                            }
                        }}
                        style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1, outline: 'none' }}
                    >
                        <rect
                            x={p.x}
                            y={y}
                            width={p.w}
                            height={BOX_H}
                            rx={7}
                            fill={t.backgroundColorPopup || t.backgroundColor}
                            stroke={isSel ? accent : color}
                            strokeWidth={isSel ? 3 : 1.5}
                        />
                        <rect x={p.x} y={y} width={5} height={BOX_H} rx={2} fill={color} />
                        <text x={p.x + 14} y={y + 22} fontSize={13} fontWeight={600} fill={t.contentColorDefault} fontFamily={t.fontFamily}>
                            {p.label}
                        </text>
                        <text x={p.x + 14} y={y + 40} fontSize={10.5} fill={t.contentColorMuted} fontFamily={t.fontFamilyMono || 'monospace'}>
                            {p.sub}
                        </text>
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
                Click a part to light up what it talks to and read what it does. Arrows point from the caller to what it calls.
            </p>
        );
    }
    const out = LINKS.filter((l) => l.from === p.id);
    const into = LINKS.filter((l) => l.to === p.id);
    const name = (pid: string) => (byId.get(pid) as Part).label;
    return (
        <div data-testid="arch-details" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '16px', margin: '8px 0', fontSize: '13px' }}>
            <div>
                <div style={{ fontWeight: 600, fontSize: '15px' }}>{p.label}</div>
                <p style={{ margin: '4px 0 8px' }}>{p.text}</p>
                <div style={{ color: t.contentColorMuted }}>Files and names</div>
                <ul style={{ margin: '2px 0 0', paddingLeft: '18px', fontFamily: t.fontFamilyMono || 'monospace', fontSize: '12px' }}>
                    {p.files.map((f) => (
                        <li key={f}>{f}</li>
                    ))}
                </ul>
            </div>
            <div>
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
];

function LifeOfARun() {
    const t = useTheme();
    const laneW = 170;
    const left = 20;
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
                    <rect x={x(i) - 70} y={6} width={140} height={24} rx={5} fill={t.backgroundColorPopup || t.backgroundColor} stroke={t.borderColor} />
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
    ['so/api.py', 'API', 'Routes, permission checks, jobs, runs, settings, destinations, health, me.'],
    ['so/authz.py', 'API', 'Who may view, build, run, approve and administer, from capabilities, roles and job sharing.'],
    ['so/approval_api.py · approval.py', 'API · Engine', 'Approve or reject a step; the approval step’s shape, timeout and approver roles.'],
    ['so/backfill_api.py · backfill.py', 'API · Engine', 'Create, list and cancel backfills; plan the slots and feed them to the engine a few at a time.'],
    ['so/calendar_api.py', 'API', 'Schedules, runs and backfills for a day, week or month.'],
    ['so/history_api.py · history.py', 'API', 'Version history: every save is a version; compare and restore.'],
    ['so/snippets.py', 'API', 'Saved sub-flows shared between builders.'],
    ['so/preview_api.py · preview.py', 'API', 'Preview a step’s search as you, with tokens from earlier previews.'],
    ['so/condition_test.py', 'API', 'Test a condition against a preview’s rows.'],
    ['so/output_view.py', 'API', 'Read-only view of what a write step or action produced.'],
    ['so/queue_info.py', 'API', 'Why a run is queued or a step waits; whether the engine is running.'],
    ['so/perf.py', 'API', 'Runtime, events scanned, results, disk, CPU and memory per step.'],
    ['so/logs_api.py · logs.py', 'API · All', 'The troubleshooting logs: files, key=value lines, level from Settings, and the logs route.'],
    ['so/model.py', 'Validation', 'Job model: validation, order of steps, triggers and defaults.'],
    ['so/tokens.py', 'Validation', 'Tokens such as $step.first.field$, saved-search arguments, parameter checks.'],
    ['so/expr.py', 'Validation · Engine', 'The safe expression language for conditions and run when.'],
    ['so/hidden.py · names.py', 'Storage', 'The hidden saved searches the app owns, and their names.'],
    ['so/engine.py', 'Engine', 'The tick: cron, commands, backfills, promotion, advancing runs, dispatch and poll, conditions, actions, pruning.'],
    ['so/state.py', 'Engine', 'The pure run-state evaluator: which steps start, wait, skip or fail.'],
    ['so/scheduler.py · cron.py', 'Engine', 'Cron slots in a time zone, catch-up and run creation with the queue cap.'],
    ['so/deadline.py', 'Engine', 'Finish-by and finish-within deadlines, and Late alerts.'],
    ['so/lease.py', 'Engine', 'The engine leader lease in so_locks: one engine works at a time.'],
    ['so/actions.py · presets.py · alert_forms.py', 'Engine', 'The action outbox: email, webhooks with presets, lookups, summary index, events, alert actions, start job.'],
    ['so/gateway.py', 'Storage', 'Every call to splunkd: KV Store, saved searches, search jobs, secrets, email.'],
    ['so/store.py', 'Storage', 'The so_* collections as functions: jobs, runs, step runs, commands, settings.'],
    ['so/audit.py', 'Storage', 'Audit events to index=orchestrator (and a copy to the log file).'],
    ['so/selftest.py', 'Tools', 'Built-in self-test jobs and the server probe (| orchestrate selftest).'],
];

function ModuleTable({ t }: { t: Theme }) {
    return (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <thead>
                <tr>
                    {['File', 'Part', 'What it does'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: `1px solid ${t.borderColor}`, color: t.contentColorMuted }}>
                            {h}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {MODULES.map(([file, part, text]) => (
                    <tr key={file}>
                        <td style={{ padding: '4px 8px', fontFamily: t.fontFamilyMono || 'monospace', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{file}</td>
                        <td style={{ padding: '4px 8px', color: t.contentColorMuted, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{part}</td>
                        <td style={{ padding: '4px 8px', verticalAlign: 'top' }}>{text}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default function Architecture() {
    const t = useTheme();
    const [selected, setSelected] = useState<string | null>(null);
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
            <figure data-testid="help-figure" style={{ ...box, overflowX: 'auto' }}>
                <div style={h}>The parts and how they call each other</div>
                <div style={{ minWidth: '760px' }}>
                    <ComponentMap selected={selected} onSelect={setSelected} />
                </div>
                <Details id={selected} />
            </figure>
            <figure style={{ ...box, overflowX: 'auto' }}>
                <div style={h}>The life of a run</div>
                <div style={{ minWidth: '760px' }}>
                    <LifeOfARun />
                </div>
                <figcaption style={{ marginTop: '6px', fontSize: '12px', color: t.contentColorMuted }}>
                    Every numbered change also writes an audit event to index=orchestrator and a line to the app&apos;s log in _internal.
                </figcaption>
            </figure>
            <figure style={{ ...box, overflowX: 'auto' }}>
                <div style={h}>Every module</div>
                <ModuleTable t={t} />
            </figure>
        </div>
    );
}
