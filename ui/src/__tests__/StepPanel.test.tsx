import React, { useReducer } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { JobDefinition } from '../api/types';
import AccessTab from '../features/builder/AccessTab';
import BuilderPage from '../features/builder/BuilderPage';
import { BuilderState, initialState, reducer } from '../features/builder/reducer';
import StepPanel from '../features/builder/StepPanel';
import { fakeApi, rollupJob } from './builderFixtures';
import { renderThemed } from './fixtures';

const threeSteps = (edges: JobDefinition['edges']): JobDefinition => ({
    name: 'j',
    enabled: true,
    steps: [
        { id: 'a', type: 'inline', spl: '| makeresults' },
        { id: 'b', type: 'inline', spl: '| makeresults' },
        { id: 'c', type: 'inline', spl: '| makeresults' },
    ],
    edges,
});

function Harness({ job, stepId, onState }: { job: JobDefinition; stepId: string; onState: (s: BuilderState) => void }) {
    const [state, dispatch] = useReducer(reducer, job, initialState);
    onState(state);
    return <StepPanel job={state.job} stepId={stepId} issues={[]} dispatch={dispatch} destinations={[]} />;
}

function renderPanel(job: JobDefinition, stepId: string) {
    let latest: BuilderState | null = null;
    renderThemed(<Harness job={job} stepId={stepId} onState={(s) => (latest = s)} />);
    return () => latest as unknown as BuilderState;
}

describe('StepPanel', () => {
    test('depends-on multiselect creates edge', () => {
        const state = renderPanel(threeSteps([]), 'c');
        const input = screen.getByRole('combobox', { name: 'Depends on' });
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'a' } });
        fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
        expect(state().job.edges).toEqual([{ from: 'a', to: 'c', condition: 'on_success' }]);
    });

    test('depends-on excludes options that would cycle', () => {
        const job = threeSteps([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);
        job.steps.push({ id: 'd', type: 'inline', spl: '| makeresults' });
        renderPanel(job, 'a');
        const input = screen.getByRole('combobox', { name: 'Depends on' });
        fireEvent.focus(input);
        fireEvent.keyDown(input, { key: 'ArrowDown', keyCode: 40 });
        const options = screen.queryAllByRole('option').map((o) => o.textContent);
        expect(options).toContain('d');
        expect(options).not.toContain('b');
        expect(options).not.toContain('c');
    });

    test('Mondays preset sets cron * * * * 1', () => {
        const state = renderPanel(threeSteps([]), 'b');
        fireEvent.click(screen.getByTestId('run-when-select'));
        fireEvent.click(screen.getByRole('option', { name: 'Mondays' }));
        expect(state().job.steps[1].run_when).toEqual({ kind: 'cron', value: '* * * * 1' });
    });

    test('a duration of 0 minutes is refused', () => {
        const state = renderPanel(threeSteps([]), 'a');
        const field = screen.getByLabelText('Give up after (minutes)');
        fireEvent.change(field, { target: { value: '0' } });
        expect(screen.getByText('At least 1 minute.')).toBeInTheDocument();
        expect(state().job.steps[0].give_up_after).toBeUndefined();
        fireEvent.change(field, { target: { value: '30' } });
        expect(state().job.steps[0].give_up_after).toBe(1800);
        fireEvent.change(field, { target: { value: '' } });
        expect(state().job.steps[0].give_up_after).toBeNull();
    });

    test('From previous steps shows the read-only input and hides time fields', () => {
        const job = threeSteps([{ from: 'b', to: 'c' }, { from: 'a', to: 'c' }]);
        job.steps[2] = { id: 'c', type: 'previous', spl: '| stats count' };
        renderPanel(job, 'c');
        expect(screen.getByText('Input (added for you)')).toBeInTheDocument();
        // The label names the read-only input (aria-labelledby from ControlGroup).
        expect(screen.getByLabelText('Input (added for you)')).toHaveTextContent('| loadjob ‹b› | append [| loadjob ‹a›]');
        expect(screen.getByText('Starts with |. Results of the steps before this one come first.')).toBeInTheDocument();
        expect(screen.getByLabelText('Search')).toHaveValue('| stats count');
        expect(screen.queryByLabelText('Earliest')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Latest')).not.toBeInTheDocument();
    });

    test('a Search step has no generated input and keeps its time fields', () => {
        renderPanel(threeSteps([{ from: 'a', to: 'b' }]), 'b');
        expect(screen.queryByText('Input (added for you)')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Earliest')).toBeInTheDocument();
        expect(screen.getByLabelText('Latest')).toBeInTheDocument();
    });

    test('the type list offers From previous steps, third', () => {
        const state = renderPanel(threeSteps([{ from: 'a', to: 'b' }]), 'b');
        fireEvent.click(screen.getByTestId('type-select'));
        const types = screen
            .getAllByRole('option')
            .map((o) => o.textContent)
            .filter((t) => !(t || '').startsWith('Remove')); // the Depends on chips
        expect(types).toEqual(['Search', 'Saved search', 'From previous steps']);
        fireEvent.click(screen.getByRole('option', { name: 'From previous steps' }));
        expect(state().job.steps[1]).toMatchObject({ type: 'previous', spl: '| makeresults' });
        expect(screen.getByText('| loadjob ‹a›')).toBeInTheDocument();
    });

    test('retries above 0 shows the duplicate warning', () => {
        const job = threeSteps([]);
        job.steps[0].retries = 2;
        renderPanel(job, 'a');
        expect(screen.getByText(/duplicates/i)).toBeInTheDocument();
    });
});

describe('BuilderPage', () => {
    test('server issues appear on the named step', async () => {
        const message =
            "Saved search 'Weekly rollup' is not a private search of alice with dispatchAs = owner, so it runs through a hidden | savedsearch wrapper as alice: its own summary indexing and actions won't run";
        const api = fakeApi({
            validateJob: jest.fn().mockResolvedValue({
                valid: true,
                issues: [{ level: 'warning', code: 'saved_search_wrapped', message, step: 'weekly' }],
                owner_will_change: false,
                owner: 'alice',
            }),
        });
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Step Weekly rollup/ });
        fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
        const weekly = await screen.findByRole('button', { name: /^Step Weekly rollup, 1 warning/ });
        fireEvent.keyDown(screen.getByRole('button', { name: /^Step Daily summary/ }), { key: 'Enter' });
        expect(screen.queryByText(/its own summary indexing and actions won't run/)).toBeNull();
        fireEvent.keyDown(weekly, { key: 'Enter' });
        const panel = screen.getByRole('region', { name: 'Step Weekly rollup' });
        expect(within(panel).getByText(/its own summary indexing and actions won't run/)).toBeInTheDocument();
    });

    test('save warns before taking ownership', async () => {
        const api = fakeApi({
            getJob: jest.fn().mockResolvedValue(rollupJob({ owner: 'bob' })),
            validateJob: jest.fn().mockResolvedValue({ valid: true, issues: [], owner_will_change: true, owner: 'alice' }),
        });
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Step Weekly rollup/ });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText(/This job belongs to bob/)).toBeInTheDocument();
        expect(api.updateJob).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Save and take ownership' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalled());
        expect((api.updateJob as jest.Mock).mock.calls[0][0]).toBe('rollups');
    });
});

