import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import LogsPage, { initialFilters } from '../features/logs/LogsPage';
import { logsHref } from '../features/logs/logsHref';
import type { LogsResponse } from '../api/logs';
import { renderThemed } from './fixtures';

const RESPONSE: LogsResponse = {
    lines: [
        {
            time: '2026-11-19T10:00:05.000+00:00',
            level: 'ERROR',
            process: 'engine',
            event: 'step_dispatch_error',
            run_id: 'daily:1',
            step_id: 'a',
            raw: '2026-11-19 10:00:05,000 +0000 level=ERROR process=engine event=step_dispatch_error run_id="daily:1"',
        },
        { time: '2026-11-19T10:00:00.000+00:00', level: 'INFO', process: 'rest', event: 'request', raw: 'event=request method="GET"' },
    ],
    notes: [],
    spl: 'search index=_internal source="*search_orchestrator.*.log" | head 200',
    earliest: '-24h',
    latest: 'now',
};

const api = () => ({ searchLogs: jest.fn(() => Promise.resolve(RESPONSE)) });

describe('Troubleshooting page', () => {
    beforeEach(() => window.history.replaceState(null, '', '/app/search_orchestrator/logs'));

    test('loads the last 24 hours, shows lines with run links and opens in Search', async () => {
        const a = api();
        renderThemed(<LogsPage api={a} />);
        const first = await screen.findByTestId('log-line-0');
        expect(a.searchLogs).toHaveBeenCalledWith(expect.objectContaining({ range: '24h' }));
        expect(first).toHaveTextContent('ERROR');
        expect(first).toHaveTextContent('Engine');
        expect(within(first).getByRole('link', { name: 'daily:1 · a' }).getAttribute('href')).toBe('run?run_id=daily%3A1&step=a');
        expect(screen.getByTestId('log-line-1')).toHaveTextContent('Screens and API');
        const open = screen.getByRole('link', { name: /Open this search in Search/ });
        expect(decodeURIComponent(open.getAttribute('href') || '')).toContain('q=search index=_internal');
        fireEvent.click(within(first).getByRole('button', { expanded: false }));
        expect(within(first).getByRole('button', { expanded: true })).toBeInTheDocument();
    });

    test('quick views set the filters and search again', async () => {
        const a = api();
        renderThemed(<LogsPage api={a} />);
        await screen.findByTestId('log-line-0');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Errors and warnings' }));
        });
        await waitFor(() => expect(a.searchLogs).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'WARNING', process: '' })));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'The engine' }));
        });
        await waitFor(() => expect(a.searchLogs).toHaveBeenLastCalledWith(expect.objectContaining({ process: 'engine' })));
    });

    test('notes and errors are shown', async () => {
        const a = { searchLogs: jest.fn(() => Promise.resolve({ ...RESPONSE, lines: [], notes: ['No log lines match.'] })) };
        renderThemed(<LogsPage api={a} />);
        expect(await screen.findByText('No log lines match.')).toBeInTheDocument();
        const b = { searchLogs: jest.fn(() => Promise.reject(new Error('boom'))) };
        renderThemed(<LogsPage api={b} />);
        expect(await screen.findByText('The logs could not be searched: boom')).toBeInTheDocument();
    });

    test('filters come from the address; the run page links here for a run and a step', () => {
        expect(logsHref('daily:1', 'a')).toBe('logs?run_id=daily%3A1&level=DEBUG&range=7d&step_id=a');
        window.history.replaceState(null, '', '/app/search_orchestrator/logs?run_id=daily%3A1&step_id=a&level=debug&range=7d');
        expect(initialFilters()).toMatchObject({ run_id: 'daily:1', step_id: 'a', level: 'DEBUG', range: '7d' });
        window.history.replaceState(null, '', '/app/search_orchestrator/logs?range=1y&level=loud');
        expect(initialFilters()).toMatchObject({ range: '24h', level: '' });
    });
});
