import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import HelpPage, { splitGuide } from '../features/help/HelpPage';
import { searchGuide } from '../features/help/helpSearch';
import { renderThemed } from './fixtures';

const GUIDE = [
    '# Guide',
    'Intro',
    '## Build a job',
    'Start with a **schedule** or a trigger.',
    '### Tokens',
    'Write `$run.now$` in a search to get the time. Tokens fill in when the step runs.',
    '### Retries',
    'A failed step is tried again.',
    '## Follow runs',
    'Every run is listed with its tokens shown.',
    '```',
    '## not a heading',
    '```',
].join('\n');

describe('searchGuide', () => {
    const { parts } = splitGuide(GUIDE);

    it('finds the ## or ### section a word is in, with its tab and a snippet', () => {
        const hits = searchGuide(parts, 'time');
        expect(hits.map((h) => h.slug)).toEqual(['tokens']);
        expect(hits[0]).toMatchObject({ title: 'Tokens', parent: 'Build a job', tab: 'build' });
        expect(hits[0].snippet).toContain('$run.now$ in a search to get the time');
        expect(hits[0].snippet).not.toContain('`');
    });

    it('needs every word, ignores case and markdown, and ranks a title match first', () => {
        expect(searchGuide(parts, 'SCHEDULE trigger').map((h) => h.slug)).toEqual(['build-a-job']);
        expect(searchGuide(parts, 'schedule retries')).toEqual([]);
        expect(searchGuide(parts, 'tokens').map((h) => h.slug)).toEqual(['tokens', 'follow-runs']);
    });

    it('returns nothing for an empty or one-letter query', () => {
        expect(searchGuide(parts, '')).toEqual([]);
        expect(searchGuide(parts, ' a ')).toEqual([]);
    });

    it('keeps code blocks out of the section titles', () => {
        expect(searchGuide(parts, 'heading').map((h) => h.slug)).toEqual(['follow-runs']);
    });
});

describe('Help page search', () => {
    it('lists matches instead of the tab, and a match opens its section', () => {
        renderThemed(<HelpPage />);
        const box = screen.getByRole('searchbox', { name: 'Search the help' });
        fireEvent.change(box, { target: { value: 'backfill' } });
        const results = screen.getByRole('list', { name: 'Search results' });
        const first = within(results).getAllByRole('link')[0];
        expect(first.getAttribute('href')).toBe('#backfill');
        expect(screen.queryByTestId('help-tab-start')).toBeNull();
        fireEvent.click(first);
        expect(screen.queryByRole('list', { name: 'Search results' })).toBeNull();
        expect(document.getElementById('backfill')).not.toBeNull();
        window.location.hash = '';
    });

    it('says when nothing matches', () => {
        renderThemed(<HelpPage />);
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search the help' }), { target: { value: 'zzqqxx' } });
        expect(screen.getByText('Nothing in the help matches "zzqqxx".')).toBeInTheDocument();
    });
});
