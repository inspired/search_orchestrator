import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../api/client';
import { decide } from '../api/approvals';
import type { RunDetail, StepStatus } from '../api/types';
import ApprovalBox from '../features/run/ApprovalBox';
import StepDrawer from '../features/run/StepDrawer';
import { formatTime } from '../format';
import { me, NOW, renderThemed, rollupRun } from './fixtures';

jest.mock('../api/approvals', () => ({ decide: jest.fn() }));
const decideMock = decide as jest.MockedFunction<typeof decide>;

const approver = { ...me, user: 'bob', can_approve: true };

function gatedRun(gate: StepStatus, timeout?: number): RunDetail {
    const base = rollupRun();
    return {
        ...base,
        definition: {
            ...base.definition,
            steps: [
                { id: 'daily', name: 'Daily summary', type: 'inline', spl: '| makeresults' },
                { id: 'gate', name: 'Sign-off', type: 'approval', approval: timeout ? { timeout } : {} },
            ],
            edges: [{ from: 'daily', to: 'gate', condition: 'on_success' }],
        },
        steps: { daily: { state: 'succeeded' }, gate },
    };
}

const awaiting: StepStatus = {
    state: 'awaiting_approval',
    started_at: NOW - 600,
    approval_state: { requested_at: NOW - 600, message: 'Daily found 12 rows. Go on?', decision: null },
};

function open(run: RunDetail, who = approver) {
    const onDecided = jest.fn();
    renderThemed(<ApprovalBox run={run} stepId="gate" me={who} onDecided={onDecided} />);
    return onDecided;
}

beforeEach(() => decideMock.mockReset());

describe('ApprovalBox', () => {
    test('shows the stored message with Approve and Reject', () => {
        open(gatedRun(awaiting));
        expect(screen.getByText('Daily found 12 rows. Go on?')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    });

    test('is absent for a user without can_approve', () => {
        const { container } = renderThemed(<ApprovalBox run={gatedRun(awaiting)} stepId="gate" me={{ ...me, can_approve: false }} onDecided={jest.fn()} />);
        expect(container.textContent).toBe('');
        expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    });

    test('Approve asks in a Modal and sends the decision with the comment', async () => {
        decideMock.mockResolvedValue({ command_id: 'c1' });
        const onDecided = open(gatedRun(awaiting));
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(screen.getByRole('dialog')).toHaveTextContent('Approve Sign-off?');
        fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'ok' } });
        fireEvent.click(screen.getByRole('button', { name: 'Approve Sign-off' }));
        await waitFor(() => expect(decideMock).toHaveBeenCalledWith('rollup:1', 'gate', 'approve', 'ok'));
        expect(await screen.findByText('Decision sent. The run updates in a few seconds.')).toBeInTheDocument();
        expect(onDecided).toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    });

    test("Reject's confirm is dimmed until a comment is typed", async () => {
        decideMock.mockResolvedValue({ command_id: 'c2' });
        open(gatedRun(awaiting));
        fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
        expect(screen.getByRole('dialog')).toHaveTextContent('Reject Sign-off?');
        const confirm = () => screen.getByRole('button', { name: 'Reject Sign-off' });
        expect(confirm()).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByText('Add a comment saying why')).toBeInTheDocument();
        fireEvent.click(confirm());
        expect(decideMock).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'no' } });
        expect(confirm()).not.toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(confirm());
        await waitFor(() => expect(decideMock).toHaveBeenCalledWith('rollup:1', 'gate', 'reject', 'no'));
    });

    test('Escape closes the Modal without sending', () => {
        open(gatedRun(awaiting));
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(decideMock).not.toHaveBeenCalled();
    });

    test("a refusal shows the server's message", async () => {
        decideMock.mockRejectedValue(new ApiError(403, 'forbidden', 'Only members of ops-leads may approve this step'));
        const onDecided = open(gatedRun(awaiting));
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        fireEvent.click(screen.getByRole('button', { name: 'Approve Sign-off' }));
        expect(await screen.findByText('Only members of ops-leads may approve this step')).toBeInTheDocument();
        expect(onDecided).not.toHaveBeenCalled();
    });

    test.each([
        [{ decision: 'approve', by: 'bob', comment: 'ok' }, 'Approved by bob: ok'],
        [{ decision: 'reject', by: 'bob', comment: 'no' }, 'Rejected by bob: no'],
        [{ decision: 'approve', by: 'bob', comment: '' }, 'Approved by bob'],
        [{ decision: 'reject', by: 'timeout', comment: '' }, 'Rejected: no decision within 4 hours'],
    ] as const)('a decided step says who decided (%j)', (decided, text) => {
        const state = decided.decision === 'approve' ? 'succeeded' : 'failed';
        open(gatedRun({ state, approval_state: { requested_at: NOW - 600, message: '', ...decided, decided_at: NOW } }, 14400), { ...me, can_approve: false });
        expect(screen.getByText(text)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    });

    test('the step drawer says since when the step waits', () => {
        renderThemed(<StepDrawer run={gatedRun(awaiting)} stepId="gate" now={NOW} onClose={jest.fn()} me={{ ...me, can_approve: false }} />);
        expect(screen.getByText(`Waiting for approval · since ${formatTime(NOW - 600)}`)).toBeInTheDocument();
    });

    test('the step drawer shows it', () => {
        renderThemed(<StepDrawer run={gatedRun(awaiting)} stepId="gate" now={NOW} onClose={jest.fn()} me={approver} onDecided={jest.fn()} />);
        expect(screen.getByText(/^Waiting for approval · since /)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    });
});
