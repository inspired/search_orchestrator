import { act, renderHook } from '@testing-library/react';
import type { Issue, JobDefinition, ValidateResponse } from '../api/types';
import useAutoValidate from '../features/builder/useAutoValidate';

const mk = (name: string): JobDefinition => ({ name, enabled: true, steps: [], edges: [] });
const issue = (message: string): Issue => ({ level: 'error', code: 'x', message, step: null });
const reply = (...issues: Issue[]): ValidateResponse => ({ valid: !issues.length, issues, owner_will_change: false, owner: 'alice' });

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i += 1) {
            await Promise.resolve();
        }
    });
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useAutoValidate', () => {
    test('one edit gives one call after 800 ms', async () => {
        const validate = jest.fn().mockResolvedValue(reply());
        const a = mk('a');
        const { rerender } = renderHook(({ job }) => useAutoValidate(job, validate), { initialProps: { job: a } });
        act(() => jest.advanceTimersByTime(800));
        await flush();
        expect(validate).toHaveBeenCalledTimes(1);
        const b = mk('b');
        rerender({ job: b });
        act(() => jest.advanceTimersByTime(799));
        expect(validate).toHaveBeenCalledTimes(1);
        act(() => jest.advanceTimersByTime(1));
        expect(validate).toHaveBeenCalledTimes(2);
        expect(validate).toHaveBeenLastCalledWith(b);
    });

    test('three edits within 800 ms give one call with the last job', async () => {
        const validate = jest.fn().mockResolvedValue(reply());
        const { rerender, result } = renderHook(({ job }) => useAutoValidate(job, validate), { initialProps: { job: mk('a') } });
        const last = mk('d');
        rerender({ job: mk('b') });
        act(() => jest.advanceTimersByTime(500));
        rerender({ job: mk('c') });
        act(() => jest.advanceTimersByTime(500));
        rerender({ job: last });
        act(() => jest.advanceTimersByTime(800));
        await flush();
        expect(validate).toHaveBeenCalledTimes(1);
        expect(validate).toHaveBeenCalledWith(last);
        expect(result.current.checkedJob).toBe(last);
    });

    test('a stale reply never overwrites the newer job issues', async () => {
        let resolveA: (r: ValidateResponse) => void = () => undefined;
        const validate = jest
            .fn()
            .mockImplementationOnce(() => new Promise<ValidateResponse>((res) => (resolveA = res)))
            .mockResolvedValueOnce(reply(issue('from B')));
        const a = mk('a');
        const b = mk('b');
        const { rerender, result } = renderHook(({ job }) => useAutoValidate(job, validate), { initialProps: { job: a } });
        act(() => jest.advanceTimersByTime(800));
        rerender({ job: b });
        act(() => jest.advanceTimersByTime(800));
        await flush();
        expect(result.current.issues.map((i) => i.message)).toEqual(['from B']);
        expect(result.current.checkedJob).toBe(b);
        await act(async () => {
            resolveA(reply(issue('from A')));
        });
        await flush();
        expect(result.current.issues.map((i) => i.message)).toEqual(['from B']);
        expect(result.current.checkedJob).toBe(b);
        expect(result.current.checking).toBe(false);
    });

    test('checking is true while the latest request is in flight', async () => {
        let resolve: (r: ValidateResponse) => void = () => undefined;
        const validate = jest.fn().mockImplementation(() => new Promise<ValidateResponse>((res) => (resolve = res)));
        const job = mk('a');
        const { result } = renderHook(() => useAutoValidate(job, validate));
        expect(result.current.checking).toBe(false);
        act(() => jest.advanceTimersByTime(800));
        expect(result.current.checking).toBe(true);
        await act(async () => resolve(reply()));
        await flush();
        expect(result.current.checking).toBe(false);
    });

    test('enabled false never calls', () => {
        const validate = jest.fn().mockResolvedValue(reply());
        renderHook(() => useAutoValidate(mk('a'), validate, { enabled: false }));
        act(() => jest.advanceTimersByTime(5000));
        expect(validate).not.toHaveBeenCalled();
    });

    test('a rejected call keeps the previous issues', async () => {
        const validate = jest.fn().mockResolvedValueOnce(reply(issue('kept'))).mockRejectedValueOnce(new Error('down'));
        const { rerender, result } = renderHook(({ job }) => useAutoValidate(job, validate), { initialProps: { job: mk('a') } });
        act(() => jest.advanceTimersByTime(800));
        await flush();
        rerender({ job: mk('b') });
        act(() => jest.advanceTimersByTime(800));
        await flush();
        expect(validate).toHaveBeenCalledTimes(2);
        expect(result.current.issues.map((i) => i.message)).toEqual(['kept']);
        expect(result.current.checking).toBe(false);
    });

    test('accept applies only for the latest job', async () => {
        const validate = jest.fn().mockResolvedValue(reply());
        const a = mk('a');
        const b = mk('b');
        const { rerender, result } = renderHook(({ job }) => useAutoValidate(job, validate), { initialProps: { job: a } });
        rerender({ job: b });
        act(() => result.current.accept(a, reply(issue('old'))));
        expect(result.current.issues).toEqual([]);
        act(() => result.current.accept(b, reply(issue('new'))));
        expect(result.current.issues.map((i) => i.message)).toEqual(['new']);
        expect(result.current.checkedJob).toBe(b);
    });
});
