import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import OutputViewer from '../features/output/OutputViewer';
import { viewOutput } from '../api/outputView';
import { cancelPreview, previewResults, previewStatus } from '../api/client';
import { renderThemed } from './fixtures';
import type { JobDefinition } from '../api/types';

jest.mock('../api/outputView', () => ({ viewOutput: jest.fn() }));
jest.mock('../api/client', () => ({
    previewStatus: jest.fn(),
    previewResults: jest.fn(),
    cancelPreview: jest.fn(() => Promise.resolve({ cancelled: true })),
}));

const job = { id: 'daily', name: 'Daily', steps: [], edges: [] } as unknown as JobDefinition;
const start = (kind: string, spl: string) => ({ status: 'started', sid: 'so_preview_x', spl, earliest: '-24h', latest: 'now', kind });

beforeEach(() => {
    jest.clearAllMocks();
    (previewStatus as jest.Mock).mockResolvedValue({ state: 'done', result_count: 2, messages: [] });
    (previewResults as jest.Mock).mockResolvedValue({ fields: ['host', 'count'], rows: [{ host: 'a', count: '1' }, { host: 'b', count: '2' }], total: 2 });
});

test('opens a dialog with the rows, the search and Open in Search', async () => {
    (viewOutput as jest.Mock).mockResolvedValue(start('lookup', '| inputlookup my.csv'));
    renderThemed(<OutputViewer target={{ step_id: 'lk' }} name="Save" job={job} />);
    fireEvent.click(screen.getByRole('button', { name: 'View output' }));
    expect(await screen.findByText('2 rows.')).toBeInTheDocument();
    expect(screen.getByTestId('output-table').textContent).toContain('b');
    expect(screen.getByText('| inputlookup my.csv')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in Search/ }).getAttribute('href')).toContain('sid=so_preview_x');
    expect(viewOutput).toHaveBeenCalledWith({ step_id: 'lk' }, { job, range: '24h' });
    // A lookup has no time, so no range picker.
    expect(screen.queryByRole('radio', { name: '7 days' })).toBeNull();
});

test('a summary index can search 7 days, and a run uses its run id', async () => {
    (viewOutput as jest.Mock).mockResolvedValue(start('summary_index', 'index=summary'));
    renderThemed(<OutputViewer target={{ step_id: 'si' }} name="Save" job={job} />);
    fireEvent.click(screen.getByRole('button', { name: 'View output' }));
    fireEvent.click(await screen.findByRole('radio', { name: '7 days' }));
    await waitFor(() => expect(viewOutput).toHaveBeenLastCalledWith({ step_id: 'si' }, { job, range: '7d' }));
});

test('for a run it passes the run id and says it searched during the run', async () => {
    (viewOutput as jest.Mock).mockResolvedValue(start('event', 'index=main'));
    renderThemed(<OutputViewer target={{ action: { scope: 'si', index: 0 } }} name="Event" runId="daily:1" />);
    fireEvent.click(screen.getByRole('button', { name: 'View output' }));
    expect(await screen.findByText('During this run.')).toBeInTheDocument();
    expect(viewOutput).toHaveBeenCalledWith({ action: { scope: 'si', index: 0 } }, { runId: 'daily:1' });
});

test('shows the error when the search fails, and Close cancels a running one', async () => {
    (viewOutput as jest.Mock).mockResolvedValue(start('lookup', '| inputlookup gone.csv'));
    (previewStatus as jest.Mock).mockResolvedValueOnce({ state: 'failed', result_count: 0, error: 'The lookup table does not exist', messages: [] });
    renderThemed(<OutputViewer target={{ step_id: 'lk' }} name="Save" job={job} />);
    fireEvent.click(screen.getByRole('button', { name: 'View output' }));
    expect(await screen.findByText('The lookup table does not exist')).toBeInTheDocument();
    (previewStatus as jest.Mock).mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(viewOutput).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Searching…')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(cancelPreview).toHaveBeenCalledWith('so_preview_x');
});
