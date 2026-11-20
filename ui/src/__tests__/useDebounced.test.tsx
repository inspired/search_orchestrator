import { renderHook, waitFor } from '@testing-library/react';
import useDebounced from '../hooks/useDebounced';

test('passes on only the last value after the pause', async () => {
    const seen: string[] = [];
    const { result, rerender } = renderHook(
        ({ value }) => {
            const settled = useDebounced(value, 20);
            seen.push(settled);
            return settled;
        },
        { initialProps: { value: 'a' } }
    );
    rerender({ value: 'ab' });
    rerender({ value: 'abc' });
    expect(result.current).toBe('a');
    await waitFor(() => expect(result.current).toBe('abc'));
    expect(seen).not.toContain('ab');
});
