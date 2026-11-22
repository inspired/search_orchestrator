import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import CompareTab, { compareRuns, defaultOther, paramChanges } from '../features/run/CompareTab';
import type { RunDetail } from '../api/types';
import { NOW, renderThemed, rollupRun, runSummary } from './fixtures';

const step = (state: string, took: number, results: number, scanned?: number) => ({ state, started_at: NOW, ended_at: NOW + took, result_count: results, perf: scanned ? { scan_count: scanned } : {} });

const today = rollupRun({
    id: 'rollup:2',
    state: 'failed',
    scheduled_time: NOW,
    started_at: NOW,
    ended_at: NOW + 300,
    params: { p: '2' },
    steps: { daily: step('succeeded', 100, 0, 5000), weekly: step('failed', 5, 0) } as unknown as RunDetail['steps'],
});
const yesterday = rollupRun({
    id: 'rollup:1',
    state: 'succeeded',
    scheduled_time: NOW - 86400,
    started_at: NOW - 86400,
    ended_at: NOW - 86400 + 120,
    params: { p: '1' },
    steps: { daily: step('succeeded', 40, 1204, 1000), weekly: step('succeeded', 6, 10), monthly: step('succeeded', 3, 1) } as unknown as RunDetail['steps'],
});

describe('Compare two runs', () => {
    test('compareRuns says what changed per step, and marks what is worse', () => {
        const rows = compareRuns(today, yesterday);
        const daily = rows.find((r) => r.stepId === 'daily');
        expect(daily?.changes).toEqual(['2.5× slower', '1 204 → 0 results', '5× the events scanned']);
        expect(daily?.worse).toBe(true);
        const weekly = rows.find((r) => r.stepId === 'weekly');
        expect(weekly?.changes).toContain('succeeded → failed');
        expect(weekly?.worse).toBe(true);
        expect(rows.find((r) => r.stepId === 'monthly')?.a).toBeNull();
    });

    test('a changed search and parameters are named', () => {
        const edited = rollupRun({ ...today, definition: { ...today.definition, steps: today.definition.steps.map((s) => (s.id === 'daily' ? { ...s, spl: '| makeresults count=2' } : s)) } });
        expect(compareRuns(edited, yesterday).find((r) => r.stepId === 'daily')?.changes[0]).toBe('search changed');
        expect(paramChanges(today, yesterday)).toEqual(['p: 1 → 2']);
    });

    test('defaultOther picks the newest finished run scheduled before this one', () => {
        const runs = [runSummary({ id: 'rollup:3', state: 'succeeded', scheduled_time: NOW + 100 }), runSummary({ id: 'rollup:1', state: 'succeeded', scheduled_time: NOW - 86400 }), runSummary({ id: 'rollup:0', state: 'running', scheduled_time: NOW - 1 })];
        expect(defaultOther(today, runs)?.id).toBe('rollup:1');
    });

    test('the tab loads the other run and shows the table', async () => {
        const api = { listRuns: jest.fn().mockResolvedValue([runSummary({ id: 'rollup:1', job_id: 'rollup', state: 'succeeded', scheduled_time: NOW - 86400 })]), getRun: jest.fn().mockResolvedValue({ run: yesterday, attempts: [], actions: [] }) };
        renderThemed(<CompareTab run={today} api={api as never} />);
        await waitFor(() => expect(screen.getByTestId('compare-table')).toBeInTheDocument());
        expect(api.getRun).toHaveBeenCalledWith('rollup:1');
        expect(screen.getByTestId('compare-summary')).toHaveTextContent('This run failed in 5m 0s; the other succeeded in 2m 0s. Same job definition. Parameters: p: 1 → 2.');
        expect(screen.getByTestId('compare-weekly')).toHaveTextContent('succeeded → failed');
    });
});
