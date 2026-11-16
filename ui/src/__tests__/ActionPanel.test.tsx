import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import ActionPanel from '../features/builder/ActionPanel';
import JobNodePanel from '../features/builder/JobNodePanel';
import type { JobDefinition } from '../api/types';
import { renderThemed } from './fixtures';

const job = (): JobDefinition => ({
    name: 'j',
    enabled: true,
    steps: [
        { id: 'a', name: 'Daily summary', type: 'inline', spl: '| makeresults', actions: [{ hook: 'on_failure', type: 'email', to: 'ops@x.com' }] },
        { id: 'b', name: 'Weekly', type: 'inline', spl: '| makeresults', actions: [{ hook: 'on_success', type: 'email', to: 'q@x.com' }] },
    ],
    edges: [],
    actions: [{ hook: 'on_failure', type: 'webhook', destination: 'slack-ops' }],
});

function setup(scope: string, index: number) {
    const dispatch = jest.fn();
    const onMoved = jest.fn();
    const onRequestRemove = jest.fn();
    renderThemed(
        <ActionPanel job={job()} scope={scope} index={index} destinations={[{ name: 'slack-ops' } as never]} alertActions={[]} tokenGroups={[]} dispatch={dispatch} onMoved={onMoved} onRequestRemove={onRequestRemove} />
    );
    return { dispatch, onMoved, onRequestRemove };
}

describe('ActionPanel', () => {
    test('moving to Whole job · Finished either way dispatches moveAction and reports the new key', () => {
        const { dispatch, onMoved } = setup('a', 0);
        fireEvent.click(screen.getByRole('combobox', { name: 'When' }));
        fireEvent.click(screen.getByRole('option', { name: 'Whole job · Finished either way' }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'moveAction', scope: 'a', index: 0, toScope: 'job', hook: 'on_complete' });
        // The job already has one action, so the moved one is appended at index 1.
        expect(onMoved).toHaveBeenCalledWith('action:job:1');
    });

    test('changing only the outcome keeps the key', () => {
        const { dispatch, onMoved } = setup('a', 0);
        fireEvent.click(screen.getByRole('combobox', { name: 'When' }));
        fireEvent.click(screen.getByRole('option', { name: 'Daily summary · Succeeded' }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'moveAction', scope: 'a', index: 0, toScope: 'a', hook: 'on_success' });
        expect(onMoved).toHaveBeenCalledWith('action:a:0');
    });

    test('lists every step and the whole job with all five outcomes', () => {
        setup('a', 0);
        fireEvent.click(screen.getByRole('combobox', { name: 'When' }));
        const names = screen.getAllByRole('option').map((o) => o.textContent);
        expect(names).toHaveLength(15);
        expect(names[0]).toBe('Daily summary · Succeeded');
        expect(names[5]).toBe('Weekly · Succeeded');
        expect(names[14]).toBe('Whole job · Delayed');
    });

    test('editing an email field dispatches updateAction with only that field', () => {
        const { dispatch } = setup('a', 0);
        fireEvent.change(screen.getByLabelText('To'), { target: { value: 'new@x.com' } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'updateAction', scope: 'a', index: 0, changes: { to: 'new@x.com' } });
    });

    test('Remove action asks the page and does not dispatch', () => {
        const { dispatch, onRequestRemove } = setup('job', 0);
        fireEvent.click(screen.getByRole('button', { name: 'Remove action' }));
        expect(onRequestRemove).toHaveBeenCalledWith('action:job:0');
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('JobNodePanel', () => {
    test('explains the lines and selects an outgoing action', () => {
        const onSelect = jest.fn();
        renderThemed(<JobNodePanel job={job()} onSelect={onSelect} />);
        expect(
            screen.getByText('Lines from Whole job fire for the whole run. Without a Failed line, the fallback notification in Settings is used.')
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Failed: Webhook/ }));
        expect(onSelect).toHaveBeenCalledWith('action:job:0');
    });
});
