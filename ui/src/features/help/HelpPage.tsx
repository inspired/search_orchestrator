/* The in-app help: a visual overview (HelpOverview), then the user guide, rendered, with an
 * anchor on every heading so "Learn more" links elsewhere in the app can jump to a section,
 * and a contents list of the guide's sections beside it on wide screens. */
import React, { useEffect } from 'react';
import Heading from '@splunk/react-ui/Heading';
import Link from '@splunk/react-ui/Link';
import Markdown from '@splunk/react-ui/Markdown';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import guide from '../../../../docs/user-guide.md';
import HelpOverview from './HelpOverview';

/** The anchor GitHub gives a heading, so the guide's own `#section` links work here too. */
export function slugify(heading: string): string {
    return heading
        .toLowerCase()
        .trim()
        .replace(/ /g, '-')
        .replace(/[^a-z0-9-]/g, '');
}

function textOf(node: React.ReactNode): string {
    if (node === null || node === undefined || typeof node === 'boolean') {
        return '';
    }
    if (typeof node === 'string' || typeof node === 'number') {
        return String(node);
    }
    if (Array.isArray(node)) {
        return node.map(textOf).join('');
    }
    if (React.isValidElement(node)) {
        return textOf((node.props as { children?: React.ReactNode }).children);
    }
    return '';
}

function heading({ children, level }: { children: React.ReactNode[]; level: number }) {
    return (
        <Heading level={Math.min(Math.max(level, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6} id={slugify(textOf(children))}>
            {children}
        </Heading>
    );
}

/** Links to other repo docs (admin-guide.md) have no page in the app, so they show as text. */
export function docLink({ children, href, title }: { children: React.ReactNode[]; href?: string; title?: string }) {
    if (href && /\.md(#.*)?$/.test(href)) {
        return <>{children}</>;
    }
    return (
        <Link to={href} title={title}>
            {children}
        </Link>
    );
}

/** The guide's ## headings, in order, for the contents list. */
export function guideSections(text: string): string[] {
    return text
        .split('\n')
        .filter((l) => /^## /.test(l))
        .map((l) => l.slice(3).trim());
}

/** A heading's text as shown: backticks dropped. */
const plain = (h: string) => h.replace(/`/g, '');

export default function HelpPage() {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    useEffect(() => {
        const id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
        const target = id ? document.getElementById(id) : null;
        if (target && target.scrollIntoView) {
            target.scrollIntoView();
        }
    }, []);
    const sections = guideSections(guide);
    return (
        <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-start' }}>
            <nav
                aria-label="Help contents"
                style={{ position: 'sticky', top: '16px', flex: 'none', width: '200px', fontSize: '13px', maxHeight: '90vh', overflowY: 'auto' }}
            >
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>Contents</div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    <li style={{ padding: '3px 0' }}>
                        <a href="#help-overview" style={{ color: theme.contentColorDefault }}>
                            Overview
                        </a>
                    </li>
                    {sections.map((s) => (
                        <li key={s} style={{ padding: '3px 0' }}>
                            <a href={`#${slugify(s)}`} style={{ color: theme.contentColorDefault }}>
                                {plain(s)}
                            </a>
                        </li>
                    ))}
                </ul>
            </nav>
            <div style={{ flex: '1 1 auto', minWidth: 0, maxWidth: '960px' }}>
                <div id="help-overview">
                    <HelpOverview />
                </div>
                <hr style={{ border: 'none', borderTop: `1px solid ${theme.borderColorWeak || theme.borderColor}`, margin: '32px 0 8px' }} />
                <div style={{ maxWidth: '860px' }}>
                    <Markdown text={guide} headingRenderer={heading} linkRenderer={docLink} />
                </div>
            </div>
        </div>
    );
}
