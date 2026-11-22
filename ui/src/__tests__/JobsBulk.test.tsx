import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import JobsTable from '../features/jobs/JobsTable';
import type { JobsBulkApi } from '../features/jobs/JobsBulk';
import { job as makeJob, me, renderThemed } from './fixtures';

const alpha = makeJob({ id: 'a', name: 'Alpha', owner: 'alice', enabled: true, tags: [] });
const beta = makeJob({ id: 'b', name: 'Beta', owner: 'bob', enabled: false });
const jobs = [alpha, beta];

function bulkApi(over: Partial<JobsBulkApi> = {}): JobsBulkApi {
    return {
        startRun: jest.fn(() => Promise.resolve()),
        setJobEnabled: jest.fn(() => Promise.resolve()),
        updateJob: jest.fn(() => Promise.resolve()),
        deleteJob: jest.fn(() => Promise.resolve()),
        onDone: jest.fn(),
        ...over,
    };
}

const row = (name: string) => screen.getAllByRole('row').find((r) => within(r).queryByText(name)) as HTMLElement;
const tick = (name: string) => fireEvent.click(within(row(name)).getByRole('checkbox'));

function show(bulk: JobsBulkApi, onExport = jest.fn()) {
    renderThemed(<JobsTable jobs={jobs} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} onExport={onExport} bulk={bulk} />);
    return onExport;
}

describe('Jobs bulk actions', () => {
    afterEach(() => window.localStorage.clear());

    test('no checkboxes without bulk; ticking rows shows the bar', () => {
        const { unmount } = renderThemed(<JobsTable jobs={jobs} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
        unmount();
        show(bulkApi());
        expect(screen.queryByTestId('jobs-bulk')).toBeNull();
        tick('Alpha');
        tick('Beta');
        const bar = screen.getByTestId('jobs-bulk');
        expect(bar).toHaveTextContent('2 jobs selected');
        ['Run now', 'Enable', 'Disable', 'Export', 'Add tag', 'Delete'].forEach((label) => expect(within(bar).getByRole('button', { name: label })).toBeInTheDocument());
    });

    test('Disable sends the enabled jobs and says what it skipped', async () => {
        const api = bulkApi();
        show(api);
        tick('Alpha');
        tick('Beta');
        fireEvent.click(within(screen.getByTestId('jobs-bulk')).getByRole('button', { name: 'Disable' }));
        await waitFor(() => expect(api.setJobEnabled).toHaveBeenCalledTimes(1));
        expect(api.setJobEnabled).toHaveBeenCalledWith('a', false);
        expect(await screen.findByText('Disabled 1 job.')).toBeInTheDocument();
        expect(screen.getByText('Skipped Beta: already disabled.')).toBeInTheDocument();
        expect(api.onDone).toHaveBeenCalled();
    });

    test('a failure is reported and the others still run', async () => {
        const api = bulkApi({ startRun: jest.fn((id: string) => (id === 'a' ? Promise.reject(new Error('bad_param')) : Promise.resolve())) });
        show(api);
        tick('Alpha');
        tick('Beta');
        fireEvent.click(within(screen.getByTestId('jobs-bulk')).getByRole('button', { name: 'Run now' }));
        await waitFor(() => expect(api.startRun).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('Started 1 job.')).toBeInTheDocument();
        expect(screen.getByText('Alpha failed: bad_param.')).toBeInTheDocument();
    });

    test('Delete asks first and names the jobs', async () => {
        const api = bulkApi();
        show(api);
        tick('Alpha');
        fireEvent.click(within(screen.getByTestId('jobs-bulk')).getByRole('button', { name: 'Delete' }));
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveTextContent('Delete 1 job?');
        expect(dialog).toHaveTextContent('Alpha');
        expect(api.deleteJob).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 1 job' }));
        await waitFor(() => expect(api.deleteJob).toHaveBeenCalledWith('a'));
    });

    test('Add tag adds it to your own jobs', async () => {
        const api = bulkApi();
        show(api);
        tick('Alpha');
        tick('Beta');
        const bar = screen.getByTestId('jobs-bulk');
        fireEvent.click(within(bar).getByRole('button', { name: 'Add tag' }));
        fireEvent.change(within(bar).getByRole('textbox', { name: 'Tag' }), { target: { value: 'nightly' } });
        fireEvent.click(within(bar).getByRole('button', { name: 'Add' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalledTimes(1));
        expect(api.updateJob).toHaveBeenCalledWith('a', expect.objectContaining({ tags: ['nightly'] }));
        expect(await screen.findByText('Skipped Beta: owned by bob; adding a tag would make you its owner.')).toBeInTheDocument();
    });

    test('Export downloads the selected jobs', () => {
        const onExport = show(bulkApi());
        tick('Beta');
        fireEvent.click(within(screen.getByTestId('jobs-bulk')).getByRole('button', { name: 'Export' }));
        expect(onExport).toHaveBeenCalledWith([beta]);
    });

    test('the head checkbox selects every job shown', () => {
        show(bulkApi());
        const head = screen.getAllByRole('row')[0];
        fireEvent.click(within(head).getByRole('checkbox'));
        expect(screen.getByTestId('jobs-bulk')).toHaveTextContent('2 jobs selected');
    });
});
