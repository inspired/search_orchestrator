import React, { useReducer } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import type { JobDefinition } from '../api/types';
import { findIssues } from '../features/builder/graphLogic';
import { nodeKindOfStep } from '../features/builder/nodeModel';
import { outputIssue, outputSpl } from '../features/builder/outputs';
import OutputPanel from '../features/builder/OutputPanel';
import { BuilderState, initialState, reducer } from '../features/builder/reducer';
import { renderThemed } from './fixtures';

describe('outputSpl', () => {
    test('summary index', () => {
        expect(outputSpl({ kind: 'summary_index', index: 'summary' })).toBe('| collect index=summary marker="so_run=$run.id$"');
        expect(outputSpl({ kind: 'summary_index', index: 'summary', source: 'daily rollup' })).toBe(
            '| collect index=summary source="daily rollup" marker="so_run=$run.id$"'
        );
        expect(outputSpl({ kind: 'summary_index', index: 'summary', add_run_id: false })).toBe('| collect index=summary');
        expect(outputSpl({ kind: 'summary_index', index: 'summary', source: 'a"b' })).toContain('source="a\\"b"');
    });
    test('lookup', () => {
        expect(outputSpl({ kind: 'lookup', name: 'hosts.csv' })).toBe('| outputlookup hosts.csv');
        expect(outputSpl({ kind: 'lookup', name: 'hosts.csv', append: true })).toBe('| outputlookup append=true hosts.csv');
    });
});

describe('outputIssue', () => {
    test('messages', () => {
        expect(outputIssue({ kind: 'summary_index', index: '' })).toBe('Type the summary index to write to');
        expect(outputIssue({ kind: 'summary_index', index: 'a b' })).toBe('Use letters, numbers, _ . : or - in the index name');
        expect(outputIssue({ kind: 'lookup', name: '' })).toBe('Type the lookup name to write to');
        expect(outputIssue({ kind: 'lookup', name: 'a/b' })).toBe('Use letters, numbers, _ . : or - in the lookup name');
        expect(outputIssue({ kind: 'summary_index', index: 'summary' })).toBeNull();
        expect(outputIssue({ kind: 'lookup', name: 'hosts.csv' })).toBeNull();
    });
});

const job = (): JobDefinition => ({
    name: 'j',
    enabled: true,
    steps: [
        { id: 'a', type: 'inline', spl: '| makeresults' },
        { id: 'summary', type: 'previous', spl: '| collect index= marker="so_run=$run.id$"', output: { kind: 'summary_index', index: '', add_run_id: true } },
    ],
    edges: [{ from: 'a', to: 'summary', condition: 'on_success' }],
});

describe('model and checks', () => {
    test('nodeKindOfStep is summary_index for an output step', () => {
        expect(nodeKindOfStep(job().steps[1])).toBe('summary_index');
    });
    test('findIssues flags a bad output with its step id', () => {
        const issues = findIssues(job()).filter((i) => i.code === 'bad_output');
        expect(issues).toEqual([{ level: 'error', code: 'bad_output', message: 'Type the summary index to write to', step: 'summary' }]);
        const ok = job();
        ok.steps[1].output = { kind: 'summary_index', index: 'summary' };
        expect(findIssues(ok).some((i) => i.code === 'bad_output')).toBe(false);
    });
});

function Harness({ onState }: { onState: (s: BuilderState) => void }) {
    const [state, dispatch] = useReducer(reducer, job(), initialState);
    onState(state);
    return <OutputPanel job={state.job} stepId="summary" dispatch={dispatch} onRequestRemove={jest.fn()} />;
}

describe('OutputPanel', () => {
    function setup() {
        let latest: BuilderState | null = null;
        renderThemed(<Harness onState={(s) => (latest = s)} />);
        return () => (latest as unknown as BuilderState).job.steps[1];
    }
    test('typing an index updates output and spl together, and the error clears', () => {
        const step = setup();
        expect(screen.getByText('Type the summary index to write to')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Summary index'), { target: { value: 'summary' } });
        expect(step().output).toEqual({ kind: 'summary_index', index: 'summary', add_run_id: true });
        expect(step().spl).toBe('| collect index=summary marker="so_run=$run.id$"');
        expect(screen.queryByText('Type the summary index to write to')).not.toBeInTheDocument();
    });
    test('Edit as search removes output and keeps spl', () => {
        const step = setup();
        fireEvent.change(screen.getByLabelText('Summary index'), { target: { value: 'summary' } });
        fireEvent.click(screen.getByRole('button', { name: 'Edit as search' }));
        expect('output' in step()).toBe(false);
        expect(step().spl).toBe('| collect index=summary marker="so_run=$run.id$"');
        expect(nodeKindOfStep(step())).toBe('previous');
    });
});
