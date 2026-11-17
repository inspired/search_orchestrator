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

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

beforeEach(() => {
    jest.resetAllMocks();
});

describe('PerformanceTab', () => {
    test('rows show formatted numbers and empty cells show a dash', () => {
        renderThemed(<PerformanceTab run={run() as never} />);
        const a = within(rowOf('Count logins'));
        expect(a.getByText('3.2 s')).toBeInTheDocument();
        expect(a.getByText('1 204')).toBeInTheDocument();
        expect(a.getByText('2.0 MB')).toBeInTheDocument();
        expect(within(rowOf('c')).getAllByText('—')).toHaveLength(6);
    });

    test('the Total row sums the steps', () => {
        renderThemed(<PerformanceTab run={run() as never} />);
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
        renderThemed(<PerformanceTab run={run() as never} />);
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
        renderThemed(<PerformanceTab run={run() as never} />);
        await userEvent.click(screen.getByRole('button', { name: 'Load CPU and memory' }));
        expect(await screen.findByText(/CPU and memory could not be loaded: boom/)).toBeInTheDocument();
    });
});
