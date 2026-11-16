import React from 'react';
import { screen } from '@testing-library/react';
import GraphView from '../features/builder/GraphView';
import { renderThemed } from './fixtures';

const steps = [
    { id: 'daily', type: 'inline' as const, spl: '| makeresults' },
    { id: 'weekly', type: 'inline' as const, spl: '| makeresults' },
];
const edges = [{ from: 'daily', to: 'weekly' }];

describe('GraphView', () => {
    test('shows status text per step', () => {
        renderThemed(<GraphView steps={steps} edges={edges} statusByStep={{ daily: { state: 'failed' }, weekly: { state: 'waiting' } }} />);
        expect(screen.getByText('Failed')).toBeInTheDocument();
        expect(screen.getByText('Waiting')).toBeInTheDocument();
    });
});