describe('BuilderPage save checks', () => {
    const issue = (level: 'error' | 'warning') => ({ level, code: 'x', message: `a server ${level}`, step: 'weekly' });

    test('a server error blocks save', async () => {
        const api = fakeApi({
            validateJob: jest.fn().mockResolvedValue({ valid: false, issues: [issue('error')], owner_will_change: false, owner: 'alice' }),
        });
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Step Weekly rollup/ });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('The job has errors and was not saved.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Step Weekly rollup, 1 error/ })).toBeInTheDocument();
        expect(api.updateJob).not.toHaveBeenCalled();
    });

    test('a server warning does not block save', async () => {
        const api = fakeApi({
            validateJob: jest.fn().mockResolvedValue({ valid: true, issues: [issue('warning')], owner_will_change: false, owner: 'alice' }),
        });
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Step Weekly rollup/ });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.updateJob).toHaveBeenCalled());
        expect(await screen.findByText('Saved.')).toBeInTheDocument();
    });
});

describe('AccessTab', () => {
    test('who-may-run shows owner access warning', () => {
        renderThemed(<AccessTab runRoles={['analyst']} owner="alice" roles={['analyst', 'user']} onChange={jest.fn()} />);
        expect(screen.getByText(/Runs use the owner's access/)).toBeInTheDocument();
        expect(screen.getByText(/alice/)).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Who may run' })).toBeInTheDocument();
    });
});

test('a saved search step can read the previous step', () => {
    const job = threeSteps([{ from: 'a', to: 'b' }]);
    job.steps[1] = { id: 'b', type: 'saved_search', saved_search_ref: 'rep' };
    const state = renderPanel(job, 'b');
    const box = screen.getByRole('checkbox', { name: "Reads the previous step's results" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(state().job.steps[1].read_previous).toBe(true);
    expect(screen.getByText(/\| loadjob \$args\.so_input\$/)).toBeInTheDocument();
    expect(screen.getByLabelText('Earliest')).toBeInTheDocument();
});
