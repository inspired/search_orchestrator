/* The in-app help, in tabs: Get started (a visual overview, then the first sections of the
 * guide), Build jobs, Follow runs, Troubleshoot, How it works and Reference, each showing its
 * ## sections of the user guide. Every heading has an anchor, so "Learn more" links elsewhere
 * in the app, and the guide's own #links, open the right tab and jump to the section. The
 * contents beside it list every tab's sections, and the open tab's ### headings. Every ## and
 * ### heading has an illustration under it (helpIllustrations). A search box above the
 * contents finds sections by their words (helpSearch) and lists them instead of the tab. */
import React, { useEffect, useMemo, useState } from 'react';
import Heading from '@splunk/react-ui/Heading';
import Link from '@splunk/react-ui/Link';
import Markdown from '@splunk/react-ui/Markdown';
import Search from '@splunk/react-ui/Search';
import TabBar from '@splunk/react-ui/TabBar';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import guide from '../../../../docs/user-guide.md';
import HelpOverview from './HelpOverview';
import { ILLUSTRATIONS } from './helpIllustrations';
import { searchGuide } from './helpSearch';

import { slugify } from './slug';

export { slugify };

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
    const id = slugify(textOf(children));
    const Illustration = level <= 3 ? ILLUSTRATIONS[id] : undefined;
    return (
        <>
            <Heading level={Math.min(Math.max(level, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6} id={id}>
                {children}
            </Heading>
            {Illustration && <Illustration />}
        </>
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

export type HelpTab = 'start' | 'build' | 'runs' | 'troubleshoot' | 'how' | 'reference';

/** The tabs of the help page and the guide's ## sections (by anchor) in each. A section not
 * listed goes to Reference, so nothing written in the guide is ever hidden. */
export const HELP_TABS: Array<{ id: HelpTab; label: string; sections: string[] }> = [
    { id: 'start', label: 'Get started', sections: ['get-started'] },
    { id: 'build', label: 'Build jobs', sections: ['build-a-job', 'steps-and-searches', 'conditions-tokens-and-parameters', 'triggers-and-deadlines', 'notifications'] },
    { id: 'runs', label: 'Follow runs', sections: ['follow-runs', 'dependencies', 'calendar', 'backfill', 're-run-from-a-step'] },
    { id: 'troubleshoot', label: 'Troubleshoot', sections: ['troubleshooting'] },
    { id: 'how', label: 'How it works', sections: ['how-it-works'] },
    { id: 'reference', label: 'Reference', sections: ['the--orchestrate-command', 'audit-events'] },
];

export interface GuidePart {
    title: string;
    slug: string;
    /** The section's markdown, its ## heading first. */
    text: string;
    /** Its ### headings. */
    subs: Array<{ title: string; slug: string }>;
    tab: HelpTab;
}

/** The guide without its GitHub-only blocks (between `<!-- github-only -->` and
 * `<!-- /github-only -->`): the banner, figures and contents the repository page shows,
 * which the app has its own versions of. */
export function withoutGithubOnly(text: string): string {
    const out: string[] = [];
    let skipping = false;
    text.split('\n').forEach((line) => {
        if (/^<!-- github-only -->\s*$/.test(line)) {
            skipping = true;
        } else if (/^<!-- \/github-only -->\s*$/.test(line)) {
            skipping = false;
        } else if (!skipping) {
            out.push(line);
        }
    });
    return out.join('\n');
}

/** The guide cut at its ## headings; the text before the first one is `intro`. */
export function splitGuide(text: string): { intro: string; parts: GuidePart[] } {
    const lines = withoutGithubOnly(text).split('\n');
    const intro: string[] = [];
    const parts: GuidePart[] = [];
    let fence = false;
    lines.forEach((line) => {
        if (/^```/.test(line)) {
            fence = !fence;
        }
        if (!fence && /^## /.test(line)) {
            const title = line.slice(3).trim();
            const slug = slugify(title);
            const tab = (HELP_TABS.find((t) => t.sections.includes(slug)) || HELP_TABS[HELP_TABS.length - 1]).id;
            parts.push({ title, slug, text: line, subs: [], tab });
            return;
        }
        const cur = parts[parts.length - 1];
        if (!cur) {
            if (!/^# /.test(line)) {
                intro.push(line);
            }
            return;
        }
        cur.text += `\n${line}`;
        if (!fence && /^### /.test(line)) {
            const title = line.slice(4).trim();
            cur.subs.push({ title, slug: slugify(title) });
        }
    });
    return { intro: intro.join('\n').trim(), parts };
}

/** The tab that holds an anchor (a ## or ### heading, or the overview). */
export function tabOf(anchor: string, parts: GuidePart[]): HelpTab | null {
    if (anchor === 'help-overview') {
        return 'start';
    }
    const part = parts.find((p) => p.slug === anchor || p.subs.some((s) => s.slug === anchor));
    return part ? part.tab : null;
}

const hashAnchor = () => {
    try {
        return decodeURIComponent(window.location.hash.replace(/^#/, ''));
    } catch (err) {
        return '';
    }
};

export default function HelpPage() {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const { intro, parts } = useMemo(() => splitGuide(guide), []);
    const [tab, setTab] = useState<HelpTab>(() => tabOf(hashAnchor(), parts) || 'start');
    const [anchor, setAnchor] = useState<string>(hashAnchor);
    const [query, setQuery] = useState('');
    const hits = useMemo(() => searchGuide(parts, query), [parts, query]);
    const searching = query.trim().length > 1;
    const tabLabel = (id: string) => (HELP_TABS.find((t) => t.id === id) || HELP_TABS[0]).label;
    const open = (slug: string) => {
        const t = tabOf(slug, parts);
        if (t) {
            setTab(t);
        }
        setQuery('');
        setAnchor(slug);
    };

    // A link to a heading on another tab (Learn more, the guide's own #links, the contents)
    // switches to that tab, then scrolls to the heading.
    useEffect(() => {
        const onHash = () => {
            const a = hashAnchor();
            const t = tabOf(a, parts);
            if (t) {
                setTab(t);
            }
            setAnchor(a);
        };
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, [parts]);
    useEffect(() => {
        const target = anchor ? document.getElementById(anchor) : null;
        if (target && target.scrollIntoView) {
            target.scrollIntoView();
        }
    }, [anchor, tab]);

    const shown = parts.filter((p) => p.tab === tab);
    const link = (slug: string, text: string, sub = false) => (
        <li key={slug} style={{ padding: sub ? '2px 0 2px 12px' : '3px 0' }}>
            <a href={`#${slug}`} style={{ color: sub ? theme.contentColorMuted : theme.contentColorDefault, fontSize: sub ? '12px' : undefined }}>
                {plain(text)}
            </a>
        </li>
    );
    return (
        <div>
            <TabBar activeTabId={tab} onChange={(_e: unknown, { selectedTabId }: { selectedTabId?: string }) => setTab((selectedTabId as HelpTab) || 'start')}>
                {HELP_TABS.map((t) => (
                    <TabBar.Tab key={t.id} tabId={t.id} label={t.label} />
                ))}
            </TabBar>
            <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-start', marginTop: '16px' }}>
                <nav aria-label="Help contents" style={{ position: 'sticky', top: '16px', flex: 'none', width: '210px', fontSize: '13px', maxHeight: '90vh', overflowY: 'auto' }}>
                    <div style={{ marginBottom: '12px' }}>
                        <Search
                            aria-label="Search the help"
                            placeholder="Search the help"
                            value={query}
                            onChange={(_e: unknown, { value }: { value: string }) => setQuery(value)}
                        />
                    </div>
                    {HELP_TABS.map((t) => {
                        const mine = parts.filter((p) => p.tab === t.id);
                        const current = t.id === tab;
                        return (
                            <div key={t.id} style={{ marginBottom: '10px' }}>
                                <div style={{ fontWeight: 600, color: current ? theme.contentColorActive || theme.contentColorDefault : theme.contentColorMuted, marginBottom: '2px' }}>{t.label}</div>
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                    {t.id === 'start' && link('help-overview', 'Overview')}
                                    {mine.map((p) => (
                                        <React.Fragment key={p.slug}>
                                            {link(p.slug, p.title)}
                                            {current && p.subs.map((sub) => link(sub.slug, sub.title, true))}
                                        </React.Fragment>
                                    ))}
                                </ul>
                            </div>
                        );
                    })}
                </nav>
                <div style={{ flex: '1 1 auto', minWidth: 0, maxWidth: '960px' }}>
                    {searching && (
                        <div style={{ maxWidth: '860px' }}>
                            <Heading level={2}>Search results</Heading>
                            {hits.length === 0 ? (
                                <p>Nothing in the help matches "{query.trim()}".</p>
                            ) : (
                                <ul aria-label="Search results" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                    {hits.map((h) => (
                                        <li key={h.slug} style={{ padding: '8px 0', borderBottom: `1px solid ${theme.borderColorWeak || theme.borderColor}` }}>
                                            <a
                                                href={`#${h.slug}`}
                                                onClick={() => open(h.slug)}
                                                style={{ fontWeight: 600, color: theme.contentColorDefault }}
                                            >
                                                {h.title}
                                            </a>
                                            <span style={{ color: theme.contentColorMuted, fontSize: '12px', marginLeft: '8px' }}>
                                                {[tabLabel(h.tab), h.parent].filter(Boolean).join(' › ')}
                                            </span>
                                            <div style={{ color: theme.contentColorMuted, fontSize: '13px', marginTop: '2px' }}>{h.snippet}</div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                    {!searching && tab === 'start' && (
                        <>
                            {intro && (
                                <div style={{ maxWidth: '860px' }}>
                                    <Markdown text={intro} linkRenderer={docLink} />
                                </div>
                            )}
                            <div id="help-overview">
                                <HelpOverview />
                            </div>
                            <hr style={{ border: 'none', borderTop: `1px solid ${theme.borderColorWeak || theme.borderColor}`, margin: '32px 0 8px' }} />
                        </>
                    )}
                    {!searching && (
                        <div style={{ maxWidth: '860px' }} data-testid={`help-tab-${tab}`}>
                            <Markdown text={shown.map((p) => p.text).join('\n\n')} headingRenderer={heading} linkRenderer={docLink} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
