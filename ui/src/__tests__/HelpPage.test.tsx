import React from 'react';
import { screen } from '@testing-library/react';
import HelpPage, { slugify } from '../features/help/HelpPage';
import LearnMore, { helpHref } from '../components/LearnMore';
import { renderThemed } from './fixtures';

describe('slugify', () => {
    it('matches GitHub anchors', () => {
        expect(slugify('From previous steps')).toBe('from-previous-steps');
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
