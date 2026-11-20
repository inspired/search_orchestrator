import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import LogsPage, { initialFilters, initialView } from '../features/logs/LogsPage';
import { logsHref } from '../features/logs/logsHref';
import type { LogBreakdown, LogProblems, LogSummary, LogsResponse } from '../api/logs';
import { renderThemed } from './fixtures';

const RAW_REQ = '2026-11-19 13:46:17,374 +0100 level=INFO process=rest logger=so.rest event=request method="POST" ms=168 path="/orchestrator/runs/daily%3Amanual%3Aab/approve" status=202 user="joernh"';

const LINES: LogsResponse = {
    lines: [
        {
            time: '2026-11-19T13:46:20.000+01:00',
            level: 'INFO',
            process: 'engine',
            event: 'action_failed',
            job_id: 'daily',
            run_id: 'daily:manual:ab',
            step_id: 'a',
            fields: { event: 'action_failed', action_type: 'webhook', attempts: '3', error: 'HTTP 404 Not Found', job_id: 'daily', run_id: 'daily:manual:ab', step_id: 'a' },
            raw: '2026-11-19 13:46:20,000 +0100 level=INFO process=engine logger=so.audit event=action_failed',
        },
        {
            time: '2026-11-19T13:46:17.374+01:00',
            level: 'INFO',
            process: 'rest',
            event: 'request',
            fields: { event: 'request', method: 'POST', ms: '168', path: '/orchestrator/runs/daily%3Amanual%3Aab/approve', status: '202', user: 'joernh' },
            raw: RAW_REQ,
        },
    ],
    notes: [],
    names: { daily: { name: 'Daily logins', steps: { a: 'Count logins' } } },
    spl: 'search index=_internal source="*search_orchestrator.*.log" | head 200',
    earliest: '-24h',
    latest: 'now',
};

const SUMMARY: LogSummary = {
    range: '24h',
    span: '30m',
    buckets: [
        { time: '2026-11-19T12:00:00.000+01:00', error: 0, warning: 1, info: 4, debug: 0, req_ok: 3, req_4xx: 0, req_5xx: 0, req_p95: 120, ticks: 10, tick_avg: 40, tick_max: 80, active_runs: 1 },
        { time: '2026-11-19T12:30:00.000+01:00', error: 2, warning: 0, info: 6, debug: 0, req_ok: 5, req_4xx: 1, req_5xx: 1, req_p95: 300, ticks: 10, tick_avg: 50, tick_max: 90, active_runs: 2 },
    ],
    totals: { error: 2, warning: 1, info: 10, debug: 0, requests: 10, req_4xx: 1, req_5xx: 1, actions_failed: 1, actions_done: 4, runs_failed: 1, runs_succeeded: 3, steps_failed: 1, engine: 9, rest: 4 },
    events: [{ event: 'request', count: 10, levels: { INFO: 10 } }, { event: 'action_failed', count: 1, levels: { INFO: 1 } }],
    engine: { running: true, last_seen: Math.floor(Date.now() / 1000) - 3 },
    log_level: 'INFO',
    notes: [],
    searches: { activity: { spl: 'search x', earliest: '-24h', latest: 'now' }, counts: { spl: 'search y', earliest: '-24h', latest: 'now' } },
};

const BREAKDOWN: LogBreakdown = {
    routes: [{ method: 'POST', route: 'runs/<id>/approve', count: 4, p95: 300, avg: 150, max: 320, failed: 1 }],
    calls: [],
    requests_p95: 210,
    requests: 10,
    notes: [],
    searches: {},
};

const PROBLEMS: LogProblems = {
    problems: [{ signature: 'action_failed||webhook|HTTP <n> Not Found', count: 3, level: 'INFO', event: 'action_failed', first: '2026-11-19T10:00:00Z', last: '2026-11-19T13:46:20Z', jobs: ['daily'], runs: 2, sample: LINES.lines[0] }],
    notes: [],
    names: LINES.names,
    spl: 'search p',
    earliest: '-24h',
    latest: 'now',
};

