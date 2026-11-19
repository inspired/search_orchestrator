import React from 'react';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import PerformanceTab from '../features/run/PerformanceTab';
import * as performance from '../api/performance';
import type { RunSummary } from '../api/types';
import { renderThemed, runSummary } from './fixtures';

jest.mock('../api/performance');
const api = performance as jest.Mocked<typeof performance>;

const run = (): RunSummary & { definition: { steps: { id: string; name?: string }[] } } =>
    ({
        ...runSummary({
            steps: {
                a: { state: 'succeeded', perf: { run_duration: 3.2, scan_count: 1204, result_count: 5, disk_usage: 2097152 } },
                b: { state: 'succeeded', perf: { run_duration: 1.8, scan_count: 96, result_count: 2 } },
                c: { state: 'waiting' },
            },
        }),
        definition: { steps: [{ id: 'a', name: 'Count logins' }, { id: 'b' }, { id: 'c' }] },
    } as never);

const NOW = 1764547200 + 3600;

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

beforeEach(() => {
    jest.resetAllMocks();
});

describe('PerformanceTab', () => {
    test('rows show formatted numbers and empty cells show a dash', () => {
        renderThemed(<PerformanceTab run={run() as never} now={NOW} />);
        const a = within(rowOf('Count logins'));
        expect(a.getByText('3.2 s')).toBeInTheDocument();
        expect(a.getByText('1 204')).toBeInTheDocument();
        expect(a.getByText('2.0 MB')).toBeInTheDocument();
        // Six numbers and the Search column (no search yet).
        expect(within(rowOf('c')).getAllByText('—')).toHaveLength(7);
    });

    test('the Total row sums the steps', () => {
        renderThemed(<PerformanceTab run={run() as never} now={NOW} />);
        const total = within(rowOf('Total'));
        expect(total.getByText('5.0 s')).toBeInTheDocument();
        expect(total.getByText('1 300')).toBeInTheDocument();
        expect(total.getByText('7')).toBeInTheDocument();
    });

    test('Load CPU and memory calls the route once, fills the columns and shows notes', async () => {
        api.getPerformance.mockResolvedValue({
            steps: { a: { cpu_peak: 88.5, mem_peak_mb: 512 } },
            notes: ['CPU and memory need read access to _introspection; ask an admin.'],
        });
        renderThemed(<PerformanceTab run={run() as never} now={NOW} />);
        expect(api.getPerformance).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Load CPU and memory' }));
        expect(await screen.findByText('88.5%')).toBeInTheDocument();
        expect(within(rowOf('Count logins')).getByText('512.0 MB')).toBeInTheDocument();
        expect(screen.getByText(/need read access to _introspection/)).toBeInTheDocument();
        await waitFor(() => expect(api.getPerformance).toHaveBeenCalledTimes(1));
        expect(api.getPerformance).toHaveBeenCalledWith('daily:1764547200');
    });

    test('a failed load says what went wrong', async () => {
        api.getPerformance.mockRejectedValue(new Error('boom'));
        renderThemed(<PerformanceTab run={run() as never} now={NOW} />);
        await userEvent.click(screen.getByRole('button', { name: 'Load CPU and memory' }));
        expect(await screen.findByText(/CPU and memory could not be loaded: boom/)).toBeInTheDocument();
    });

    test('a running step counts up; a step with a search opens in Search; loaded searches open too', async () => {
        const r = run() as never as { steps: Record<string, unknown> };
        r.steps.a = { ...(r.steps.a as object), sid: 'scheduler__a_1' };
        r.steps.c = { state: 'running', started_at: NOW - 75, sid: 'scheduler__c_1' };
        api.getPerformance.mockResolvedValue({
            steps: {},
            notes: [],
            searches: [{ label: 'CPU and memory', spl: 'search index=_introspection x', earliest: '100', latest: '200' }],
        });
        renderThemed(<PerformanceTab run={r as never} now={NOW} />);
        expect(screen.getByTestId('live-c')).toHaveTextContent('1m 15s (running)');
        expect(within(rowOf('Count logins')).getByRole('link', { name: /Open in Search/ }).getAttribute('href')).toContain('sid=scheduler__a_1');
        await userEvent.click(screen.getByRole('button', { name: 'Load CPU and memory' }));
        const link = await screen.findByRole('link', { name: /Open the cpu and memory search in Search/ });
        expect(link.getAttribute('href')).toContain('q=search%20index%3D_introspection%20x');
        expect(screen.getByRole('button', { name: 'Load CPU and memory again' })).toBeInTheDocument();
    });
});
