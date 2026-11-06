import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import PreviewResult from '../features/builder/PreviewResult';
import type { PreviewView } from '../features/builder/usePreviews';
import { renderThemed } from './fixtures';

const NOW_MS = 1762390800000;

function view(over: Partial<PreviewView> = {}): PreviewView {
    return { key: 'k', state: 'done', startedAt: NOW_MS - 1000, stale: false, ...over };
}

function rows(n: number) {
    return Array.from({ length: n }, (_v, i) => ({ host: `h${i}`, count: String(i) }));
}

function renderResult(preview: PreviewView | undefined, handlers: { onCancel?: () => void; onAnyway?: () => void } = {}) {
    const onCancel = handlers.onCancel || jest.fn();
    const onAnyway = handlers.onAnyway || jest.fn();
    renderThemed(<PreviewResult preview={preview} onCancel={onCancel} onAnyway={onAnyway} />);
    return { onCancel, onAnyway };
}

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW_MS));
afterEach(() => jest.restoreAllMocks());

describe('PreviewResult', () => {
    test('always shows the access note', () => {
        renderResult(undefined);
        expect(screen.getByText("Previews run with your access. Real runs use the owner's.")).toBeInTheDocument();
    });

    test('running: spinner text and a Cancel button', () => {
        const { onCancel } = renderResult(view({ state: 'running', sid: 's' }));
        expect(screen.getByText('Previewing…')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalled();
    });

    test('done: summary line with live input and a table', () => {
        renderResult(
            view({
                sid: 's',
                status: { state: 'done', result_count: 3, run_duration: 0.4, messages: [] },
                results: { fields: ['host', 'count'], rows: rows(3), total: 3 },
                input: { mode: 'live', steps: [{ id: 'daily', at: NOW_MS - 120000 }] },
            })
        );
        expect(screen.getByText('3 rows · 0.4 s · input: daily preview, 2 min ago')).toBeInTheDocument();
        expect(screen.getByRole('table')).toBeInTheDocument();
        expect(screen.getByText('host')).toBeInTheDocument();
        expect(screen.getByText('h2')).toBeInTheDocument();
        expect(screen.queryByText(/showing/)).not.toBeInTheDocument();
    });

    test('done: run input and "showing 100 of N"', () => {
        const at = new Date(2026, 10, 5, 1, 0).getTime() / 1000;
        renderResult(
            view({
                sid: 's',
                status: { state: 'done', result_count: 250, run_duration: 2, messages: [] },
                results: { fields: ['host', 'count'], rows: rows(100), total: 250 },
                input: { mode: 'run', scheduledTime: at },
            })
        );
        expect(screen.getByText('250 rows · 2.0 s · input: run 2026-11-05 01:00')).toBeInTheDocument();
        expect(screen.getByText('showing 100 of 250')).toBeInTheDocument();
    });

    test('done: one row, no input, previewed anyway', () => {
        renderResult(
            view({
                sid: 's',
                anyway: true,
                status: { state: 'done', result_count: 1, run_duration: 0.12, messages: [{ type: 'WARN', text: 'Field x not found' }] },
                results: { fields: ['host'], rows: rows(1), total: 1 },
            })
        );
        expect(screen.getByText('1 row · 0.1 s · previewed anyway')).toBeInTheDocument();
        expect(screen.getByText('Field x not found')).toBeInTheDocument();
    });

    test('failed: an error Message with the error', () => {
        renderResult(view({ state: 'failed', error: 'Preview stopped after 10 minutes' }));
        expect(screen.getByText('Preview stopped after 10 minutes')).toBeInTheDocument();
    });

    test('failed: the truncation text when there is no error', () => {
        renderResult(
            view({ state: 'failed', status: { state: 'failed', result_count: 0, truncated: 'append stopped at 50000 rows', messages: [] } })
        );
        expect(screen.getByText('append stopped at 50000 rows')).toBeInTheDocument();
    });

    test('skipped: the reason and Preview anyway', () => {
        const { onAnyway } = renderResult(view({ state: 'skipped', skipped: 'run_when', reason: 'runs on Mondays' }));
        expect(screen.getByText('Would be skipped: runs on Mondays')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Preview anyway' }));
        expect(onAnyway).toHaveBeenCalled();
    });

    test('stale: the last table dimmed under the out-of-date note', () => {
        renderResult(
            view({
                sid: 's',
                stale: true,
                status: { state: 'done', result_count: 3, run_duration: 0.4, messages: [] },
                results: { fields: ['host', 'count'], rows: rows(3), total: 3 },
            })
        );
        expect(screen.getByText('Out of date. Preview again to refresh.')).toBeInTheDocument();
        expect(screen.getByTestId('preview-table')).toHaveStyle({ opacity: '0.5' });
    });

    test('a fresh table is not dimmed', () => {
        renderResult(
            view({
                sid: 's',
                status: { state: 'done', result_count: 3, run_duration: 0.4, messages: [] },
                results: { fields: ['host', 'count'], rows: rows(3), total: 3 },
            })
        );
        expect(screen.getByTestId('preview-table')).not.toHaveStyle({ opacity: '0.5' });
    });

    test('"Search sent" shows the exact spl', () => {
        renderResult(view({ state: 'running', sid: 's', spl: '| loadjob "sid-a" | stats count' }));
        fireEvent.click(screen.getByRole('button', { name: /Search sent/ }));
        expect(screen.getByText('| loadjob "sid-a" | stats count')).toBeInTheDocument();
    });

    test('missing: says the search job expired', () => {
        renderResult(view({ state: 'missing', sid: 's' }));
        expect(screen.getByText('This preview has expired on the server. Preview again to refresh.')).toBeInTheDocument();
    });

    test('the input line names skipped and failed inputs and ticks once a minute', () => {
        jest.restoreAllMocks();
        jest.useFakeTimers();
        jest.setSystemTime(NOW_MS);
        renderResult(
            view({
                status: { state: 'done', result_count: 1, run_duration: 0.4, messages: [] },
                input: {
                    mode: 'live',
                    steps: [
                        { id: 'a', at: NOW_MS - 30000 },
                        { id: 'b', at: NOW_MS - 30000, skipped: 'run_when' },
                        { id: 'f', at: NOW_MS - 30000, failed: true },
                    ],
                },
            })
        );
        expect(screen.getByText('1 row · 0.4 s · input: a preview, just now; b skipped; f failed preview, just now')).toBeInTheDocument();
        act(() => {
            jest.advanceTimersByTime(60000);
        });
        expect(screen.getByText('1 row · 0.4 s · input: a preview, 1 min ago; b skipped; f failed preview, 1 min ago')).toBeInTheDocument();
        jest.useRealTimers();
    });
});