function api(over: Partial<Record<string, jest.Mock>> = {}) {
    return {
        searchLogs: jest.fn(() => Promise.resolve(LINES)),
        logSummary: jest.fn(() => Promise.resolve(SUMMARY)),
        logBreakdown: jest.fn(() => Promise.resolve(BREAKDOWN)),
        logProblems: jest.fn(() => Promise.resolve(PROBLEMS)),
        listJobs: jest.fn(() => Promise.resolve([{ id: 'daily', name: 'Daily logins' }] as never)),
        listRuns: jest.fn(() => Promise.resolve([{ id: 'daily:manual:ab', job_id: 'daily', scheduled_time: 1763556000, state: 'failed' }] as never)),
        ...over,
    };
}

describe('Troubleshooting page', () => {
    beforeEach(() => window.history.replaceState(null, '', '/app/search_orchestrator/logs'));

    test('lines are told in words with names, who and the result; a row opens to why and what to do', async () => {
        const a = api();
        renderThemed(<LogsPage api={a as never} />);
        const first = await screen.findByTestId('log-line-0');
        expect(first).toHaveTextContent('Webhook failed after 3 tries: HTTP 404 Not Found');
        expect(first).toHaveTextContent('Daily logins');
        expect(first).toHaveTextContent('step Count logins');
        expect(first).toHaveAttribute('data-tone', 'error');
        const second = screen.getByTestId('log-line-1');
        expect(second).toHaveTextContent('joernh decided an approval in run daily:manual:ab');
        expect(second).toHaveTextContent('202 accepted: the engine applies it on its next tick · 168 ms');
        fireEvent.click(within(first).getByRole('button', { expanded: false }));
        const details = screen.getByTestId('line-details');
        expect(within(details).getByTestId('why-fix')).toHaveTextContent('The target does not exist');
        expect(details).toHaveTextContent('action_type');
        expect(within(details).getByText('The story of this run')).toBeInTheDocument();
    });

    test('health tiles and graphs come from the summary; a tile filters the lines', async () => {
        const a = api();
        renderThemed(<LogsPage api={a as never} />);
        await screen.findByTestId('log-line-0');
        expect(screen.getByTestId('tile-engine')).toHaveTextContent('Running');
        expect(screen.getByTestId('tile-errors')).toHaveTextContent('2');
        expect(screen.getByTestId('tile-requests')).toHaveTextContent('of 10 · 1 server error');
        expect(screen.getByTestId('tile-slow')).toHaveTextContent('210 ms');
        // The activity graph is a Dashboard Studio panel: Splunk's stacked Column chart on a chain
        // of the summary's own search, with Open in search in its action bar.
        const def = JSON.parse(screen.getByTestId('dashboard').getAttribute('data-definition') || '{}');
        expect(def.dataSources.ds_base.options.query).toBe('x');
        expect(def.visualizations.viz_levels.type).toBe('splunk.column');
        expect(def.visualizations.viz_levels.options.stackMode).toBe('stacked');
        expect(within(screen.getByTestId('panel-viz_levels')).getByTestId('open-in-search')).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(screen.getByTestId('tile-actions'));
        });
        await waitFor(() => expect(a.searchLogs).toHaveBeenLastCalledWith(expect.objectContaining({ event: 'action_failed' })));
        expect(window.location.search).toContain('event=action_failed');
        expect(screen.getByText('Event: Actions failed')).toBeInTheDocument();
    });

    test('graph tabs switch; the requests graph lists the slowest routes', async () => {
        renderThemed(<LogsPage api={api() as never} />);
        await screen.findByTestId('log-line-0');
        fireEvent.click(screen.getByRole('tab', { name: 'Requests' }));
        expect(screen.getByTestId('graph-requests')).toHaveTextContent('POST runs/<id>/approve');
        fireEvent.click(screen.getByRole('tab', { name: 'Engine' }));
        expect(screen.getByTestId('graph-engine')).toHaveTextContent("At Info level the points are the engine's heartbeat, every 5 minutes");
        const def = JSON.parse(screen.getByTestId('dashboard').getAttribute('data-definition') || '{}');
        expect(def.visualizations.viz_ticks.options.nullValueDisplay).toBe('connect');
        expect(def.visualizations.viz_ticks.options.markerDisplay).toBe('filled');
        expect(window.location.search).toContain('graph=engine');
    });

    test('problems are grouped and explained', async () => {
        const a = api();
        renderThemed(<LogsPage api={a as never} />);
        await screen.findByTestId('log-line-0');
        await act(async () => {
            fireEvent.click(screen.getByRole('tab', { name: /Problems/ }));
        });
        const p = await screen.findByTestId('problem');
        expect(p).toHaveTextContent('3');
        expect(p).toHaveTextContent('Webhook failed after 3 tries');
        expect(p).toHaveTextContent('Daily logins');
        expect(p).toHaveTextContent('Error');
        fireEvent.click(within(p).getByRole('button', { expanded: false }));
        expect(screen.getByTestId('why-fix')).toHaveTextContent('What to do');
    });

    test('run story: pick a run, read its events oldest first', async () => {
        const story: LogsResponse = {
            ...LINES,
            lines: [
                { time: '2026-11-19T10:00:00Z', event: 'run_created', job_id: 'daily', run_id: 'daily:manual:ab', fields: { event: 'run_created', trigger: 'manual' } },
                { time: '2026-11-19T10:02:10Z', event: 'run_state', job_id: 'daily', run_id: 'daily:manual:ab', fields: { event: 'run_state', from: 'queued', to: 'running' } },
            ],
        };
        const a = api({ searchLogs: jest.fn(() => Promise.resolve(story)) });
        renderThemed(<LogsPage api={a as never} />);
        await act(async () => {
            fireEvent.click(screen.getByRole('tab', { name: 'Run story' }));
        });
        await act(async () => {
            fireEvent.click(await screen.findByRole('button', { name: /Daily logins/ }));
        });
        const gap = await screen.findByTestId('story-gap');
        expect(gap).toHaveTextContent('2m 10s: queued: waiting for its turn');
        expect(a.searchLogs).toHaveBeenLastCalledWith(expect.objectContaining({ run_id: 'daily:manual:ab', sort: 'oldest', level: 'DEBUG' }));
    });

    test('notes and errors are shown', async () => {
        renderThemed(<LogsPage api={api({ searchLogs: jest.fn(() => Promise.resolve({ ...LINES, lines: [], notes: ['No log lines match.'] })) }) as never} />);
        expect(await screen.findByText('No log lines match.')).toBeInTheDocument();
    });

    test('a failed search says so', async () => {
        renderThemed(<LogsPage api={api({ searchLogs: jest.fn(() => Promise.reject(new Error('boom'))) }) as never} />);
        expect(await screen.findByText('The logs could not be searched: boom')).toBeInTheDocument();
    });

    test('filters and view come from the address; the run page links here for a run and a step', () => {
        expect(logsHref('daily:1', 'a')).toBe('logs?run_id=daily%3A1&level=DEBUG&range=7d&step_id=a');
        window.history.replaceState(null, '', '/app/search_orchestrator/logs?run_id=daily%3A1&step_id=a&level=debug&range=7d&view=story&event=step_state');
        expect(initialFilters()).toMatchObject({ run_id: 'daily:1', step_id: 'a', level: 'DEBUG', range: '7d', event: 'step_state' });
        expect(initialView()).toBe('story');
        window.history.replaceState(null, '', '/app/search_orchestrator/logs?range=1y&level=loud&view=x');
        expect(initialFilters()).toMatchObject({ range: '24h', level: '' });
        expect(initialView()).toBe('lines');
    });
});
