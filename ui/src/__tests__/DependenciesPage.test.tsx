import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { listJobs } from '../api/client';
import { renderPage } from '../components/PageShell';
import { job, renderThemed } from './fixtures';

jest.mock('../api/client', () => ({
    listJobs: jest.fn(),
}));
jest.mock('../components/PageShell', () => ({
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    renderPage: jest.fn(),
    pageHref: (page: string, query: Record<string, string> = {}) => {
        const params = new URLSearchParams(query).toString();
        return params ? `${page}?${params}` : page;
    },
    queryParam: () => null,
}));

const now = Math.floor(Date.now() / 1000);

const jobs = [
    job({
        id: 'daily',
        name: 'Daily summary',
        owner: 'alice',
        last_run: {
            id: 'daily:1',
            state: 'succeeded',
            trigger: 'cron',
            scheduled_time: now - 300,
            started_at: now - 300,
            ended_at: now - 240,
            delay_alerted: false,
            held: false,
            gave_up: false,
        },
    }),
    job({ id: 'weekly', name: 'Weekly rollup', owner: 'bob', enabled: false, triggers: [{ type: 'completion', job: 'daily' }] }),
    job({ id: 'cleanup', name: 'Cleanup', triggers: [{ type: 'completion', job: 'secret', on: 'complete' }] }),
    job({ id: 'lonely', name: 'Lonely job' }),
];

let page: React.ReactElement;

beforeAll(async () => {
    await import('../pages/dependencies/index');
    page = (renderPage as jest.Mock).mock.calls[0][0];
});

beforeEach(() => {
    (listJobs as jest.Mock).mockReset();
    (listJobs as jest.Mock).mockResolvedValue(jobs);
});

const node = (name: string) => screen.getByRole('button', { name: new RegExp(`^Job ${name}`) });

describe('Dependencies page', () => {
    it('draws every job with its owner, last run and when it ran', async () => {
        renderThemed(page);
        await waitFor(() => expect(node('Daily summary')).toBeInTheDocument());
        const daily = node('Daily summary');
        expect(within(daily).getByText('Daily summary')).toBeInTheDocument();
        expect(within(daily).getByText('alice')).toBeInTheDocument();
        expect(within(daily).getByText('Succeeded')).toBeInTheDocument();
        expect(within(daily).getByText('5 minutes ago')).toBeInTheDocument();
        const weekly = node('Weekly rollup');
        expect(within(weekly).getByText('Turned off')).toBeInTheDocument();
        expect(within(weekly).getByText('Never run')).toBeInTheDocument();
    });

    it('shows a job the viewer cannot see without its id', async () => {
        renderThemed(page);
        await waitFor(() => expect(screen.getAllByText("Job you can't see").length).toBeGreaterThan(0));
        expect(document.body.textContent).not.toContain('secret');
    });

    it('lists jobs with no lines in a Not connected row', async () => {
        renderThemed(page);
        const row = await screen.findByRole('group', { name: 'Not connected' });
        expect(within(row).getByRole('button', { name: 'Lonely job' })).toBeInTheDocument();
    });

    it('selects a job with Enter and opens it from the panel', async () => {
        renderThemed(page);
        await waitFor(() => expect(node('Daily summary')).toBeInTheDocument());
        fireEvent.keyDown(node('Daily summary'), { key: 'Enter' });
        const panel = screen.getByRole('region', { name: 'Daily summary' });
        expect(within(panel).getByText('Weekly rollup (after it succeeds)')).toBeInTheDocument();
        expect(within(panel).getByRole('link', { name: 'Open job' })).toHaveAttribute('href', 'builder?job_id=daily');
        expect(within(panel).getByRole('link', { name: 'Open runs' })).toHaveAttribute('href', 'runs?job_id=daily');
        // Its downstream job stays at full opacity; an unrelated one is dimmed.
        expect(node('Weekly rollup')).toHaveAttribute('opacity', '1');
        expect(node('Cleanup')).toHaveAttribute('opacity', '0.35');
    });

    it('shows the same as a table in the List view', async () => {
        renderThemed(page);
        await waitFor(() => expect(node('Daily summary')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('radio', { name: 'List' }));
        const table = screen.getByRole('table');
        const heads = within(table).getAllByRole('columnheader').map((c) => c.textContent);
        expect(heads).toEqual(['Job', 'Started by', 'Starts']);
        const rows = within(table)
            .getAllByRole('row')
            .slice(1)
            .map((r) => within(r).getAllByRole('cell').map((c) => c.textContent).join(' · '));
        expect(rows).toContain('Weekly rollup · Daily summary (after it succeeds) · —');
        expect(rows).toContain("Cleanup · Job you can't see (after it finishes) · —");
    });

    it('says when the jobs could not be loaded', async () => {
        (listJobs as jest.Mock).mockRejectedValue(new Error('Server is down'));
        renderThemed(page);
        expect(await screen.findByText('The jobs could not be loaded: Server is down')).toBeInTheDocument();
    });
});
