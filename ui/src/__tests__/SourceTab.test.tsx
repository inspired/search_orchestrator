import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import BuilderPage from '../features/builder/BuilderPage';
import ImportJobDialog from '../features/jobs/ImportJobDialog';
import JobsPage, { JobsApi } from '../features/jobs/JobsPage';
import { jobToSource, takeImportedJob } from '../features/builder/sourceLogic';
import { toDefinition } from '../api/client';
import { fakeApi, rollupJob } from './builderFixtures';
import { job as baseJob, me, renderThemed } from './fixtures';

const server = { owner: 'alice', created_at: 1, created_by: 'alice', updated_at: 2, updated_by: 'alice', hidden_searches: [], _key: 'k', _user: 'nobody' };

async function open(over = {}, canEdit = true) {
    const job = rollupJob({ ...server, permissions: { can_edit: canEdit, can_run: true }, ...over } as never);
    renderThemed(<BuilderPage jobId="rollups" api={fakeApi({ getJob: jest.fn().mockResolvedValue(job) })} />);
    await screen.findByRole('tab', { name: /Source/ });
    fireEvent.click(screen.getByRole('tab', { name: /Source/ }));
    return screen.getByRole('textbox', { name: /Job source/ }) as HTMLTextAreaElement;
}
const edit = (box: HTMLTextAreaElement, value: string) => fireEvent.change(box, { target: { value } });
const edited = (box: HTMLTextAreaElement, change: (j: Record<string, unknown>) => void) => {
    const j = JSON.parse(box.value);
    change(j);
    return JSON.stringify(j, null, 2);
};

describe('Source tab', () => {
    it('shows the job as pretty JSON without server fields', async () => {
        const box = await open();
        expect(box.value).toBe(jobToSource(toDefinition(rollupJob())));
        expect(box.value).toContain('\n  "name": "Summary rollups"');
        ['owner', 'created_at', 'created_by', 'updated_at', 'updated_by', 'hidden_searches', '_key', '_user'].forEach((k) => expect(box.value).not.toContain(`"${k}"`));
    });

    it('copies the JSON', async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        const box = await open();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        });
        expect(writeText).toHaveBeenCalledWith(box.value);
    });

    it('falls back to selecting the text when copying is blocked', async () => {
        Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('no')) } });
        await open();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        });
        expect(screen.getByText('Press Ctrl+C to copy')).toBeInTheDocument();
    });

    it('applies valid edits as one undo step', async () => {
        const box = await open();
        const before = box.value;
        expect(screen.getByRole('button', { name: 'Apply changes' })).toHaveAttribute('aria-disabled', 'true');
        edit(box, edited(box, (j) => (j.name = 'Renamed rollups')));
        fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
        expect(screen.getByText('Renamed rollups', { selector: 'h1, h1 *' })).toBeInTheDocument();
        expect((screen.getByRole('textbox', { name: /Job source/ }) as HTMLTextAreaElement).value).toContain('Renamed rollups');
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect((screen.getByRole('textbox', { name: /Job source/ }) as HTMLTextAreaElement).value).toBe(before);
        expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('shows the line and column of a syntax error and changes nothing', async () => {
        const box = await open();
        edit(box, '{\n  "name": "x",\n  "steps": [,]\n}');
        fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
        expect(screen.getByText(/^The source isn't valid JSON: .* \(line 3, column \d+\)$/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('ignores a different id and says so', async () => {
        const box = await open();
        edit(box, edited(box, (j) => ((j.id = 'other'), (j.name = 'Same job'))));
        fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
        expect(screen.getByText('The id in the source was ignored; this job keeps the id rollups.')).toBeInTheDocument();
        expect((screen.getByRole('textbox', { name: /Job source/ }) as HTMLTextAreaElement).value).toContain('"id": "rollups"');
    });

    it('refuses a job without a steps array', async () => {
        const box = await open();
        edit(box, JSON.stringify({ name: 'No steps' }));
        fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
        expect(screen.getByText('The source must be a job object with name and steps')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('discards unapplied edits', async () => {
        const box = await open();
        const before = box.value;
        edit(box, '{}');
        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
        expect((screen.getByRole('textbox', { name: /Job source/ }) as HTMLTextAreaElement).value).toBe(before);
    });

    it('is read only with just Copy and Download for a viewer', async () => {
        const box = await open({}, false);
        expect(box).toHaveAttribute('readonly');
        expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Apply changes' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
    });
});

describe('Import job', () => {
    beforeEach(() => window.sessionStorage.clear());
    const pasted = JSON.stringify({ id: 'old', owner: 'x', name: 'Imported job', steps: [{ id: 's1', name: 'One', type: 'inline', spl: '| makeresults' }] });

    it('opens from the Jobs page', async () => {
        const api = { me: jest.fn().mockResolvedValue(me), listJobs: jest.fn().mockResolvedValue([baseJob()]), setJobEnabled: jest.fn(), deleteJob: jest.fn() } as unknown as JobsApi;
        renderThemed(<JobsPage api={api} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Import job' }));
        expect(screen.getByText('Import a job')).toBeInTheDocument();
        expect(screen.getByLabelText("Paste the job's JSON")).toBeInTheDocument();
        expect(screen.getByLabelText('Or choose a .json file')).toBeInTheDocument();
    });

    it('opens the builder with the pasted job as new and unsaved', async () => {
        const navigate = jest.fn();
        renderThemed(<ImportJobDialog onClose={jest.fn()} navigate={navigate} returnFocus={{ current: null }} />);
        fireEvent.change(screen.getByLabelText("Paste the job's JSON"), { target: { value: pasted } });
        fireEvent.click(screen.getByRole('button', { name: 'Open in builder' }));
        expect(navigate).toHaveBeenCalledWith(expect.stringContaining('import=1'));
        const imported = takeImportedJob();
        expect(imported).not.toBeNull();
        expect((imported as unknown as Record<string, unknown>).id).toBeUndefined();
        expect((imported as unknown as Record<string, unknown>).owner).toBeUndefined();
        expect(takeImportedJob()).toBeNull();
        renderThemed(<BuilderPage imported={imported} api={fakeApi()} />);
        expect(await screen.findByDisplayValue('Imported job')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('shows the error and stays open for invalid JSON', () => {
        const navigate = jest.fn();
        renderThemed(<ImportJobDialog onClose={jest.fn()} navigate={navigate} returnFocus={{ current: null }} />);
        fireEvent.change(screen.getByLabelText("Paste the job's JSON"), { target: { value: '{"name": ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Open in builder' }));
        expect(screen.getByText(/The source isn't valid JSON: .*\(line 1, column \d+\)/)).toBeInTheDocument();
        expect(screen.getByText('Import a job')).toBeInTheDocument();
        expect(navigate).not.toHaveBeenCalled();
    });
});
