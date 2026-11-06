import { resolveColorScheme, userColorScheme } from '../components/PageShell';

jest.mock('@splunk/react-page/18', () => jest.fn());
jest.mock('@splunk/splunk-utils/themes', () => ({
    getUserTheme: jest.fn(() => Promise.resolve('enterprise')),
    getThemeOptions: (t: string) => ({ colorScheme: t === 'dark' || t === 'enterpriseDark' ? 'dark' : 'light' }),
}));

function prefs(theme: string | undefined, ok = true) {
    globalThis.fetch = jest.fn(() => Promise.resolve({
        ok,
        json: () => Promise.resolve({ entry: [{ content: theme === undefined ? {} : { theme } }] }),
    })) as unknown as typeof fetch;
}

test('dark user preference wins over a theme API that answers light', async () => {
    prefs('dark');
    expect(await resolveColorScheme()).toBe('dark');
    const called = String((globalThis.fetch as jest.Mock).mock.calls[0][0]);
    expect(called).toContain('user-prefs/data/user-prefs/general');
});

test('light preference is light; default falls back to the theme API', async () => {
    prefs('light');
    expect(await resolveColorScheme()).toBe('light');
    prefs('default');
    expect(await userColorScheme()).toBeNull();
    expect(await resolveColorScheme()).toBe('light');
});

test('a failed preference read falls back without throwing', async () => {
    prefs(undefined, false);
    expect(await userColorScheme()).toBeNull();
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(await resolveColorScheme()).toBe('light');
});
