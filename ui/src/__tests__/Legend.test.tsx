import React from 'react';
import { screen, within } from '@testing-library/react';
import Legend from '../features/builder/Legend';
import { FAMILY_STYLE, PORT_STYLE } from '../features/builder/nodeStyle';
import { renderThemed } from './fixtures';

describe('Legend', () => {
    test('has one row per family with its label and example kinds', () => {
        renderThemed(<Legend />);
        const rows = screen.getAllByRole('listitem').filter((r) => r.getAttribute('data-family'));
        expect(rows).toHaveLength(8);
        Object.values(FAMILY_STYLE).forEach((f) => expect(screen.getAllByText(f.label).length).toBeGreaterThan(0));
        const write = rows.find((r) => r.getAttribute('data-family') === 'write') as HTMLElement;
        expect(within(write).getByText(/Summary index, Lookup, Event to an index/)).toBeInTheDocument();
        const job = rows.find((r) => r.getAttribute('data-family') === 'job') as HTMLElement;
        expect(within(job).getByText(/Whole job/, { selector: 'span' })).toBeInTheDocument();
        rows.forEach((r) => expect(r.querySelector('svg path')).not.toBeNull());
    });

    test('lists every port glyph with its meaning', () => {
        renderThemed(<Legend />);
        Object.values(PORT_STYLE).forEach((p) => {
            expect(screen.getByText(p.glyph)).toBeInTheDocument();
            expect(screen.getByText(p.label)).toBeInTheDocument();
        });
    });
});
