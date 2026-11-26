import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import ActionPanel from '../features/builder/ActionPanel';
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
    actions: [{ hook: 'on_failure', type: 'alert_action', action: 'slack' }],
});

function setup(scope: string, index: number) {
    const dispatch = jest.fn();
    const onMoved = jest.fn();
    const onRequestRemove = jest.fn();
    renderThemed(
        <ActionPanel job={job()} scope={scope} index={index} alertActions={[]} tokenGroups={[]} dispatch={dispatch} onMoved={onMoved} onRequestRemove={onRequestRemove} />
    );
    return { dispatch, onMoved, onRequestRemove };
}

describe('ActionPanel', () => {
    test('shows the issues given for the action', () => {
        renderThemed(
            <ActionPanel
                job={job()}
                scope="job"
                index={0}
                alertActions={[]}
                tokenGroups={[]}
                issues={[{ level: 'error', code: 'bad_action', message: "alert action 'slack' isn't installed; pick one from the Alert action list", step: null }]}
                dispatch={jest.fn()}
                onMoved={jest.fn()}
                onRequestRemove={jest.fn()}
            />
        );
        expect(screen.getByText("webhook destination 'slack-ops' doesn't exist; pick another")).toBeInTheDocument();
    });

    test('changing only the outcome keeps the key', () => {
        const { dispatch, onMoved } = setup('a', 0);
        fireEvent.click(screen.getByRole('combobox', { name: 'When' }));
        fireEvent.click(screen.getByRole('option', { name: 'Daily summary · Succeeded' }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'moveAction', scope: 'a', index: 0, toScope: 'a', hook: 'on_success' });
        expect(onMoved).toHaveBeenCalledWith('action:a:0');
    });

    test('lists every step with its outcomes, and no Whole job (that is the Job actions tab)', () => {
        setup('a', 0);
        fireEvent.click(screen.getByRole('combobox', { name: 'When' }));
        const names = screen.getAllByRole('option').map((o) => o.textContent);
        expect(names).toHaveLength(10);
        expect(names[0]).toBe('Daily summary · Succeeded');
        expect(names[5]).toBe('Weekly · Succeeded');
        expect(names.some((n) => (n || '').startsWith('Whole job'))).toBe(false);
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

describe('action retries', () => {
    test('retryText spells out the waits', () => {
        const { retryText } = jest.requireActual('../features/builder/ActionPanel');
        expect(retryText(3, 30)).toMatch(/^3 retries, waiting 30 s, 1 min and 2 min\./);
        expect(retryText(1, 600)).toMatch(/^1 retry, waiting 10 min\./);
        expect(retryText(0, 30)).toBe('No retries: a failed send fails the action at once.');
        expect(retryText(8, 600)).toMatch(/10 min, 20 min, 40 min, … and 1 h \(at most 1 h each\)/);
    });
});
