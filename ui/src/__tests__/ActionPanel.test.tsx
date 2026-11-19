import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import ActionPanel from '../features/builder/ActionPanel';
import JobNodePanel from '../features/builder/JobNodePanel';
import type { JobDefinition } from '../api/types';
import { renderThemed } from './fixtures';

const job = (): JobDefinition => ({
    name: 'j',
    enabled: true,
    steps: [
        { id: 'a', name: 'Daily summary', type: 'inline', spl: '| makeresults', actions: [{ hook: 'on_failure', type: 'email', to: 'ops@x.com' }] },
        { id: 'b', name: 'Weekly', type: 'inline', spl: '| makeresults', actions: [{ hook: 'on_success', type: 'email', to: 'q@x.com' }] },
    ],
    edges: [],
    actions: [{ hook: 'on_failure', type: 'webhook', destination: 'slack-ops' }],
});

function setup(scope: string, index: number) {
    const dispatch = jest.fn();
    const onMoved = jest.fn();
    const onRequestRemove = jest.fn();
    renderThemed(
        <ActionPanel job={job()} scope={scope} index={index} destinations={[{ name: 'slack-ops' } as never]} alertActions={[]} tokenGroups={[]} dispatch={dispatch} onMoved={onMoved} onRequestRemove={onRequestRemove} />
    );
    return { dispatch, onMoved, onRequestRemove };
}

