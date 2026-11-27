import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import FollowDialog from '../features/jobs/FollowDialog';
import JobsTable from '../features/jobs/JobsTable';
import { job, me, renderThemed } from './fixtures';

const api = (over = {}) => ({
    getFollow: jest.fn().mockResolvedValue({ follow: null, email: 'bob@example.com' }),
    putFollow: jest.fn().mockResolvedValue({ follow: {} }),
    deleteFollow: jest.fn().mockResolvedValue({ follow: null }),
    ...over,
});

describe('Follow a job', () => {
    test('follow by email with the default events', async () => {
        const a = api();
        const onChanged = jest.fn();
        renderThemed(<FollowDialog job={job()} onClose={jest.fn()} onChanged={onChanged} returnFocus={{ current: null }} api={a as never} />);
        expect(await screen.findByText(/By email to bob@example.com/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
        await waitFor(() => expect(a.putFollow).toHaveBeenCalledWith('daily', ['failure', 'late'], { type: 'email' }));
        expect(onChanged).toHaveBeenCalled();
    });

    test('an existing follow can change events or be removed', async () => {
        const a = api({ getFollow: jest.fn().mockResolvedValue({ follow: { on: ['failure'], notify: { type: 'webhook', destination: 'ops-slack' }, email: null }, email: 'bob@example.com' }) });
        renderThemed(<FollowDialog job={job()} onClose={jest.fn()} onChanged={jest.fn()} returnFocus={{ current: null }} api={a as never} />);
        expect(await screen.findByRole('heading', { name: /Following/ })).toBeInTheDocument();
        fireEvent.click(screen.getByText('It succeeds'));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(a.putFollow).toHaveBeenCalledWith('daily', ['failure', 'success'], { type: 'email' }))  // a webhook follow from before is told by email
        await waitFor(() => undefined);
        fireEvent.click(screen.getByRole('button', { name: 'Unfollow' }));
        await waitFor(() => expect(a.deleteFollow).toHaveBeenCalledWith('daily'));
    });

    test('without an email address, email cannot be chosen', async () => {
        renderThemed(<FollowDialog job={job()} onClose={jest.fn()} onChanged={jest.fn()} returnFocus={{ current: null }} api={api({ getFollow: jest.fn().mockResolvedValue({ follow: null, email: null }) }) as never} />);
        expect(await screen.findByText(/has no email address/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-disabled', 'true');
    });

    test('the Jobs table marks followed jobs and offers Follow in the menu', () => {
        renderThemed(<JobsTable jobs={[job({ following: true })]} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} onFollow={jest.fn()} />);
        expect(screen.getByTestId('following')).toHaveTextContent('You follow this job');
        expect(screen.getByRole('button', { name: 'More actions for Daily summary' })).toBeInTheDocument();
    });
});
