import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import JobTabs from '../features/builder/JobTabs';
import DeadlineFields from '../features/builder/DeadlineFields';
import { initialState, reducer } from '../features/builder/reducer';
import type { BuilderAction } from '../features/builder/reducer';
import type { JobDefinition } from '../api/types';
import { renderThemed } from './fixtures';

const base = { name: 'j', enabled: true, steps: [] } as JobDefinition;

/** Renders the fields against the real reducer so the job the user would save is observable. */
function Harness({ start, onJob }: { start: JobDefinition; onJob: (j: JobDefinition) => void }) {
    const [state, setState] = React.useState(() => initialState(start));
    const dispatch = (a: BuilderAction) => setState((s) => reducer(s, a));
    onJob(state.job);
    return (
        <>
            <DeadlineFields job={state.job} dispatch={dispatch} />
            <button type="button" onClick={() => dispatch({ type: 'undo' })}>
                Undo
            </button>
            <button type="button" onClick={() => dispatch({ type: 'redo' })}>
                Redo
            </button>
        </>
    );
}

test('deadline fields left empty keep the job unchanged', () => {
    let job = base;
    renderThemed(<Harness start={base} onJob={(j) => (job = j)} />);
    const field = screen.getByLabelText('Finish by');
    fireEvent.change(field, { target: { value: '06:00' } });
    expect(job.deadline).toEqual({ finish_by: '06:00' });
    fireEvent.change(field, { target: { value: '' } });
    expect(job).toEqual(initialState(base).job);
    expect('deadline' in job).toBe(false);
});

test('a time without two digits asks for HH:MM and is written as typed, so the save is refused', () => {
    let job = base;
    renderThemed(<Harness start={base} onJob={(j) => (job = j)} />);
    fireEvent.change(screen.getByLabelText('Finish by'), { target: { value: '6:00' } });
    expect(screen.getByText('Use HH:MM, for example 06:00')).toBeInTheDocument();
    expect(job.deadline).toEqual({ finish_by: '6:00' });
});

test('invalid text never leaves the last valid time in the job', () => {
    let job = base;
    renderThemed(<Harness start={{ ...base, deadline: { finish_by: '06:00', within: 600 } }} onJob={(j) => (job = j)} />);
    fireEvent.change(screen.getByLabelText('Finish by'), { target: { value: '07:0' } });
    expect(job.deadline).toEqual({ finish_by: '07:0', within: 600 });
});

test('undo and redo show the deadline the job has', () => {
    let job = base;
    renderThemed(<Harness start={base} onJob={(j) => (job = j)} />);
    const field = screen.getByLabelText('Finish by') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '06:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect('deadline' in job).toBe(false);
    expect((screen.getByLabelText('Finish by') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(job.deadline).toEqual({ finish_by: '06:00' });
    expect((screen.getByLabelText('Finish by') as HTMLInputElement).value).toBe('06:00');
});

test('a valid time is written as finish_by', () => {
    let job = base;
    renderThemed(<Harness start={base} onJob={(j) => (job = j)} />);
    expect(screen.getByPlaceholderText('06:00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Finish by'), { target: { value: '06:00' } });
    expect(job.deadline).toEqual({ finish_by: '06:00' });
});

test('the help text explains who has a deadline', () => {
    renderThemed(<DeadlineFields job={base} dispatch={jest.fn()} />);
    expect(screen.getByText("In the job's time zone")).toBeInTheDocument();
    expect(screen.getByText('Only scheduled runs and runs started by another job have a deadline.')).toBeInTheDocument();
});

test('the Settings tab renders the deadline fields', () => {
    renderThemed(<JobTabs activeTab="settings" onTabChange={jest.fn()} job={base} dispatch={jest.fn()} owner="a" roles={[]} steps={null} />);
    expect(screen.getByLabelText('Finish by')).toBeInTheDocument();
});
