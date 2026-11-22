import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CanvasMenu from '../features/builder/CanvasMenu';
import { renderThemed } from './fixtures';

const items = [
    { id: 'rename', label: 'Rename' },
    { id: 'preview', label: 'Preview', disabled: true, reason: 'A preview never writes to an index.' },
    { id: 'remove', label: 'Remove' },
];

describe('CanvasMenu', () => {
    const base = { open: true, at: { left: 10, top: 20 }, label: 'Node', items, onChoose: jest.fn(), onClose: jest.fn() };
    beforeEach(() => jest.clearAllMocks());

    it('renders nothing when closed', () => {
        const { container } = renderThemed(<CanvasMenu {...base} open={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('lists the items, takes focus, and shows a refusal reason on a dimmed item', () => {
        renderThemed(<CanvasMenu {...base} />);
        expect(screen.getAllByRole('menuitem').map((r) => r.textContent)).toEqual(['Rename', 'PreviewA preview never writes to an index.', 'Remove']);
        expect(screen.getByRole('menu', { name: 'Node' })).toHaveFocus();
        expect(screen.getByRole('menuitem', { name: /^Preview/ })).toHaveAttribute('aria-disabled', 'true');
    });

    it('a click or Enter chooses; a dimmed item cannot be chosen', async () => {
        renderThemed(<CanvasMenu {...base} />);
        await userEvent.click(screen.getByText('Remove'));
        expect(base.onChoose).toHaveBeenLastCalledWith('remove');
        await userEvent.click(screen.getByText('Preview'));
        expect(base.onChoose).toHaveBeenCalledTimes(1);
        await userEvent.click(screen.getByText('Rename'));
        expect(base.onChoose).toHaveBeenLastCalledWith('rename');
        await userEvent.type(screen.getByRole('menu', { name: 'Node' }), '{ArrowUp}{ArrowDown}{Enter}');
        expect(base.onChoose).toHaveBeenCalledTimes(2);
    });

    it('arrows move; Escape closes', async () => {
        renderThemed(<CanvasMenu {...base} />);
        const menu = screen.getByRole('menu', { name: 'Node' });
        await userEvent.type(menu, '{ArrowDown}{ArrowDown}{Enter}');
        expect(base.onChoose).toHaveBeenLastCalledWith('remove');
        await userEvent.type(menu, '{Escape}');
        expect(base.onClose).toHaveBeenCalled();
    });
});
