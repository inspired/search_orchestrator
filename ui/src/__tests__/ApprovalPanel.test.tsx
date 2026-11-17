import React, { useReducer } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import type { JobDefinition, StepDef } from '../api/types';
import ApprovalPanel from '../features/builder/ApprovalPanel';
import NodePanel from '../features/builder/NodePanel';
import { buildGraph } from '../features/builder/nodeModel';
import { BuilderState, initialState, reducer } from '../features/builder/reducer';
import { renderThemed } from './fixtures';

const gated = (gate: Partial<StepDef> = {}): JobDefinition => ({
    name: 'j',
    enabled: true,
    steps: [
        { id: 'a', type: 'inline', spl: '| makeresults' },
        { id: 'gate', name: 'Sign-off', type: 'approval', approval: {}, ...gate },
    ],
    edges: [{ from: 'a', to: 'gate', condition: 'on_success' }],
});

function Harness({ job, onState, giveUpAfter }: { job: JobDefinition; onState: (s: BuilderState) => void; giveUpAfter?: number }) {
    const [state, dispatch] = useReducer(reducer, job, initialState);
    onState(state);
    const step = state.job.steps.find((s) => s.id === 'gate') as StepDef;
    return <ApprovalPanel step={step} roles={['ops', 'user']} dispatch={dispatch} tokenGroups={[]} giveUpAfter={giveUpAfter} />;
}

function renderPanel(job: JobDefinition, giveUpAfter?: number) {
    let latest: BuilderState | null = null;
    renderThemed(<Harness job={job} giveUpAfter={giveUpAfter} onState={(s) => (latest = s)} />);
    return () => (latest as unknown as BuilderState).job.steps[1];
}

describe('ApprovalPanel', () => {
    test('the message is a text field with Insert value', () => {
        const step = renderPanel(gated());
        expect(screen.getByRole('button', { name: 'Insert value into Message' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Rows: $a.resultCount$' } });
        expect(step().approval).toEqual({ message: 'Rows: $a.resultCount$' });
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: '' } });
        expect(step().approval).toEqual({});
    });

    test('Who may approve is a role multi-select; empty means anyone who may approve runs of this job', () => {
        const step = renderPanel(gated());
        expect(screen.getByText('Anyone who may approve runs of this job')).toBeInTheDocument();
        const input = screen.getByRole('combobox', { name: 'Who may approve' });
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'ops' } });
        fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
        expect(step().approval).toEqual({ approver_roles: ['ops'] });
        expect(screen.queryByText('Anyone who may approve runs of this job')).toBeNull();
    });

    test('Wait at most writes seconds; empty removes timeout', () => {
        const step = renderPanel(gated());
        const field = screen.getByRole('spinbutton', { name: 'Wait at most' });
        fireEvent.change(field, { target: { value: '30' } });
        expect(step().approval).toEqual({ timeout: 1800 });
        fireEvent.change(field, { target: { value: '' } });
        expect(step().approval).toEqual({});
        expect('timeout' in (step().approval || {})).toBe(false);
    });

    test('If nobody decides: Approve writes on_timeout, Reject removes it', () => {
        const step = renderPanel(gated({ approval: { timeout: 3600 } }));
        const select = () => screen.getByRole('combobox', { name: 'If nobody decides' });
        expect(select()).toHaveTextContent('Reject');
        fireEvent.click(select());
        fireEvent.click(screen.getByRole('option', { name: 'Approve' }));
        expect(step().approval).toEqual({ timeout: 3600, on_timeout: 'approve' });
        fireEvent.click(select());
        fireEvent.click(screen.getByRole('option', { name: 'Reject' }));
        expect(step().approval).toEqual({ timeout: 3600 });
    });

    test('warns when Wait at most is longer than the step gives up after', () => {
        renderPanel(gated({ give_up_after: 3600, approval: { timeout: 7200 } }), 3600);
        expect(screen.getByText("Wait at most is longer than this step's Give up after, so the run gives up first.")).toBeInTheDocument();
    });

    test('no warning when it fits', () => {
        renderPanel(gated({ approval: { timeout: 1800 } }), 3600);
        expect(screen.queryByText(/so the run gives up first/)).toBeNull();
    });

    test('the step panel of an approval node shows the approval fields and never a search, time range, max runtime or retries', () => {
        const job = gated();
        let latest: BuilderState | null = null;
        function Panel() {
            const [state, dispatch] = useReducer(reducer, job, initialState);
            latest = state;
            return (
                <NodePanel
                    job={state.job}
                    graph={buildGraph(state.job)}
                    selection={{ kind: 'node', key: 'step:gate' }}
                    byStep={{}}
                    dispatch={dispatch}
                    onSelect={jest.fn()}
                    onRequestRemove={jest.fn()}
                    onOpenSettings={jest.fn()}
                    destinations={[]}
                    alertActions={[]}
                    jobs={[]}
                    previewFields={{}}
                    scheduledTime={1762390800}
                    resolveTimeRange={jest.fn()}
                    previews={{}}
                    roles={['ops']}
                />
            );
        }
        renderThemed(<Panel />);
        expect(screen.getByLabelText('Message')).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Who may approve' })).toBeInTheDocument();
        expect(screen.getByRole('spinbutton', { name: 'Give up after' })).toBeInTheDocument();
        ['Search', 'Max runtime', 'Retries', 'Saved search'].forEach((name) => expect(screen.queryByLabelText(name)).toBeNull());
        expect(screen.queryByRole('combobox', { name: 'Time range' })).toBeNull();
        expect(screen.queryByTestId('type-select')).toBeNull();
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ops sign-off' } });
        expect((latest as unknown as BuilderState).job.steps[1]).toEqual({ id: 'gate', name: 'Ops sign-off', type: 'approval', approval: {} });
    });
});
