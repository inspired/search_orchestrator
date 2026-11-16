import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LineMenu from '../features/builder/LineMenu';
import type { WhenOption } from '../features/builder/outcomes';

const outcomes: WhenOption[] = [
    { outcome: 'failure', label: 'Fails', glyph: '✗', count: 0 },
    { outcome: 'always', label: 'Finishes either way', glyph: '∞', count: 0 },
];

describe('LineMenu', () => {
    const base = { open: true, at: { left: 10, top: 20 }, outcomes, canInsert: true, canRemove: true, onChoose: jest.fn(), onClose: jest.fn() };
    beforeEach(() => jest.clearAllMocks());

    it('renders nothing when closed', () => {
        const { container } = render(<LineMenu {...base} open={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('lists the outcome changes, then Insert a node and Remove line, and takes focus', () => {
        render(<LineMenu {...base} />);
        const rows = screen.getAllByRole('option');
        expect(rows.map((r) => r.textContent)).toEqual(['✗Change to Fails', '∞Change to Finishes either way', 'Insert a node', 'Remove line']);
        expect(screen.getByRole('listbox', { name: 'Line' })).toHaveFocus();
    });

    it('leaves out Insert a node and Remove line when they are not allowed', () => {
        render(<LineMenu {...base} canInsert={false} canRemove={false} />);
        expect(screen.getAllByRole('option')).toHaveLength(2);
        expect(screen.queryByText('Insert a node')).toBeNull();
    });

    it('a click chooses an outcome', async () => {
        render(<LineMenu {...base} />);
        await userEvent.click(screen.getByText('Change to Finishes either way'));
        expect(base.onChoose).toHaveBeenCalledWith({ kind: 'outcome', outcome: 'always' });
    });

    it('arrow keys move and Enter chooses insert or remove', async () => {
        render(<LineMenu {...base} />);
        const list = screen.getByRole('listbox', { name: 'Line' });
        await userEvent.type(list, '{ArrowDown}{ArrowDown}{Enter}');
        expect(base.onChoose).toHaveBeenLastCalledWith({ kind: 'insert' });
        await userEvent.type(list, '{ArrowDown}{ArrowDown}{Enter}');
        expect(base.onChoose).toHaveBeenLastCalledWith({ kind: 'remove' });
    });

    it('Escape closes', async () => {
        render(<LineMenu {...base} />);
        await userEvent.type(screen.getByRole('listbox', { name: 'Line' }), '{Escape}');
        expect(base.onClose).toHaveBeenCalled();
    });

    it('with nothing to offer, says so', () => {
        render(<LineMenu {...base} outcomes={[]} canInsert={false} canRemove={false} />);
        expect(screen.queryAllByRole('option')).toHaveLength(0);
        expect(screen.getByText('Nothing can change on this line.')).toBeInTheDocument();
    });
});
