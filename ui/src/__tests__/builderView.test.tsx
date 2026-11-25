import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import type { JobDefinition } from '../api/types';
import { BuilderView, ViewSwitch, useBuilderView } from '../features/simple/useBuilderView';
import { renderThemed } from './fixtures';

const simpleJob: JobDefinition = {
    name: 'Daily',
    enabled: true,
    triggers: [{ type: 'cron', cron: '0 6 * * *', enabled: true }],
    steps: [{ id: 'a', name: 'Count', type: 'inline', spl: 'index=_internal | stats count' }],
    edges: [],
} as JobDefinition;

const approvalJob: JobDefinition = {
    ...simpleJob,
    steps: [...(simpleJob.steps || []), { id: 'gate', name: 'Gate', type: 'approval', approval: {} }],
    edges: [{ from: 'a', to: 'gate' }],
} as JobDefinition;

function Shown({ job }: { job: JobDefinition }) {
    const [view] = useBuilderView(job);
    return <span data-testid="view">{view}</span>;
}

describe('builder views', () => {
    afterEach(() => window.localStorage.removeItem('so.builder.view'));

    test('stored flow opens advanced', () => {
        window.localStorage.setItem('so.builder.view', 'flow');
        renderThemed(<Shown job={simpleJob} />);
        expect(screen.getByTestId('view').textContent).toBe('advanced');
    });

    test('nothing stored opens standard', () => {
        window.localStorage.removeItem('so.builder.view');
        renderThemed(<Shown job={simpleJob} />);
        expect(screen.getByTestId('view').textContent).toBe('standard');
    });

    test("stored simple opens standard for a job Simple can't show", () => {
        window.localStorage.setItem('so.builder.view', 'simple');
        renderThemed(<Shown job={approvalJob} />);
        expect(screen.getByTestId('view').textContent).toBe('standard');
    });

    test('stored simple stays simple for a job Simple can show', () => {
        window.localStorage.setItem('so.builder.view', 'simple');
        renderThemed(<Shown job={simpleJob} />);
        expect(screen.getByTestId('view').textContent).toBe('simple');
    });

    test('a new job opens in the view it asks for (an example), whatever is stored', () => {
        window.localStorage.setItem('so.builder.view', 'standard');
        function Asked({ asked }: { asked: BuilderView }) {
            const [view] = useBuilderView(simpleJob, true, asked);
            return <span data-testid="view">{view}</span>;
        }
        renderThemed(<Asked asked="advanced" />);
        expect(screen.getByTestId('view').textContent).toBe('advanced');
    });

    test('switch offers Simple, Standard and Advanced', () => {
        const onView = jest.fn<void, [BuilderView]>();
        renderThemed(<ViewSwitch view="standard" onView={onView} lockedReasons={[]} />);
        expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Simple', 'Standard', 'Advanced']);
        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
        expect(onView).toHaveBeenCalledWith('advanced');
    });

    test('locked Simple shows the reasons and stays', () => {
        const onView = jest.fn<void, [BuilderView]>();
        renderThemed(<ViewSwitch view="standard" onView={onView} lockedReasons={['an approval step']} />);
        const simple = screen.getByRole('button', { name: /Simple/ });
        expect(simple).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(simple);
        expect(onView).not.toHaveBeenCalled();
        expect(screen.getByText("Simple can't show this job: an approval step. Use Standard or Advanced.")).toBeInTheDocument();
    });
});
