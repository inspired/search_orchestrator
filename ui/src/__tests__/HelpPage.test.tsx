import React from 'react';
import { screen } from '@testing-library/react';
import HelpPage, { slugify } from '../features/help/HelpPage';
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
