import React from 'react';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import HistoryTab from '../features/builder/HistoryTab';
import * as versions from '../api/versions';
import type { SaveResponse } from '../api/types';
import { renderThemed } from './fixtures';

jest.mock('../api/versions');
const api = versions as jest.Mocked<typeof versions>;

const LIST = [
    { version: 2, saved_at: 1700000100, saved_by: 'alice', owner: 'alice', summary: ['Changed the search of Daily summary'], restored_from: 1 },
    { version: 1, saved_at: 1700000000, saved_by: 'bob', owner: 'bob', summary: ['Created the job'] },
];
const saved = { job: { id: 'daily' } } as unknown as SaveResponse;

const open = (over: Partial<React.ComponentProps<typeof HistoryTab>> = {}) => {
    const onRestored = jest.fn();
    renderThemed(<HistoryTab jobId="daily" dirty={false} canEdit onRestored={onRestored} {...over} />);
    return onRestored;
};
const row = (n: number) => screen.getByText(`Version ${n}`).closest('li') as HTMLElement;

beforeEach(() => {
    jest.resetAllMocks();
    api.listVersions.mockResolvedValue(LIST);
});

describe('HistoryTab', () => {
    test('an unsaved job has no history and calls nothing', () => {
        open({ jobId: null });
        expect(screen.getByText('Save the job to start its history.')).toBeInTheDocument();
        expect(api.listVersions).not.toHaveBeenCalled();
    });

    test('rows show version, author, summary and restore origin', async () => {
        open();
        expect(await screen.findByText('Version 2')).toBeInTheDocument();
        expect(within(row(2)).getByText(/Saved by alice/)).toBeInTheDocument();
        expect(within(row(2)).getByText('Changed the search of Daily summary')).toBeInTheDocument();
        expect(within(row(2)).getByText('Restored from version 1')).toBeInTheDocument();
        expect(within(row(1)).getByText(/Saved by bob/)).toBeInTheDocument();
        expect(within(row(1)).queryByText(/Restored from/)).toBeNull();
    });

    test('compare with current shows the diff with removed and added lines', async () => {
        api.compareVersions.mockResolvedValue([
            { path: 'steps.daily.spl', kind: 'changed', label: 'Changed the search of Daily summary', before: 'index=a\nold', after: 'index=a\nnew' },
        ]);
        open();
        await screen.findByText('Version 1');
        fireEvent.click(within(row(1)).getByRole('button', { name: 'Compare with current' }));
        expect(await screen.findByText('Changed the search of Daily summary', { selector: 'li' })).toBeInTheDocument();
        expect(api.compareVersions).toHaveBeenCalledWith('daily', 1, 'current');
        expect(screen.getByText('Steps')).toBeInTheDocument();
        expect(screen.getByText('− old')).toBeInTheDocument();
        expect(screen.getByText('+ new')).toBeInTheDocument();
    });

    test('compare selected needs exactly two versions', async () => {
        api.compareVersions.mockResolvedValue([]);
        open();
        await screen.findByText('Version 1');
        const compare = screen.getByRole('button', { name: 'Compare selected' });
        expect(compare).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(within(row(2)).getByRole('checkbox'));
        expect(compare).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(within(row(1)).getByRole('checkbox'));
        expect(compare).not.toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(compare);
        await waitFor(() => expect(api.compareVersions).toHaveBeenCalledWith('daily', 1, 2));
    });

    test('restore asks first, warns about unsaved changes, then restores', async () => {
        api.restoreVersion.mockResolvedValue(saved);
        const onRestored = open({ dirty: true });
        await screen.findByText('Version 1');
        fireEvent.click(within(row(1)).getByRole('button', { name: 'Restore' }));
        expect(screen.getByText('Restore version 1?')).toBeInTheDocument();
        expect(screen.getByText('Your unsaved changes will be lost.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Restore version' }));
        await waitFor(() => expect(onRestored).toHaveBeenCalledWith(saved));
        expect(api.restoreVersion).toHaveBeenCalledWith('daily', 1);
    });

    test('no unsaved-changes warning when the job is clean', async () => {
        open();
        await screen.findByText('Version 1');
        fireEvent.click(within(row(1)).getByRole('button', { name: 'Restore' }));
        expect(screen.queryByText('Your unsaved changes will be lost.')).toBeNull();
    });

    test('a viewer sees no Restore buttons', async () => {
        open({ canEdit: false });
        await screen.findByText('Version 1');
        expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    });

    test('Restore is reachable with Tab and opens with Enter', async () => {
        const user = userEvent.setup();
        open();
        await screen.findByText('Version 1');
        const restore = within(row(1)).getByRole('button', { name: 'Restore' });
        for (let i = 0; i < 20 && document.activeElement !== restore; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await user.tab();
        }
        expect(restore).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(await screen.findByText('Restore version 1?')).toBeInTheDocument();
    });

    test('a failed load says what to do', async () => {
        api.listVersions.mockRejectedValue(new Error('Splunk could not be reached.'));
        open();
        expect(await screen.findByText(/The history could not be loaded/)).toBeInTheDocument();
    });
});
