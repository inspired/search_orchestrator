import { act, renderHook } from '@testing-library/react';
import usePoll from '../hooks/usePoll';

function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
}

/** Lets resolved promises run their callbacks. */
async function flush() {
    await act(async () => {
        for (let i = 0; i < 5; i += 1) {
            await Promise.resolve();
        }
    });
}

beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

afterEach(() => {
    jest.useRealTimers();
});

describe('usePoll', () => {
    test('loads at once, then on every interval', async () => {
        let n = 0;
        const fn = jest.fn(() => Promise.resolve(++n));
        const { result } = renderHook(() => usePoll(fn, 5000, true));
        await flush();
        expect(fn).toHaveBeenCalledTimes(1);
        expect(result.current.data).toBe(1);
        expect(result.current.loading).toBe(false);
        act(() => jest.advanceTimersByTime(5000));
        await flush();
        expect(fn).toHaveBeenCalledTimes(2);
        expect(result.current.data).toBe(2);
    });

    test('a hidden tab pauses polling and showing it loads at once', async () => {
        const fn = jest.fn(() => Promise.resolve('x'));
        renderHook(() => usePoll(fn, 5000, true));
        await flush();
        expect(fn).toHaveBeenCalledTimes(1);
        act(() => setVisibility('hidden'));
        act(() => jest.advanceTimersByTime(20000));
        await flush();
        expect(fn).toHaveBeenCalledTimes(1);
        act(() => setVisibility('visible'));
        await flush();
        expect(fn).toHaveBeenCalledTimes(2);
        act(() => jest.advanceTimersByTime(5000));
        await flush();
        expect(fn).toHaveBeenCalledTimes(3);
    });

    test('no overlap when the request is slower than the interval', async () => {
        let resolve: (v: string) => void = () => undefined;
        const fn = jest.fn(() => new Promise<string>((r) => { resolve = r; }));
        const { result } = renderHook(() => usePoll(fn, 1000, true));
        act(() => jest.advanceTimersByTime(10000));
        act(() => setVisibility('visible'));
        await flush();
        expect(fn).toHaveBeenCalledTimes(1);
        await act(async () => resolve('done'));
        await flush();
        expect(result.current.data).toBe('done');
        act(() => jest.advanceTimersByTime(1000));
        await flush();
        expect(fn).toHaveBeenCalledTimes(2);
    });

    test('refresh during a request waits for it and drops its stale result', async () => {
        const resolvers: Array<(v: string) => void> = [];
        const fn = jest.fn(() => new Promise<string>((r) => { resolvers.push(r); }));
        const { result } = renderHook(() => usePoll(fn, 5000, false));
        act(() => result.current.refresh());
        expect(fn).toHaveBeenCalledTimes(1);
        await act(async () => resolvers[0]('old'));
        await flush();
        expect(fn).toHaveBeenCalledTimes(2);
        expect(result.current.data).toBeUndefined();
        await act(async () => resolvers[1]('new'));
        await flush();
        expect(result.current.data).toBe('new');
    });

    test('unmount clears the interval, removes the listener and sets no state', async () => {
        let resolve: (v: string) => void = () => undefined;
        const fn = jest.fn(() => new Promise<string>((r) => { resolve = r; }));
        const clearSpy = jest.spyOn(globalThis, 'clearInterval');
        const removeSpy = jest.spyOn(document, 'removeEventListener');
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const { unmount } = renderHook(() => usePoll(fn, 1000, true));
        unmount();
        expect(clearSpy).toHaveBeenCalled();
        expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
        await act(async () => resolve('late'));
        await flush();
        act(() => jest.advanceTimersByTime(5000));
        act(() => setVisibility('visible'));
        await flush();
        expect(fn).toHaveBeenCalledTimes(1);
        expect(errorSpy).not.toHaveBeenCalled();
        clearSpy.mockRestore();
        removeSpy.mockRestore();
        errorSpy.mockRestore();
    });
});