describe('ActionPanel', () => {
    test('shows the issues given for the action', () => {
        renderThemed(
            <ActionPanel
                job={job()}
                scope="job"
                index={0}
                destinations={[]}
                alertActions={[]}
                tokenGroups={[]}
                issues={[{ level: 'error', code: 'unknown_destination', message: "webhook destination 'slack-ops' doesn't exist; pick another", step: null }]}
                dispatch={jest.fn()}
                onMoved={jest.fn()}
                onRequestRemove={jest.fn()}
            />
        );
        expect(screen.getByText("webhook destination 'slack-ops' doesn't exist; pick another")).toBeInTheDocument();
    });

    test('moving to Whole job · Finished either way dispatches moveAction and reports the new key', () => {
        const { dispatch, onMoved } = setup('a', 0);
        fireEvent.click(screen.getByRole('combobox', { name: 'When' }));
        fireEvent.click(screen.getByRole('option', { name: 'Whole job · Finished either way' }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'moveAction', scope: 'a', index: 0, toScope: 'job', hook: 'on_complete' });
        // The job already has one action, so the moved one is appended at index 1.
        expect(onMoved).toHaveBeenCalledWith('action:job:1');
    });

    test('changing only the outcome keeps the key', () => {
        const { dispatch, onMoved } = setup('a', 0);
        fireEvent.click(screen.getByRole('combobox', { name: 'When' }));
        fireEvent.click(screen.getByRole('option', { name: 'Daily summary · Succeeded' }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'moveAction', scope: 'a', index: 0, toScope: 'a', hook: 'on_success' });
        expect(onMoved).toHaveBeenCalledWith('action:a:0');
    });

    test('lists every step and the whole job with its outcomes', () => {
        setup('a', 0);
        fireEvent.click(screen.getByRole('combobox', { name: 'When' }));
        const names = screen.getAllByRole('option').map((o) => o.textContent);
        expect(names).toHaveLength(16);
        expect(names[0]).toBe('Daily summary · Succeeded');
        expect(names[5]).toBe('Weekly · Succeeded');
        expect(names[14]).toBe('Whole job · Delayed');
        expect(names[15]).toBe('Whole job · Late');
    });

    test('editing an email field dispatches updateAction with only that field', () => {
        const { dispatch } = setup('a', 0);
        fireEvent.change(screen.getByLabelText('To'), { target: { value: 'new@x.com' } });
        expect(dispatch).toHaveBeenCalledWith({ type: 'updateAction', scope: 'a', index: 0, changes: { to: 'new@x.com' } });
    });

    test('Remove action asks the page and does not dispatch', () => {
        const { dispatch, onRequestRemove } = setup('job', 0);
        fireEvent.click(screen.getByRole('button', { name: 'Remove action' }));
        expect(onRequestRemove).toHaveBeenCalledWith('action:job:0');
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('JobNodePanel', () => {
    test('explains the lines and selects an outgoing action', () => {
        const onSelect = jest.fn();
        renderThemed(<JobNodePanel job={job()} onSelect={onSelect} />);
        expect(
            screen.getByText('Lines from Whole job fire for the whole run. Without a Failed line, the fallback notification in Settings is used.')
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Failed: Webhook/ }));
        expect(onSelect).toHaveBeenCalledWith('action:job:0');
    });

    test('a webhook with the Slack preset shows its type as Slack and keeps the destination', () => {
        const dispatch = jest.fn();
        const j = job();
        j.actions = [{ hook: 'on_failure', type: 'webhook', preset: 'slack', destination: 'slack-ops' }];
        renderThemed(<ActionPanel job={j} scope="job" index={0} destinations={[{ name: 'slack-ops' } as never]} alertActions={[]} tokenGroups={[]} dispatch={dispatch} onMoved={jest.fn()} onRequestRemove={jest.fn()} />);
        expect(screen.getByRole('combobox', { name: 'Do' })).toHaveTextContent('Slack');
        expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveTextContent('slack-ops');
    });
});

describe('channel action panels', () => {
    const DESTS = [
        { name: 'generic-ops', preset: 'generic', host: 'x', has_headers: false },
        { name: 'pd-oncall', preset: 'pagerduty', host: 'events.pagerduty.com', has_headers: false, body_secret_set: true },
        { name: 'snow-prod', preset: 'servicenow', host: 'acme.service-now.com', has_headers: true },
    ] as never[];
    const panel = (action: Record<string, unknown>, destinations = DESTS) => {
        const dispatch = jest.fn();
        const j = job();
        j.actions = [{ hook: 'on_failure', type: 'webhook', destination: '', ...action } as never];
        renderThemed(<ActionPanel job={j} scope="job" index={0} destinations={destinations} alertActions={[]} tokenGroups={[]} dispatch={dispatch} onMoved={jest.fn()} onRequestRemove={jest.fn()} />);
        return dispatch;
    };

    test('the PagerDuty panel lists only PagerDuty destinations and has no message format', () => {
        panel({ preset: 'pagerduty' });
        expect(screen.getByRole('combobox', { name: 'Do' })).toHaveTextContent('PagerDuty');
        expect(screen.queryByRole('combobox', { name: 'Message format' })).toBeNull();
        fireEvent.click(screen.getByRole('combobox', { name: 'Destination' }));
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['pd-oncall']);
    });

    test('with no PagerDuty destinations it says how to get one', () => {
        panel({ preset: 'pagerduty' }, DESTS.filter((d) => (d as { preset: string }).preset !== 'pagerduty'));
        expect(screen.getByText('No PagerDuty destinations yet; ask an admin to add one in Settings')).toBeInTheDocument();
    });

    test('picking Severity Warning writes options, and picking the default removes them', () => {
        const dispatch = panel({ preset: 'pagerduty', destination: 'pd-oncall' });
        fireEvent.click(screen.getByRole('combobox', { name: 'Severity' }));
        fireEvent.click(screen.getByRole('option', { name: 'Warning' }));
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'updateAction', scope: 'job', index: 0, changes: { options: { severity: 'warning' } } });
    });

    test('picking the default severity removes the key and the empty options', () => {
        const dispatch = panel({ preset: 'pagerduty', destination: 'pd-oncall', options: { severity: 'warning' } });
        expect(screen.getByRole('combobox', { name: 'Severity' })).toHaveTextContent('Warning');
        fireEvent.click(screen.getByRole('combobox', { name: 'Severity' }));
        fireEvent.click(screen.getByRole('option', { name: /^Default/ }));
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'updateAction', scope: 'job', index: 0, changes: { options: undefined } });
    });

    test('ServiceNow has urgency, impact and assignment group; the default urgency removes its key', () => {
        const dispatch = panel({ preset: 'servicenow', destination: 'snow-prod', options: { urgency: '1', impact: '3' } });
        expect(screen.getByRole('combobox', { name: 'Urgency' })).toHaveTextContent('1 High');
        expect(screen.getByRole('combobox', { name: 'Impact' })).toHaveTextContent('3 Low');
        fireEvent.click(screen.getByRole('combobox', { name: 'Urgency' }));
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['1 High', '2 Medium', '3 Low']);
        fireEvent.click(screen.getByRole('option', { name: '2 Medium' }));
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'updateAction', scope: 'job', index: 0, changes: { options: { impact: '3' } } });
        fireEvent.change(screen.getByLabelText('Assignment group'), { target: { value: 'Ops' } });
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'updateAction', scope: 'job', index: 0, changes: { options: { urgency: '1', impact: '3', assignment_group: 'Ops' } } });
    });

    test('a Teams panel has no options and changing the destination never writes options', () => {
        const dispatch = panel({ preset: 'teams' }, [...DESTS, { name: 'teams-ops', preset: 'teams', host: 'x', has_headers: false } as never]);
        expect(screen.getByRole('combobox', { name: 'Do' })).toHaveTextContent('Microsoft Teams');
        expect(screen.queryByRole('combobox', { name: 'Severity' })).toBeNull();
        fireEvent.click(screen.getByRole('combobox', { name: 'Destination' }));
        fireEvent.click(screen.getByRole('option', { name: 'teams-ops' }));
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'updateAction', scope: 'job', index: 0, changes: { destination: 'teams-ops' } });
    });

    test('choosing PagerDuty under Do makes a PagerDuty webhook action', () => {
        const dispatch = panel({ preset: 'generic', destination: 'generic-ops' });
        fireEvent.click(screen.getByRole('combobox', { name: 'Do' }));
        fireEvent.click(screen.getByRole('option', { name: 'PagerDuty' }));
        expect(dispatch).toHaveBeenLastCalledWith({ type: 'updateAction', scope: 'job', index: 0, changes: { preset: 'pagerduty', destination: '' } });
    });
});

describe('action retries', () => {
    test('retryText spells out the waits', () => {
        const { retryText } = jest.requireActual('../features/builder/ActionPanel');
        expect(retryText(3, 30)).toMatch(/^3 retries, waiting 30 s, 1 min and 2 min\./);
        expect(retryText(1, 600)).toMatch(/^1 retry, waiting 10 min\./);
        expect(retryText(0, 30)).toBe('No retries: a failed send fails the action at once.');
        expect(retryText(8, 600)).toMatch(/10 min, 20 min, 40 min, … and 1 h \(at most 1 h each\)/);
    });
});
