import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickAdd from '../features/builder/QuickAdd';
import { CATALOG, searchCatalog, targetKinds } from '../features/builder/nodeCatalog';
import { FAMILY_OF } from '../features/builder/nodeStyle';

describe('nodeCatalog', () => {
    it('ranks label matches first', () => {
        expect(searchCatalog('mail')[0].kind).toBe('email');
        expect(searchCatalog('MAIL')[0].kind).toBe('email');
    });
    it('finds the output and Slack nodes', () => {
        expect(searchCatalog('summary')[0].kind).toBe('summary_index');
        expect(searchCatalog('lookup')[0].kind).toBe('lookup');
        expect(searchCatalog('slack')[0].kind).toBe('slack');
        expect(CATALOG.find((e) => e.kind === 'summary_index')?.label).toBe('Summary index');
    });
    it('offers summary and lookup as steps and Slack as an action', () => {
        expect(targetKinds('success', 'search')).toEqual(expect.arrayContaining(['summary_index', 'lookup', 'slack']));
        expect(targetKinds('delayed', 'search')).toContain('slack');
        expect(targetKinds('delayed', 'search')).not.toContain('summary_index');
        expect(targetKinds('success', 'job')).toContain('slack');
        expect(targetKinds('success', 'job')).not.toContain('lookup');
        expect(targetKinds('then', 'condition')).toContain('lookup');
        expect(targetKinds('then', 'condition')).not.toContain('slack');
    });
    it('finds Teams, PagerDuty and ServiceNow by their words and offers them as actions', () => {
        expect(searchCatalog('page').map((e) => e.kind)).toContain('pagerduty');
        expect(searchCatalog('page')[0].kind).toBe('pagerduty');
        expect(searchCatalog('on-call').map((e) => e.kind)).toEqual(['pagerduty']);
        expect(searchCatalog('teams')[0].kind).toBe('teams');
        expect(searchCatalog('snow').map((e) => e.kind)).toEqual(['servicenow']);
        expect(searchCatalog('ticket').map((e) => e.kind)).toEqual(['servicenow']);
        expect(searchCatalog('incident').map((e) => e.kind)).toEqual(['pagerduty', 'servicenow']);
        expect(CATALOG.find((e) => e.kind === 'teams')?.label).toBe('Microsoft Teams');
        ['teams', 'pagerduty', 'servicenow'].forEach((k) => {
            expect(targetKinds('failure', 'search')).toContain(k);
            expect(targetKinds('late', 'job')).toContain(k);
            expect(targetKinds('then', 'condition')).not.toContain(k);
        });
    });
    it('returns everything for an empty query, filtered by kinds', () => {
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
        expect(targetKinds('success', 'job')).toContain('webhook');
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
        await userEvent.type(input, 'web{Enter}');
        expect(base.onChoose).toHaveBeenCalledWith('webhook');
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
        render(<QuickAdd {...base} kinds={['email', 'webhook']} />);
        expect(screen.getAllByRole('option')).toHaveLength(2);
        await userEvent.click(screen.getByText('Webhook'));
        expect(base.onChoose).toHaveBeenCalledWith('webhook');
    });
    it('says when nothing matches', async () => {
        render(<QuickAdd {...base} />);
        await userEvent.type(screen.getByRole('combobox'), 'zzz');
        expect(screen.getByText('No matching nodes. Try a different word.')).toBeInTheDocument();
    });
});
