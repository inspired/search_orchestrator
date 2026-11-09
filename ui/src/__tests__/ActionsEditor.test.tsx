import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import type { Action, AlertAction } from '../api/types';
import ActionsEditor, { alertActionOptions } from '../features/builder/ActionsEditor';
import { renderThemed } from './fixtures';

const INSTALLED: AlertAction[] = [
    { name: 'logevent', label: 'Log Event' },
    { name: 'bare', label: 'bare' },
];

function renderEditor(action: Partial<Action>, alertActions?: AlertAction[] | null) {
    const onChange = jest.fn();
    const actions = [{ hook: 'on_failure', type: 'alert_action', ...action } as Action];
    renderThemed(<ActionsEditor actions={actions} onChange={onChange} destinations={[]} alertActions={alertActions} idPrefix="t" />);
    return onChange;
}

describe('alertActionOptions', () => {
    it('shows the label and the name, or just a name that has no label', () => {
        expect(alertActionOptions(INSTALLED, '')).toEqual([
            { value: 'logevent', label: 'Log Event (logevent)' },
            { value: 'bare', label: 'bare' },
        ]);
    });

    it('keeps a saved action that is no longer listed', () => {
        expect(alertActionOptions(INSTALLED, 'gone')[2]).toEqual({ value: 'gone', label: 'gone (not available)' });
        expect(alertActionOptions(INSTALLED, 'logevent')).toHaveLength(2);
    });
});

describe('ActionsEditor alert action', () => {
    it('picks an alert action from the list', () => {
        const onChange = renderEditor({ params: { a: '1' } }, INSTALLED);
        fireEvent.click(screen.getByText('Pick an alert action'));
        fireEvent.click(screen.getByText('Log Event (logevent)'));
        expect(onChange).toHaveBeenCalledWith([{ hook: 'on_failure', type: 'alert_action', params: { a: '1' }, action: 'logevent' }]);
    });

    it('shows the saved action', () => {
        renderEditor({ action: 'logevent' }, INSTALLED);
        expect(screen.getByText('Log Event (logevent)')).toBeInTheDocument();
    });

    it('falls back to typing the name when the list is unavailable', () => {
        const onChange = renderEditor({ action: 'log' }, null);
        const input = screen.getByLabelText('Alert action name');
        fireEvent.change(input, { target: { value: 'logevent' } });
        expect(onChange).toHaveBeenCalledWith([{ hook: 'on_failure', type: 'alert_action', action: 'logevent' }]);
    });
});
