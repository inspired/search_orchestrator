import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import JobActionsTab from '../features/builder/JobActionsTab';
import { renderThemed } from './fixtures';

const job = () => ({ name: 'x', enabled: true, steps: [], actions: [{ hook: 'on_failure' as const, type: 'email' as const, to: 'a@b.c' }] });

describe('Job actions tab', () => {
    test('lists the whole-job actions with When, their fields and retries; add and remove', () => {
        const dispatch = jest.fn();
        renderThemed(<JobActionsTab job={job()} dispatch={dispatch} />);
        expect(screen.getAllByTestId('job-action')).toHaveLength(1);
        expect(screen.getByLabelText('To')).toHaveValue('a@b.c');
        expect(screen.getByText(/^3 retries, waiting 30 s/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('To'), { target: { value: 'ops@x.com' } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'updateAction', scope: 'job', index: 0, changes: { to: 'ops@x.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Remove job action 1' }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'removeAction', scope: 'job', index: 0 });
        fireEvent.click(screen.getByRole('button', { name: 'Add job action' }));
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'setJobField', field: 'actions', value: [job().actions[0], { hook: 'on_failure', type: 'email', to: '' }] });
    });

    test('a viewer sees the actions but cannot change them', () => {
        renderThemed(<JobActionsTab job={job()} dispatch={jest.fn()} canEdit={false} />);
        expect(screen.queryByRole('button', { name: 'Add job action' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Remove job action/ })).toBeNull();
    });
});
