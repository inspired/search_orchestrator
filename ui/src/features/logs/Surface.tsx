/* The Troubleshooting page's surface: the colour Splunk's charts draw on (black in dark mode,
 * white in light mode) for the whole page, so the charts, single values and tables sit on one
 * background. Splunk components below read it as their page background. */
import React, { useEffect, useMemo } from 'react';
import SplunkThemeProvider from '@splunk/themes/SplunkThemeProvider';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import { PALETTES, schemeOf } from './palette';

export default function LogsSurface({ children }: { children?: React.ReactNode }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const scheme = schemeOf(theme);
    const surface = PALETTES[scheme].surface;
    const customize = useMemo(() => {
        const fn = (vars: Record<string, unknown>) => ({ ...vars, backgroundColorPage: surface });
        return Object.assign(fn, { customizerName: `so-logs-${scheme}` });
    }, [surface, scheme]);
    useEffect(() => {
        if (typeof document === 'undefined') {
            return undefined;
        }
        const before = document.body.style.backgroundColor;
        document.body.style.backgroundColor = surface;
        return () => {
            document.body.style.backgroundColor = before;
        };
    }, [surface]);
    return (
        <SplunkThemeProvider
            family={theme.family as 'enterprise' | 'prisma'}
            colorScheme={scheme}
            density={theme.density as 'comfortable' | 'compact'}
            customizeTheme={customize as never}
        >
            <div data-testid="logs-surface" data-scheme={scheme} style={{ background: surface, minHeight: '100vh' }}>
                {children}
            </div>
        </SplunkThemeProvider>
    );
}
