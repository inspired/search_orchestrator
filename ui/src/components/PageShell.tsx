/* The frame every page shares: a heading, optional header actions and the content.
 * renderPage mounts a page with Splunk's layout and the user's theme. */
import React from 'react';
import layout from '@splunk/react-page/18';
import { username } from '@splunk/splunk-utils/config';
import { getThemeOptions, getUserTheme } from '@splunk/splunk-utils/themes';
import { createRESTURL } from '@splunk/splunk-utils/url';
import Heading from '@splunk/react-ui/Heading';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';

export interface PageShellProps {
    title: string;
    description?: React.ReactNode;
    actions?: React.ReactNode;
    children?: React.ReactNode;
}

export default function PageShell({ title, description, actions, children }: PageShellProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    return (
        <div style={{ padding: '16px 24px', color: theme.contentColorDefault }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                <Heading level={1}>{title}</Heading>
                {actions && <div style={{ display: 'flex', gap: '8px' }}>{actions}</div>}
            </div>
            {description && <div style={{ marginBottom: '16px' }}>{description}</div>}
            {children}
        </div>
    );
}

type ColorScheme = 'light' | 'dark';

function systemScheme(): ColorScheme {
    return typeof window !== 'undefined' && window.matchMedia
        && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The user's colour scheme from their Splunk preference (user-prefs.conf [general] theme).
 * Read first because the theme API getUserTheme relies on can be missing from a Splunk
 * version and then silently answers "light". */
export async function userColorScheme(): Promise<ColorScheme | null> {
    try {
        const owner = encodeURIComponent(String(username || '-'));
        const res = await fetch(
            `${createRESTURL('data/user-prefs/general', { app: 'user-prefs', owner })}?output_mode=json`,
            { credentials: 'include' },
        );
        if (!res.ok) {
            return null;
        }
        const body = await res.json();
        const value = String(body?.entry?.[0]?.content?.theme || '').toLowerCase();
        if (value === 'dark' || value === 'light') {
            return value;
        }
        if (value === 'system' || value === 'auto') {
            return systemScheme();
        }
        return null; // "default" or unset: let Splunk's theme API decide
    } catch {
        return null;
    }
}

/** Light or dark for this page: the user preference, else Splunk's theme API, else light. */
export async function resolveColorScheme(): Promise<ColorScheme> {
    const pref = await userColorScheme();
    if (pref) {
        return pref;
    }
    try {
        return getThemeOptions(await getUserTheme()).colorScheme === 'dark' ? 'dark' : 'light';
    } catch {
        return 'light';
    }
}

/** Mounts a page into Splunk's layout, themed to the user's Splunk theme. */
export function renderPage(element: React.ReactElement, pageTitle: string): void {
    resolveColorScheme()
        .then((theme) => layout(element, { pageTitle, theme }))
        .catch(() => layout(element, { pageTitle }));
}

/** The link to a page of this app, relative to the current page (/app/search_orchestrator/<page>). */
export function pageHref(page: string, query: Record<string, string> = {}): string {
    const params = new URLSearchParams(query).toString();
    return params ? `${page}?${params}` : page;
}

/** A query-string parameter of the current page. */
export function queryParam(name: string): string | null {
    return new URLSearchParams(window.location.search).get(name);
}
