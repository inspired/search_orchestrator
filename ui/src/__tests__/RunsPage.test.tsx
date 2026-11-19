import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { listJobs, listRuns } from '../api/client';
import { renderPage } from '../components/PageShell';
import { NOW, renderThemed, runSummary } from './fixtures';

jest.mock('../api/client', () => ({
    listJobs: jest.fn(),
    listRuns: jest.fn(),
}));
jest.mock('../components/PageShell', () => ({
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    renderPage: jest.fn(),
    pageHref: (page: string, query: Record<string, string> = {}) => {
        const params = new URLSearchParams(query).toString();
        return params ? `${page}?${params}` : page;
    },
    queryParam: (name: string) => new URLSearchParams(globalThis.location.search).get(name),
}));

const runsByState: Record<string, ReturnType<typeof runSummary>[]> = {
    blocked: [runSummary({ id: 'daily:old', state: 'blocked', created_at: NOW - 90000, scheduled_time: NOW - 90000 })],
    failed: [
        runSummary({ id: 'daily:new', state: 'failed', created_at: NOW - 60, scheduled_time: NOW - 60 }),
        runSummary({ id: 'daily:held', state: 'failed', held: true, created_at: NOW - 3600, scheduled_time: NOW - 3600 }),
    ],
    running: [
        runSummary({ id: 'daily:approve', state: 'running', created_at: NOW - 600, scheduled_time: NOW - 600, steps: { a: { state: 'awaiting_approval' } } as never }),
        runSummary({ id: 'daily:busy', state: 'running', created_at: NOW - 30, scheduled_time: NOW - 30, steps: { a: { state: 'running' } } as never }),
    ],
    paused: [
        runSummary({ id: 'daily:paused', state: 'paused', created_at: NOW - 7200, scheduled_time: NOW - 7200, steps: { a: { state: 'awaiting_approval' } } as never }),
    ],
};

describe('Runs page', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/app/search_orchestrator/runs?state=attention');
        (listJobs as jest.Mock).mockResolvedValue([]);
        (listRuns as jest.Mock).mockImplementation((f: { state?: string }) => Promise.resolve(runsByState[f.state || ''] || []));
    });

    it('Needs attention: blocked, failed, and running or paused runs waiting for approval, newest first', async () => {
        await import('../pages/runs/index');
        const element = (renderPage as jest.Mock).mock.calls[0][0];
        renderThemed(element);
        await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(6));
        const states = (listRuns as jest.Mock).mock.calls.map((c) => c[0].state);
        expect(states).toEqual(expect.arrayContaining(['blocked', 'failed', 'running', 'paused']));
        const ids = screen
            .getAllByRole('link')
            .map((a) => decodeURIComponent(a.getAttribute('href') || ''))
            .filter((h) => h.includes('run_id='))
            .map((h) => h.split('run_id=')[1]);
        expect(ids).toEqual(['daily:new', 'daily:approve', 'daily:held', 'daily:paused', 'daily:old']);
    });
});
