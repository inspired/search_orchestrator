/* The frame every page shares: a heading, optional header actions and the content.
 * renderPage mounts a page with Splunk's layout and the user's theme. */
import React from 'react';
import layout from '@splunk/react-page/18';
import { getUserTheme } from '@splunk/splunk-utils/themes';
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

/** Mounts a page into Splunk's layout, themed to the user's Splunk theme. */
export function renderPage(element: React.ReactElement, pageTitle: string): void {
    getUserTheme()
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
