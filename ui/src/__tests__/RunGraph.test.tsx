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
        // The status icon drawn beside "Sent" (12 px, before the text).
        expect(screen.getByTestId('node-action:a:0').querySelector('svg[width="12"]')).not.toBeNull();
        fireEvent.keyDown(screen.getByTestId('node-action:a:0'), { key: 'Enter' });
        expect(onSelect).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByTestId('node-step:a'), { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledWith('a');
    });

    test('groups are drawn expanded on the run page, whatever was saved', () => {
        const layout = {
            nodes: { 'step:a': { x: 100, y: 100 }, 'step:b': { x: 400, y: 100 } },
            groups: [{ id: 'g1', title: 'Both', color: 'categoricalA4' as const, x: 50, y: 50, w: 600, h: 200, collapsed: true }],
        };
        renderThemed(<RunGraph definition={{ ...def, layout }} states={{ a: { state: 'running' } }} actions={[]} />);
        expect(screen.getByTestId('group-g1')).toHaveTextContent('Both');
        expect(screen.getByTestId('node-step:a')).toBeInTheDocument();
        expect(screen.queryByTestId('group-block-g1')).toBeNull();
    });
});
