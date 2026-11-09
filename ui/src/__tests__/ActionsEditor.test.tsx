import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import type { Action, AlertAction } from '../api/types';
import ActionsEditor, { alertActionOptions } from '../features/builder/ActionsEditor';
import { renderThemed } from './fixtures';

const INSTALLED: AlertAction[] = [
    {
        name: 'logevent',
        label: 'Log Event',
        params: [
            { name: 'source', label: 'Source', help: 'The source field.', type: 'text', default: 'alert:$name$', required: false, options: [] },
            { name: 'event', label: 'Event', help: '', type: 'textarea', default: '', required: true, options: [] },
            {
                name: 'mode',
                label: 'Mode',
                help: '',
                type: 'select',
                default: 'b',
                required: false,
                options: [
                    { value: 'a', label: 'Alpha' },
                    { value: 'b', label: 'Beta' },
                ],
            },
        ],
    },
    { name: 'bare', label: 'bare', params: [] },
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
    it('picks an alert action from the list and clears the old action\'s parameters', () => {
        const onChange = renderEditor({ action: 'bare', params: { a: '1' } }, INSTALLED);
        fireEvent.click(screen.getByText('bare'));
        fireEvent.click(screen.getByText('Log Event (logevent)'));
        expect(onChange).toHaveBeenCalledWith([{ hook: 'on_failure', type: 'alert_action', params: {}, action: 'logevent' }]);
    });

    it('shows the saved action', () => {
        renderEditor({ action: 'logevent' }, INSTALLED);
        expect(screen.getByText('Log Event (logevent)')).toBeInTheDocument();
    });

    it('shows one labelled field per parameter, with the default as a hint only', () => {
        renderEditor({ action: 'logevent', params: { event: 'hello' } }, INSTALLED);
        const source = screen.getByLabelText('Source') as HTMLInputElement;
        expect(source.value).toBe('');
        expect(source.placeholder).toBe('alert:$name$');
        expect(screen.getByText('The source field.')).toBeInTheDocument();
        expect((screen.getByLabelText('Event (required)') as HTMLTextAreaElement).value).toBe('hello');
        expect(screen.getByText('Default (Beta)')).toBeInTheDocument();
    });

    it('sets a parameter and keeps the others', () => {
        const onChange = renderEditor({ action: 'logevent', params: { event: 'hello', other: 'x' } }, INSTALLED);
        fireEvent.change(screen.getByLabelText('Source'), { target: { value: 's1' } });
        expect(onChange.mock.calls[0][0][0].params).toEqual({ event: 'hello', other: 'x', source: 's1' });
    });

    it('leaves a cleared parameter out so the default applies', () => {
        const onChange = renderEditor({ action: 'logevent', params: { event: 'hello' } }, INSTALLED);
        fireEvent.change(screen.getByLabelText('Event (required)'), { target: { value: '' } });
        expect(onChange.mock.calls[0][0][0].params).toEqual({});
    });

    it('picks a parameter value from its options', () => {
        const onChange = renderEditor({ action: 'logevent' }, INSTALLED);
        fireEvent.click(screen.getByText('Default (Beta)'));
        fireEvent.click(screen.getByText('Alpha'));
        expect(onChange.mock.calls[0][0][0].params).toEqual({ mode: 'a' });
    });

    it('keeps a saved value that is not one of the options', () => {
        renderEditor({ action: 'logevent', params: { mode: 'zeta' } }, INSTALLED);
        expect(screen.getByText('zeta')).toBeInTheDocument();
    });

    it('keeps parameters the action does not list in the other box', () => {
        const onChange = renderEditor({ action: 'logevent', params: { event: 'hello', extra: '1' } }, INSTALLED);
        const box = screen.getByLabelText('Other parameters') as HTMLTextAreaElement;
        expect(box.value).toBe('extra=1');
        fireEvent.change(box, { target: { value: 'extra=2\nmore=3' } });
        expect(onChange.mock.calls[0][0][0].params).toEqual({ event: 'hello', extra: '2', more: '3' });
    });

    it('asks for typed parameters when the action lists none', () => {
        renderEditor({ action: 'bare', params: { a: '1' } }, INSTALLED);
        expect((screen.getByLabelText('Parameters') as HTMLTextAreaElement).value).toBe('a=1');
    });

    it('falls back to typing the name when the list is unavailable', () => {
        const onChange = renderEditor({ action: 'log' }, null);
        const input = screen.getByLabelText('Alert action name');
        fireEvent.change(input, { target: { value: 'logevent' } });
        expect(onChange).toHaveBeenCalledWith([{ hook: 'on_failure', type: 'alert_action', action: 'logevent' }]);
    });
});
