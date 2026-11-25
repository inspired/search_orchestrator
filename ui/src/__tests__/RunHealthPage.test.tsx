import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import RunHealthPage, { RunHealthApi } from '../features/runhealth/RunHealthPage';
import { columnsOf, overTimeData, tiles } from '../features/runhealth/healthData';
import type { HealthSection, Sections } from '../api/runHealth';
import { job, renderThemed } from './fixtures';

const common = {
    searches: [
        {
            key: 'k',
            title: 'runs',
            spl: 'search `orchestrator_index` x',
            earliest: '-24h',
            latest: 'now',
        },
    ],
    notes: [],
    names: { daily: { name: 'Daily logins', steps: { a: 'Count logins' } } },
};
const T = 1767225600;

const DATA: Sections = {
    runs: {
        ...common,
        kpi: {
            runs: 5,
            succeeded: 3,
            failed: 1,
            held_blocked: 1,
            success_rate: 60,
            median_duration: 75,
        },
        over_time: {
            span: 3600,
            buckets: [
                { t: T, counts: { succeeded: 2, failed: 1 } },
                { t: T + 3600, counts: { succeeded: 1, held: 1 } },
            ],
        },
        attention: [
            {
                run_id: 'daily:9',
                job_id: 'daily',
                state: 'failed',
                reason: 'a: boom',
                last_seen: String(T),
            },
        ],
    },
    steps: {
        ...common,
        failing: [
            {
                job_id: 'daily',
                step_id: 'a',
                failures: '2',
                attempts: '4',
                failure_pct: '50',
                failed_at: String(T),
                latest_error: 'boom',
            },
        ],
        slowest: [],
    },
    actions: {
        ...common,
        by_type: [{ action: 'Email', sent: '3', failed: '1' }],
        failures: [],
    },
    late: { ...common, late: [], count: 2 },
    engine: { ...common, last: { minutes: '0.5' }, errors: [], tracebacks: [] },
    performance: { ...common, runtime: [], scanned: [], slowest: [], peaks: [] },
};

function api(over: Partial<RunHealthApi> = {}): RunHealthApi {
    return {
        runHealth: jest.fn((s: HealthSection) => Promise.resolve(DATA[s])) as unknown as RunHealthApi['runHealth'],
        listJobs: jest.fn(() => Promise.resolve([job({ id: 'daily', name: 'Daily logins' })])),
        ...over,
    };
}

describe('Run health page', () => {
    afterEach(() => window.history.replaceState(null, '', '/'));

    test('loads every section for all jobs over 24 hours and shows the tiles', async () => {
        const a = api();
        renderThemed(<RunHealthPage api={a} />);
        await waitFor(() => expect(a.runHealth).toHaveBeenCalledTimes(6));
        (a.runHealth as jest.Mock).mock.calls.forEach(([, f]) => expect(f).toEqual({ job_id: '', range: '24h' }));
        await waitFor(() => expect(screen.getByTestId('tile-failed')).toHaveTextContent('1'));
        expect(screen.getByTestId('tile-failed')).toHaveAttribute('data-tone', 'error');
        expect(screen.getByTestId('tile-rate')).toHaveTextContent('60%');
        expect(screen.getByTestId('tile-late')).toHaveTextContent('2');
        expect(screen.getByTestId('tile-engine')).toHaveTextContent('Just now');
        expect(screen.getByTestId('tile-engine')).toHaveAttribute('data-tone', 'ok');
    });

    test('tables use job and step names and link runs; each section links its searches', async () => {
        renderThemed(<RunHealthPage api={api()} />);
        const attention = await screen.findByRole('group', {
            name: 'Runs that need attention',
        });
        expect(within(attention).getByText('Daily logins')).toBeInTheDocument();
        expect(within(attention).getByRole('link', { name: 'daily:9' })).toHaveAttribute('href', expect.stringContaining('run?run_id=daily%3A9'));
        const failing = await screen.findByRole('group', {
            name: 'Steps that fail most',
        });
        expect(within(failing).getByText('Count logins')).toBeInTheDocument();
        expect(screen.getByText('No step finished.')).toBeInTheDocument();
        const runs = screen.getByRole('region', { name: 'Runs' });
        expect(within(runs).getByRole('link', { name: /^runs/ })).toHaveAttribute('href', expect.stringContaining('orchestrator_index'));
    });

    test('picking a job or a range loads again with it, and the address keeps it', async () => {
        const a = api();
        renderThemed(<RunHealthPage api={a} />);
        await waitFor(() => expect(a.runHealth).toHaveBeenCalledTimes(6));
        fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
        await waitFor(() => expect(a.runHealth).toHaveBeenCalledTimes(12));
        expect((a.runHealth as jest.Mock).mock.calls[11][1]).toEqual({
            job_id: '',
            range: '7d',
        });
        expect(window.location.search).toBe('?range=7d');
    });

    test('a note from the server and a failed section are shown in their section', async () => {
        const a = api({
            runHealth: jest.fn((s: HealthSection) =>
                s === 'actions'
                    ? Promise.reject(new Error('Splunk could not run the search'))
                    : Promise.resolve({
                          ...DATA[s],
                          notes: s === 'runs' ? ['Needs _audit'] : [],
                      })
            ) as unknown as RunHealthApi['runHealth'],
        });
        renderThemed(<RunHealthPage api={a} />);
        const runs = screen.getByRole('region', { name: 'Runs' });
        expect(await within(runs).findByText('Needs _audit')).toBeInTheDocument();
        const actions = screen.getByRole('region', { name: 'Actions' });
        expect(await within(actions).findByText('Splunk could not run the search')).toBeInTheDocument();
    });

    test('charts get their data as columns', async () => {
        renderThemed(<RunHealthPage api={api()} />);
        const chart = await screen.findByTestId('chart-column');
        const fields = Array.from(chart.querySelectorAll('[data-field]')).map((e) => e.getAttribute('data-field'));
        expect(fields).toEqual(['_time', 'succeeded', 'failed', 'held', '_span']);
    });
});

describe('Run health data', () => {
    test('runs over time: a column per state seen, zeros where a bucket has none', () => {
        const d = overTimeData(DATA.runs.over_time);
        expect(d.fields.map((f) => f.name)).toEqual(['_time', 'succeeded', 'failed', 'held', '_span']);
        expect(d.columns[2]).toEqual(['1', '0']);
        expect(d.columns[0][0]).toBe(new Date(T * 1000).toISOString());
    });

    test('columnsOf leaves out internal fields but keeps _time', () => {
        const d = columnsOf([{ _time: 't1', daily: '3', _span: '3600' }]);
        expect(d.fields.map((f) => f.name)).toEqual(['_time', 'daily']);
    });

    test('tiles say when nothing is loaded yet, and when the engine was not seen', () => {
        expect(tiles(null, null, null).every((t) => t.value === '–' && t.tone === 'muted')).toBe(true);
        const engine = { ...DATA.engine, last: {} };
        expect(tiles(null, null, engine).find((t) => t.id === 'engine')).toMatchObject({ value: 'Not seen', tone: 'error' });
    });
});
