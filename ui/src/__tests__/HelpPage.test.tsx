import React from 'react';
import { screen, within } from '@testing-library/react';
import HelpPage, { docLink, guideSections, slugify } from '../features/help/HelpPage';
import { FEATURES } from '../features/help/HelpOverview';
import { ILLUSTRATIONS } from '../features/help/helpIllustrations';
import LearnMore, { helpHref } from '../components/LearnMore';
import { renderThemed } from './fixtures';
import guide from '../../../docs/user-guide.md';

describe('slugify', () => {
    it('matches GitHub anchors', () => {
        expect(slugify('Results of earlier steps')).toBe('results-of-earlier-steps');
        expect(slugify('Make steps safe to re-run')).toBe('make-steps-safe-to-re-run');
        expect(slugify('The `| orchestrate` command')).toBe('the--orchestrate-command');
    });
});

describe('HelpPage', () => {
    it('renders guide headings with anchor ids', () => {
        renderThemed(<HelpPage />);
        const tokens = document.getElementById('tokens');
        expect(tokens).not.toBeNull();
        expect(tokens!.tagName).toBe('H3'); // the guide's Tokens heading is ###
    });
});

describe('HelpPage overview', () => {
    const headingSlugs = guide
        .split('\n')
        .filter((l: string) => /^#{1,6} /.test(l))
        .map((l: string) => slugify(l.replace(/^#+ /, '')));

    it('draws the example flow, node shapes, line colours and feature cards', () => {
        renderThemed(<HelpPage />);
        expect(screen.getByRole('img', { name: /An example job/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Node shapes' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Line colours' })).toBeInTheDocument();
        const overview = within(screen.getByTestId('help-overview'));
        FEATURES.forEach((f) => expect(overview.getByRole('link', { name: new RegExp(`^${f.title.replace(/[|]/g, '\\$&')}`) }).getAttribute('href')).toBe(`#${f.anchor}`));
    });

    it('links every feature card to a heading of the guide', () => {
        FEATURES.forEach((f) => expect(headingSlugs).toContain(f.anchor));
    });

    it('lists the guide sections in the contents', () => {
        renderThemed(<HelpPage />);
        const nav = screen.getByRole('navigation', { name: 'Help contents' });
        const sections = guideSections(guide);
        expect(sections).toContain('Calendar');
        sections.forEach((s) => expect(nav.querySelector(`a[href="#${slugify(s)}"]`)).not.toBeNull());
        expect(nav.querySelector('a[href="#help-overview"]')).not.toBeNull();
    });
});

describe('HelpPage illustrations', () => {
    const top = guide
        .split('\n')
        .filter((l: string) => /^#{2,3} /.test(l))
        .map((l: string) => slugify(l.replace(/^#+ /, '')));

    it('has an illustration for every ## and ### heading, and none for a heading that is gone', () => {
        top.forEach((s: string) => expect(Object.keys(ILLUSTRATIONS)).toContain(s));
        Object.keys(ILLUSTRATIONS).forEach((s) => expect(top).toContain(s));
    });

    it('draws them under their headings', () => {
        renderThemed(<HelpPage />);
        expect(screen.getAllByTestId('help-figure')).toHaveLength(top.length);
        const calendar = document.getElementById('calendar')!;
        expect(calendar.nextElementSibling!.getAttribute('data-testid')).toBe('help-figure');
    });
});

describe('HelpPage links', () => {
    it('shows links to other repo docs as plain text, and keeps other links', () => {
        renderThemed(<HelpPage />);
        expect(screen.queryByRole('link', { name: 'admin guide' })).toBeNull();
        expect(document.body.textContent).toContain('Admins: see the admin guide.');
        expect(screen.getAllByRole('link').some((a) => /\.md(#|$)/.test(a.getAttribute('href') || ''))).toBe(false);
        expect(screen.getAllByRole('link').some((a) => (a.getAttribute('href') || '').startsWith('#'))).toBe(true);
    });

    it('docLink renders .md hrefs as text', () => {
        renderThemed(
            <>
                {docLink({ href: 'admin-guide.md', children: ['Admin'] })}
                {docLink({ href: 'admin-guide.md#install', children: ['Install'] })}
                {docLink({ href: '#tokens', children: ['Tokens'] })}
            </>
        );
        expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
        expect(screen.queryByRole('link', { name: 'Install' })).toBeNull();
        expect(screen.getByRole('link', { name: 'Tokens' }).getAttribute('href')).toBe('#tokens');
    });
});

describe('LearnMore', () => {
    it('links to the help page anchor', () => {
        renderThemed(<LearnMore anchor="tokens" topic="tokens" />);
        const link = screen.getByRole('link', { name: /Learn more about tokens/ });
        expect(link.getAttribute('href')).toBe(helpHref('tokens'));
        expect(helpHref('tokens')).toMatch(/help#tokens$/);
    });
});

declare const __dirname: string;
declare const require: (id: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');

describe('Learn more anchors', () => {
    const headings = new Set((guide as string).split('\n').filter((l) => /^#{1,6} /.test(l)).map((l) => slugify(l.replace(/^#+ /, ''))));
    const root = `${__dirname}/..`;
    const files: string[] = [];
    const walk = (dir: string) => {
        fs.readdirSync(dir, { withFileTypes: true }).forEach((e: { name: string; isDirectory: () => boolean }) => {
            const full = `${dir}/${e.name}`;
            if (e.isDirectory()) {
                if (e.name !== '__tests__') walk(full);
            } else if (/\.tsx?$/.test(e.name)) {
                files.push(full);
            }
        });
    };
    walk(root);
    const all = (re: RegExp, text: string): string[] => {
        const out: string[] = [];
        let m = re.exec(text);
        while (m) {
            out.push(m[1]);
            m = re.exec(text);
        }
        return out;
    };
    const anchors = files.flatMap((f) => all(/<LearnMore\s+anchor="([^"]+)"/g, fs.readFileSync(f, 'utf8')));

    it('finds the LearnMore links in the source', () => {
        expect(anchors.length).toBeGreaterThanOrEqual(6);
    });

    it.each(Array.from(new Set(anchors)))('anchor %s matches a heading in the user guide', (anchor) => {
        expect(headings.has(anchor)).toBe(true);
    });

    it('every in-guide link points at a heading', () => {
        const links = all(/\]\(#([^)]+)\)/g, guide as string);
        links.forEach((l) => expect(headings.has(l)).toBe(true));
    });
});
