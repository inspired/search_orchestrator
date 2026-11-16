import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import type { ActionRun, JobDefinition } from '../api/types';
import RunGraph from '../features/run/RunGraph';
import { renderThemed } from './fixtures';

const def: JobDefinition = {
    name: 'j',
    enabled: true,
    triggers: [],
    steps: [
        { id: 'a', type: 'inline', spl: 'x', actions: [{ hook: 'on_success', type: 'email', to: 'a@b' }] },
        { id: 'b', type: 'inline', spl: 'y' },
    ],
    edges: [{ from: 'a', to: 'b', condition: 'on_success' }],
};
const rows = [{ run_id: 'r', scope: 'step', step_id: 'a', hook: 'on_success', actions: [{ index: 0, state: 'done', attempts: 1 }] }] as ActionRun[];

describe('RunGraph', () => {
    test('shows step and action states; only step nodes select', () => {
        const onSelect = jest.fn();
        renderThemed(<RunGraph definition={def} states={{ a: { state: 'failed' }, b: { state: 'waiting' } }} actions={rows} onSelect={onSelect} />);
        expect(screen.getByText('Failed')).toBeInTheDocument();
        expect(screen.getByText('Sent')).toBeInTheDocument();
        fireEvent.keyDown(screen.getByTestId('node-action:a:0'), { key: 'Enter' });
        expect(onSelect).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByTestId('node-step:a'), { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledWith('a');
    });
});
