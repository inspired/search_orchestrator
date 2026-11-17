import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { getCalendar } from '../api/calendar';
import type { CalendarItem } from '../api/calendar';
import { listJobs } from '../api/client';
import { renderPage } from '../components/PageShell';
import { job, renderThemed } from './fixtures';

jest.mock('../api/calendar', () => ({
    getCalendar: jest.fn(),
}));
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

// Wednesday 18 November 2026, 12:00 local time. Only Date is faked; timers stay real.
const NOW = new Date(2026, 10, 18, 12, 0);
const at = (hours: number) => Math.floor(new Date(2026, 10, 18, hours).getTime() / 1000);

const items: CalendarItem[] = [
    {
        kind: 'run',
        job_id: 'daily',
        job_name: 'Daily summary',
        run_id: 'daily:1',
        state: 'failed',
        trigger: 'cron',
        scheduled_time: at(10),
        started_at: at(10),
        ended_at: at(10) + 600,
        late: false,
    },
    { kind: 'scheduled', job_id: 'weekly', job_name: 'Weekly rollup', time: at(14) },
    { kind: 'backfill', job_id: 'daily', job_name: 'Daily summary', backfill_id: 'bf1', time: at(16) },
];

let page: React.ReactElement;
const assign = jest.fn();
const realLocation = window.location;

beforeAll(async () => {
    await import('../pages/calendar/index');
    page = (renderPage as jest.Mock).mock.calls[0][0];
    // jsdom cannot navigate, so the page's navigation is recorded instead.
    delete (window as { location?: Location }).location;
    (window as { location: unknown }).location = { ...realLocation, assign };
});

afterAll(() => {
    (window as { location: Location }).location = realLocation;
});

beforeEach(() => {
    jest.useFakeTimers({
        now: NOW,
        doNotFake: [
            'hrtime',
            'nextTick',
            'performance',
            'queueMicrotask',
            'requestAnimationFrame',
            'cancelAnimationFrame',
            'requestIdleCallback',
            'cancelIdleCallback',
            'setImmediate',
            'clearImmediate',
            'setInterval',
            'clearInterval',
            'setTimeout',
            'clearTimeout',
        ],
    });
    assign.mockReset();
    (getCalendar as jest.Mock).mockReset();
    (getCalendar as jest.Mock).mockResolvedValue({ items, truncated: false });
    (listJobs as jest.Mock).mockReset();
    (listJobs as jest.Mock).mockResolvedValue([job({ id: 'daily', name: 'Daily summary' }), job({ id: 'weekly', name: 'Weekly rollup' })]);
});

afterEach(() => {
    jest.useRealTimers();
});

const lastCall = () => {
    const calls = (getCalendar as jest.Mock).mock.calls;
    return calls[calls.length - 1];
};
const dayHeadings = () => within(screen.getByRole('region', { name: 'Calendar' })).getAllByRole('heading', { level: 3 });

