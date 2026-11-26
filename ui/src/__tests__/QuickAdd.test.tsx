import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickAdd from '../features/builder/QuickAdd';
import { CATALOG, searchCatalog, targetKinds } from '../features/builder/nodeCatalog';
import { FAMILY_OF } from '../features/builder/nodeStyle';

describe('nodeCatalog', () => {
    it('ranks label matches first', () => {
        expect(searchCatalog('mail')[0].kind).toBe('email');
        expect(searchCatalog('MAIL')[0].kind).toBe('email');
    });
    it('finds the output nodes', () => {
        expect(searchCatalog('summary')[0].kind).toBe('summary_index');
        expect(searchCatalog('lookup')[0].kind).toBe('lookup');
        expect(CATALOG.find((e) => e.kind === 'summary_index')?.label).toBe('Summary index');
    });
    it('offers summary and lookup as steps, and alert actions as actions', () => {
        expect(targetKinds('success', 'search')).toEqual(expect.arrayContaining(['summary_index', 'lookup', 'alert_action']));
        expect(targetKinds('delayed', 'search')).toContain('alert_action');
        expect(targetKinds('delayed', 'search')).not.toContain('summary_index');
        expect(targetKinds('success', 'job')).not.toContain('lookup');
        expect(targetKinds('then', 'condition')).toContain('lookup');
    });
    it('returns every offered kind for an empty query, filtered by kinds', () => {
        expect(searchCatalog('')).toEqual(CATALOG);
        expect(searchCatalog('', ['email']).map((e) => e.kind)).toEqual(['email']);
    });
    it('offers only action kinds after a delayed port', () => {
        const kinds = targetKinds('delayed', 'search');
        expect(kinds).not.toContain('search');
        expect(kinds).toContain('email');
    });
    it('offers steps and actions after success, and steps only for then', () => {
        expect(targetKinds('success', 'search')).toEqual(expect.arrayContaining(['search', 'email']));
        expect(targetKinds('then', 'condition')).toContain('search');
        expect(targetKinds('then', 'condition')).not.toContain('email');
        expect(targetKinds('success', 'search')).not.toContain('trigger_cron');
    });
    it('offers only actions from the job node', () => {
        expect(targetKinds('success', 'job')).not.toContain('search');
        expect(targetKinds('success', 'job')).toContain('alert_action');
    });
    it('offers everything without a port', () => {
        expect(targetKinds(null, null)).toEqual(CATALOG.map((e) => e.kind));
    });
    it('uses the family map', () => {
        CATALOG.forEach((e) => expect(e.family).toBe(FAMILY_OF[e.kind]));
    });
});

describe('QuickAdd', () => {
    const base = { open: true, at: { left: 10, top: 20 }, onChoose: jest.fn(), onClose: jest.fn() };
    beforeEach(() => jest.clearAllMocks());

    it('renders nothing when closed', () => {
        const { container } = render(<QuickAdd {...base} open={false} />);
        expect(container).toBeEmptyDOMElement();
    });
    it('focuses the input, and choosing with Enter works', async () => {
        render(<QuickAdd {...base} />);
        const input = screen.getByRole('combobox');
        expect(input).toHaveFocus();
        await userEvent.type(input, 'alert{Enter}');
        expect(base.onChoose).toHaveBeenCalledWith('alert_action');
    });
    it('moves the highlight with ArrowDown', async () => {
        render(<QuickAdd {...base} />);
        const input = screen.getByRole('combobox');
        const first = screen.getAllByRole('option')[0];
        expect(first).toHaveAttribute('aria-selected', 'true');
        await userEvent.type(input, '{ArrowDown}');
        expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
        expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
        await userEvent.type(input, '{Enter}');
        expect(base.onChoose).toHaveBeenCalledWith(searchCatalog('')[1].kind);
    });
    it('scrolls the active option into view', async () => {
        const scroll = jest.fn();
        Element.prototype.scrollIntoView = scroll;
        render(<QuickAdd {...base} />);
        await userEvent.type(screen.getByRole('combobox'), '{ArrowDown}');
        const second = screen.getAllByRole('option')[1];
        expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });
        expect(scroll.mock.instances[scroll.mock.instances.length - 1]).toBe(second);
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });
    it('closes on Escape', async () => {
        render(<QuickAdd {...base} />);
        await userEvent.type(screen.getByRole('combobox'), '{Escape}');
        expect(base.onClose).toHaveBeenCalled();
    });
    it('groups by family label and shows descriptions', () => {
        render(<QuickAdd {...base} />);
        expect(screen.getByText('Notify')).toBeInTheDocument();
        expect(screen.getByText('Send an email when the step or job gets here.')).toBeInTheDocument();
    });
    it('chooses on click and respects kinds', async () => {
        render(<QuickAdd {...base} kinds={['email', 'alert_action']} />);
        expect(screen.getAllByRole('option')).toHaveLength(2);
        await userEvent.click(screen.getByText('Alert action'));
        expect(base.onChoose).toHaveBeenCalledWith('alert_action');
    });
    it('says when nothing matches', async () => {
        render(<QuickAdd {...base} />);
        await userEvent.type(screen.getByRole('combobox'), 'zzz');
        expect(screen.getByText('No matching nodes. Try a different word.')).toBeInTheDocument();
    });

    describe('snippets', () => {
        const snippets = [
            { id: 'sn0123456789ab', name: 'Hourly checks', description: 'Count errors each hour', owner: 'alice', updated_at: 1, node_count: 3 },
            { id: 'sn0123456789cd', name: 'Nightly', description: 'Runs hourly too, at night', owner: 'bob', updated_at: 1, node_count: 1 },
            { id: 'sn0123456789ef', name: 'Cleanup', description: 'Delete old lookups', owner: 'bob', updated_at: 1, node_count: 2 },
        ];
        it('lists matching snippets under Snippets, after the node kinds, by name and description', async () => {
            render(<QuickAdd {...base} snippets={snippets} onPickSnippet={jest.fn()} />);
            await userEvent.type(screen.getByRole('combobox'), 'hourly');
            const group = screen.getByRole('group', { name: 'Snippets' });
            expect(within(group).getAllByRole('option').map((o) => o.textContent)).toEqual([
                expect.stringContaining('Hourly checks'),
                expect.stringContaining('Nightly'),
            ]);
            const options = screen.getAllByRole('option');
            expect(options[options.length - 1]).toHaveTextContent('Nightly');
        });
        it('Enter on a snippet picks it; a click does too', async () => {
            const onPickSnippet = jest.fn();
            render(<QuickAdd {...base} snippets={snippets} onPickSnippet={onPickSnippet} />);
            await userEvent.type(screen.getByRole('combobox'), 'nightly{Enter}');
            expect(onPickSnippet).toHaveBeenCalledWith('sn0123456789cd');
            expect(base.onChoose).not.toHaveBeenCalled();
            await userEvent.click(screen.getByRole('option', { name: /^Nightly/ }));
            expect(onPickSnippet).toHaveBeenCalledTimes(2);
        });
        it('has no Snippets section without onPickSnippet', async () => {
            render(<QuickAdd {...base} snippets={snippets} />);
            await userEvent.type(screen.getByRole('combobox'), 'hourly');
            expect(screen.queryByRole('group', { name: 'Snippets' })).toBeNull();
        });
        it('shows why the list failed', () => {
            render(<QuickAdd {...base} snippets={null} snippetError="Snippets couldn't load: KV store is down" onPickSnippet={jest.fn()} />);
            expect(screen.getByText("Snippets couldn't load: KV store is down")).toBeInTheDocument();
        });
    });
});
