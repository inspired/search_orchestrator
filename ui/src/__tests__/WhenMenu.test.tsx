import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WhenMenu from '../features/builder/WhenMenu';
import type { WhenOption } from '../features/builder/outcomes';
import { targetKinds } from '../features/builder/nodeCatalog';

const options: WhenOption[] = [
    { outcome: 'success', label: 'Succeeds', glyph: '✓', count: 2 },
    { outcome: 'failure', label: 'Fails', glyph: '✗', count: 1 },
    { outcome: 'start', label: 'Starts', glyph: '▶', count: 0, note: 'actions only' },
];

describe('WhenMenu', () => {
    const base = { open: true, at: { left: 10, top: 20 }, options, onChoose: jest.fn(), onClose: jest.fn() };
    beforeEach(() => jest.clearAllMocks());

    it('renders nothing when closed', () => {
        const { container } = render(<WhenMenu {...base} open={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('lists each outcome with its glyph, line count and note', () => {
        render(<WhenMenu {...base} />);
        const rows = screen.getAllByRole('option');
        expect(rows).toHaveLength(3);
        expect(rows[0]).toHaveTextContent('✓');
        expect(rows[0]).toHaveTextContent('Succeeds');
        expect(rows[0]).toHaveTextContent('2 lines');
        expect(rows[1]).toHaveTextContent('1 line');
        expect(rows[2]).toHaveTextContent('actions only');
        expect(rows[2]).not.toHaveTextContent('line');
        expect(screen.getByRole('listbox', { name: 'When' })).toHaveFocus();
    });

    it('arrow keys move and Enter chooses', async () => {
        render(<WhenMenu {...base} />);
        const list = screen.getByRole('listbox', { name: 'When' });
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
        await userEvent.type(list, '{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}');
        expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
        expect(list).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
        await userEvent.type(list, '{Enter}');
        expect(base.onChoose).toHaveBeenCalledWith('failure');
    });

    it('chooses on click', async () => {
        render(<WhenMenu {...base} />);
        await userEvent.click(screen.getByText('Starts'));
        expect(base.onChoose).toHaveBeenCalledWith('start');
    });

    it('with search, an outcome then a node chooses both', async () => {
        const kinds = jest.fn((o) => targetKinds(o, 'search'));
        render(<WhenMenu {...base} withSearch={{ kinds }} />);
        await userEvent.type(screen.getByRole('listbox', { name: 'When' }), '{ArrowDown}{Enter}');
        expect(base.onChoose).not.toHaveBeenCalled();
        expect(kinds).toHaveBeenCalledWith('failure');
        const box = screen.getByRole('combobox', { name: 'Add a node' });
        expect(box).toHaveFocus();
        await userEvent.type(box, 'mail{Enter}');
        expect(base.onChoose).toHaveBeenCalledWith('failure', 'email');
    });

    it('with search, the node list offers only what the outcome allows', async () => {
        render(<WhenMenu {...base} withSearch={{ kinds: () => ['email', 'alert_action'] }} />);
        await userEvent.click(screen.getByText('Starts'));
        expect(screen.getAllByRole('option').filter((o) => o.closest('[aria-label="Nodes"]'))).toHaveLength(2);
    });

    it('with search, Shift+Tab or ArrowLeft in an empty box goes back to the outcomes', async () => {
        render(<WhenMenu {...base} withSearch={{ kinds: () => ['email'] }} />);
        const list = screen.getByRole('listbox', { name: 'When' });
        await userEvent.type(list, '{ArrowDown}{Enter}');
        await userEvent.tab({ shift: true });
        expect(list).toHaveFocus();
        await userEvent.type(list, '{Enter}');
        const box = screen.getByRole('combobox', { name: 'Add a node' });
        expect(box).toHaveFocus();
        await userEvent.type(box, 'm{ArrowLeft}');
        expect(box).toHaveFocus();
        await userEvent.clear(box);
        await userEvent.type(box, '{ArrowLeft}');
        expect(list).toHaveFocus();
        expect(base.onChoose).not.toHaveBeenCalled();
    });

    it('Escape closes, in the outcomes and in the search', async () => {
        render(<WhenMenu {...base} withSearch={{ kinds: () => ['email'] }} />);
        await userEvent.type(screen.getByRole('listbox', { name: 'When' }), '{Escape}');
        expect(base.onClose).toHaveBeenCalledTimes(1);
        await userEvent.type(screen.getByRole('listbox', { name: 'When' }), '{Enter}');
        await userEvent.type(screen.getByRole('combobox', { name: 'Add a node' }), '{Escape}');
        expect(base.onClose).toHaveBeenCalledTimes(2);
        expect(base.onChoose).not.toHaveBeenCalled();
    });
});