describe('Calendar page', () => {
    it('shows a week of seven days from Monday and says the time zone', async () => {
        renderThemed(page);
        await screen.findByRole('button', { name: /^Daily summary, Failed/ });
        expect(dayHeadings()).toHaveLength(7);
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        expect(screen.getByText(`Times are in your browser's time zone (${zone}).`)).toBeInTheDocument();
        const [from, to, jobId] = (getCalendar as jest.Mock).mock.calls[0];
        expect(from).toBe(Math.floor(new Date(2026, 10, 16).getTime() / 1000));
        expect(to).toBe(Math.floor(new Date(2026, 10, 23).getTime() / 1000));
        expect(jobId).toBeUndefined();
    });

    it('opens a run on click and a scheduled or backfill item in the builder', async () => {
        renderThemed(page);
        fireEvent.click(await screen.findByRole('button', { name: /^Daily summary, Failed/ }));
        expect(assign).toHaveBeenLastCalledWith('run?run_id=daily%3A1');
        fireEvent.click(screen.getByRole('button', { name: /^Weekly rollup, Scheduled/ }));
        expect(assign).toHaveBeenLastCalledWith('builder?job_id=weekly');
        fireEvent.keyDown(screen.getByRole('button', { name: /^Backfill · Daily summary/ }), { key: 'Enter' });
        expect(assign).toHaveBeenLastCalledWith('builder?job_id=daily');
    });

    it('draws a run with its state words and a scheduled item with a dashed border', async () => {
        renderThemed(page);
        const runButton = await screen.findByRole('button', { name: /^Daily summary, Failed/ });
        expect(within(runButton).getByText('Failed')).toBeInTheDocument();
        expect(runButton.style.borderLeftWidth).toBe('3px');
        expect(screen.getByRole('button', { name: /^Weekly rollup, Scheduled/ }).style.borderStyle).toBe('dashed');
    });

    it('moves focus to the next day heading with ArrowRight', async () => {
        renderThemed(page);
        await screen.findByRole('button', { name: /^Daily summary, Failed/ });
        const heads = dayHeadings();
        heads[2].focus();
        fireEvent.keyDown(heads[2], { key: 'ArrowRight' });
        expect(document.activeElement).toBe(heads[3]);
        fireEvent.keyDown(heads[3], { key: 'ArrowLeft' });
        expect(document.activeElement).toBe(heads[2]);
    });

    it('says when only the first 2,000 items are shown', async () => {
        (getCalendar as jest.Mock).mockResolvedValue({ items, truncated: true });
        renderThemed(page);
        expect(await screen.findByText('Showing the first 2,000 items; pick one job to see all.')).toBeInTheDocument();
    });

    it('moves the range by seven days with Previous and Next', async () => {
        renderThemed(page);
        await screen.findByRole('button', { name: /^Daily summary, Failed/ });
        const first = (getCalendar as jest.Mock).mock.calls[0][0];
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        await waitFor(() => expect((getCalendar as jest.Mock).mock.calls.length).toBe(2));
        expect((getCalendar as jest.Mock).mock.calls[1][0]).toBe(first + 7 * 86400);
        fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
        fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
        await waitFor(() => expect(lastCall()[0]).toBe(first - 7 * 86400));
    });

    it('shows one day in the Day view', async () => {
        renderThemed(page);
        await screen.findByRole('button', { name: /^Daily summary, Failed/ });
        fireEvent.click(screen.getByRole('radio', { name: 'Day' }));
        await waitFor(() => expect(dayHeadings()).toHaveLength(1));
        await waitFor(() => expect(lastCall()).toEqual([at(0), at(0) + 86400, undefined]));
    });

    it('collapses the fourth and later items of a half hour into "+N more", beside the lanes', async () => {
        const busy: CalendarItem[] = [0, 60, 120, 600, 1200].map((d, i) => ({
            kind: 'scheduled',
            job_id: `j${i}`,
            job_name: `Job ${i}`,
            time: at(9) + d,
        }));
        (getCalendar as jest.Mock).mockResolvedValue({ items: busy, truncated: false });
        renderThemed(page);
        const more = await screen.findByRole('button', { name: /^2 more at / });
        expect(more).toHaveTextContent('+2 more');
        // The lanes fill the column but a 52 px strip at its right edge, where "+N more" sits.
        const lanes = more.parentElement as HTMLElement;
        expect(lanes.style.right).toBe('52px');
        expect(more.style.right).toBe('-50px');
        expect(more.style.width).toBe('48px');
        expect(more.style.left).toBe('');
        expect(screen.getByRole('button', { name: /^Job 0, Scheduled/ }).parentElement).toBe(lanes);
        expect(screen.queryByRole('button', { name: /^Job 3/ })).toBeNull();
        fireEvent.click(more);
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('button', { name: /^Job 3, Scheduled/ })).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: /^Job 4, Scheduled/ }));
        expect(assign).toHaveBeenLastCalledWith('builder?job_id=j4');
        const closes = within(dialog).getAllByRole('button', { name: 'Close' });
        fireEvent.click(closes[closes.length - 1]);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await waitFor(() => expect(document.activeElement).toBe(more));
    });

    it('shows a late run as Late', async () => {
        (getCalendar as jest.Mock).mockResolvedValue({ items: [{ ...items[0], late: true }], truncated: false });
        renderThemed(page);
        const runButton = await screen.findByRole('button', { name: /^Daily summary, Failed, late/ });
        expect(within(runButton).getByText('Late')).toBeInTheDocument();
    });

    it('moves the day with ArrowRight in the Day view and keeps focus on its heading', async () => {
        renderThemed(page);
        await screen.findByRole('button', { name: /^Daily summary, Failed/ });
        fireEvent.click(screen.getByRole('radio', { name: 'Day' }));
        await waitFor(() => expect(dayHeadings()).toHaveLength(1));
        const before = dayHeadings()[0].textContent;
        dayHeadings()[0].focus();
        fireEvent.keyDown(dayHeadings()[0], { key: 'ArrowRight' });
        await waitFor(() => expect(lastCall()[0]).toBe(at(0) + 86400));
        expect(dayHeadings()[0].textContent).not.toBe(before);
        expect(document.activeElement).toBe(dayHeadings()[0]);
    });

    it('says when the calendar could not be loaded', async () => {
        (getCalendar as jest.Mock).mockRejectedValue(new Error('Server is down'));
        renderThemed(page);
        expect(await screen.findByText('The calendar could not be loaded: Server is down')).toBeInTheDocument();
    });
});
