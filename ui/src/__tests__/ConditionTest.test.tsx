import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '../api/client';
import * as client from '../api/client';
import * as conditionTest from '../api/conditionTest';
import type { JobDefinition, PreviewInput } from '../api/types';
import ConditionTest from '../features/builder/ConditionTest';
import { POLL_MS } from '../features/builder/usePreviews';

jest.mock('../api/conditionTest');
jest.mock('../api/client', () => ({ ...jest.requireActual('../api/client'), previewStatus: jest.fn(), cancelPreview: jest.fn() }));

const testCondition = conditionTest.testCondition as jest.Mock;
const previewStatus = client.previewStatus as jest.Mock;
const cancelPreview = client.cancelPreview as jest.Mock;

const base: JobDefinition = {
    name: 'j',
    enabled: true,
    steps: [
        { id: 'daily', name: 'Daily summary', type: 'inline', spl: '| makeresults' },
        { id: 'b', type: 'inline', spl: '| makeresults' },
    ],
    edges: [{ from: 'daily', to: 'b', condition: 'expression', expression: '$daily.resultCount$ > 0', expression_kind: 'simple' }],
};
const withEdge = (changes: Record<string, unknown>): JobDefinition => ({ ...base, edges: [{ ...base.edges![0], ...changes }] });
const ctx = { scheduledTime: 1762300800, params: {}, source: 'live' };
const input: PreviewInput = { mode: 'live', previews: {} };
const inputFor = () => input;

const view = (job: JobDefinition, preview = jest.fn()) => (
    <ConditionTest job={job} from="daily" to="b" ctx={ctx} inputFor={inputFor} preview={preview} />
);

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i += 1) {
            await Promise.resolve();
        }
    });
}

beforeEach(() => {
    jest.useFakeTimers();
    testCondition.mockReset();
    previewStatus.mockReset();
    cancelPreview.mockReset().mockResolvedValue({ cancelled: true });
});
afterEach(() => jest.useRealTimers());

async function click(name: string) {
    fireEvent.click(screen.getByRole('button', { name }));
    await flush();
}

describe('ConditionTest', () => {
    test('simple: true with the why text and the filled text with a Copy button', async () => {
        testCondition.mockResolvedValue({ status: 'done', kind: 'simple', result: true, why: '3 > 0 is true', filled: '3 > 0', values: { 'daily.resultCount': '3' } });
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        render(view(base));
        await click('Test condition');
        expect(screen.getByText('True: the line would be taken')).toBeTruthy();
        expect(screen.getByText('3 > 0 is true')).toBeTruthy();
        expect(screen.getByText('3 > 0').closest('pre,code')).toBeTruthy();
        await click('Copy');
        expect(writeText).toHaveBeenCalledWith('3 > 0');
    });

    test('SPL: Testing… then true with the row count, and false with no rows', async () => {
        testCondition.mockResolvedValue({ status: 'started', kind: 'search', sid: 's1', spl: 'search x', earliest: null, latest: 'now' });
        previewStatus.mockResolvedValueOnce({ state: 'running', result_count: 0, messages: [] }).mockResolvedValue({ state: 'done', result_count: 3, messages: [] });
        render(view(withEdge({ expression_kind: 'search', expression: 'index=main' })));
        await click('Test condition');
        expect(screen.getByText('Testing…')).toBeTruthy();
        act(() => jest.advanceTimersByTime(POLL_MS));
        await flush();
        expect(screen.getByText('True: the line would be taken')).toBeTruthy();
        expect(screen.getByText('3 rows')).toBeTruthy();
        expect(previewStatus).toHaveBeenCalledWith('s1', 300);
    });

    test('SPL with no rows is false', async () => {
        testCondition.mockResolvedValue({ status: 'started', kind: 'eval', sid: 's2', spl: 'x', earliest: null, latest: null });
        previewStatus.mockResolvedValue({ state: 'done', result_count: 0, messages: [] });
        render(view(withEdge({ expression_kind: 'eval', expression: '1 == 2' })));
        await click('Test condition');
        expect(screen.getByText('False: the line would not be taken')).toBeTruthy();
    });

    test('a failed search is false with its error', async () => {
        testCondition.mockResolvedValue({ status: 'started', kind: 'search', sid: 's3', spl: 'x', earliest: null, latest: null });
        previewStatus.mockResolvedValue({ state: 'failed', result_count: 0, error: 'Unknown search command', messages: [] });
        render(view(withEdge({ expression_kind: 'search', expression: 'index=main | nope' })));
        await click('Test condition');
        expect(screen.getByText('False: the line would not be taken')).toBeTruthy();
        expect(screen.getByText('Unknown search command')).toBeTruthy();
    });

    test('a 400 reply shows its message as the error', async () => {
        testCondition.mockRejectedValue(new ApiError(400, 'invalid', 'token $x.first.y$ has no value; preview x first'));
        render(view(withEdge({ expression_kind: 'eval', expression: '$x.first.y$ > 1' })));
        await click('Test condition');
        expect(screen.getByText('token $x.first.y$ has no value; preview x first')).toBeTruthy();
    });

    test('needs_preview offers to preview the step', async () => {
        testCondition.mockRejectedValue(new ApiError(409, 'needs_preview', 'preview first', [], { steps: ['daily'] }));
        const preview = jest.fn();
        render(view(base, preview));
        await click('Test condition');
        expect(screen.getByText('Preview Daily summary first to test this condition.')).toBeTruthy();
        await click('Preview Daily summary');
        expect(preview).toHaveBeenCalledWith('daily');
    });

    test('changing the expression after a result says it is out of date', async () => {
        testCondition.mockResolvedValue({ status: 'done', kind: 'simple', result: true, why: 'w', filled: 'f' });
        const { rerender } = render(view(base));
        await click('Test condition');
        expect(screen.queryByText('Out of date. Test again.')).toBeNull();
        rerender(view(withEdge({ expression: '$daily.resultCount$ > 5' })));
        expect(screen.getByText('Out of date. Test again.')).toBeTruthy();
    });

    test('unmounting while running cancels the search', async () => {
        testCondition.mockResolvedValue({ status: 'started', kind: 'search', sid: 's9', spl: 'x', earliest: null, latest: null });
        previewStatus.mockResolvedValue({ state: 'running', result_count: 0, messages: [] });
        const { unmount } = render(view(withEdge({ expression_kind: 'search', expression: 'index=main' })));
        await click('Test condition');
        unmount();
        expect(cancelPreview).toHaveBeenCalledWith('s9');
    });
});
