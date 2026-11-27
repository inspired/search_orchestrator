import React from 'react';
import { screen, within } from '@testing-library/react';
import Legend from '../features/builder/Legend';
import { FAMILY_STYLE, PORT_STYLE } from '../features/builder/nodeStyle';
import { OUTCOME_LABEL, Outcome } from '../features/builder/outcomes';
import { renderThemed } from './fixtures';

describe('Legend', () => {
    test('has one row per family with its label and example kinds', () => {
        renderThemed(<Legend />);
        const rows = screen.getAllByRole('listitem').filter((r) => r.getAttribute('data-family'));
        expect(rows).toHaveLength(8); // no Whole job: its actions are on the Job actions tab
        Object.entries(FAMILY_STYLE)
            .filter(([k]) => k !== 'job')
            .forEach(([, f]) => expect(screen.getAllByText(f.label).length).toBeGreaterThan(0));
        const write = rows.find((r) => r.getAttribute('data-family') === 'write') as HTMLElement;
        expect(within(write).getByText(/Summary index, Lookup, Event to an index/)).toBeInTheDocument();
        const notify = rows.find((r) => r.getAttribute('data-family') === 'notify') as HTMLElement;
        expect(within(notify).getByText(/Email, Alert action/)).toBeInTheDocument();
        expect(rows.find((r) => r.getAttribute('data-family') === 'job')).toBeUndefined();
        rows.forEach((r) => expect(r.querySelector('svg path')).not.toBeNull());
    });

    test('lists every When outcome with its glyph, and shows an example + and tab', () => {
        renderThemed(<Legend />);
        const when = screen.getByRole('list', { name: 'When' });
        (Object.keys(OUTCOME_LABEL) as Outcome[]).forEach((o) => {
            const row = within(when).getByText(OUTCOME_LABEL[o]).closest('li') as HTMLElement;
            expect(within(row).getByText(PORT_STYLE[o].glyph)).toBeInTheDocument();
        });
        expect(within(when).getAllByText('actions only')).toHaveLength(4);
        expect(screen.queryByText('Succeeded')).toBeNull();
        expect(screen.getByTestId('legend-plus')).toBeInTheDocument();
        expect(screen.getByText(/Point at a node to show \+; click it to choose what happens next/)).toBeInTheDocument();
        expect(screen.getByTestId('legend-tab')).toHaveTextContent('✓');
        expect(screen.getByText(/drag it to add another line/)).toBeInTheDocument();
        expect(screen.getByText(/Lines are coloured by outcome/)).toBeInTheDocument();
        expect(screen.getByText(/View → Line labels/)).toBeInTheDocument();
    });
});
