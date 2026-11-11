/* The in-app help: the user guide, rendered, with an anchor on every heading so
 * "Learn more" links elsewhere in the app can jump to a section. */
import React, { useEffect } from 'react';
import Heading from '@splunk/react-ui/Heading';
import Markdown from '@splunk/react-ui/Markdown';
import guide from '../../../../docs/user-guide.md';

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

export default function HelpPage() {
    useEffect(() => {
        const id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
        const target = id ? document.getElementById(id) : null;
        if (target && target.scrollIntoView) {
            target.scrollIntoView();
        }
    }, []);
    return (
        <div style={{ maxWidth: '860px' }}>
            <Markdown text={guide} headingRenderer={heading} />
        </div>
    );
}
