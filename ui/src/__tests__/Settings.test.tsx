import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import SettingsPage, { SettingsApi } from '../features/settings/SettingsPage';
import { changes, Draft } from '../features/settings/SettingsForm';
import { ApiError } from '../api/client';
import type { Destination, Health, Me, Settings } from '../api/types';
import { me as builderMe, renderThemed } from './fixtures';

const adminMe: Me = {
    user: 'root',
    roles: ['admin'],
    capabilities: ['orchestrator_admin', 'orchestrator_build', 'orchestrator_run'],
    can_admin: true,
    can_build: true,
    can_run: true,
    can_approve: true,
};

const SETTINGS: Settings = {
    max_searches: 10,
    max_searches_per_job: 4,
    queue_cap: 20,
    result_retention: 86400,
    run_retention_days: 90,
    fallback: { type: 'email', to: 'ops@example.com' },
    base_url: null,
};

const HEALTHY: Health = {
    index_present: true,
    engine_alive: true,
    engine_heartbeat: 1764550800,
    fallback_set: true,
    pending_commands: 0,
    messages: [],
    audit_index: 'orchestrator',
};

const DESTS: Destination[] = [
    { name: 'slack_ops', preset: 'slack', host: 'hooks.slack.com', has_headers: false },
    { name: 'pager', preset: 'generic', host: 'pager.example.com', has_headers: true },
];

function fakeApi(over: Partial<SettingsApi> = {}): SettingsApi {
    return {
        me: jest.fn(() => Promise.resolve(adminMe)),
        getSettings: jest.fn(() => Promise.resolve({ ...SETTINGS })),
        putSettings: jest.fn((changes: Partial<Settings>) => Promise.resolve({ ...SETTINGS, ...changes } as Settings)),
        listDestinations: jest.fn(() => Promise.resolve(DESTS)),
        saveDestination: jest.fn((d) =>
            Promise.resolve({ name: d.name, preset: d.preset || 'generic', host: 'x.example.com', has_headers: Boolean(d.headers) })
        ),
        deleteDestination: jest.fn((name: string) => Promise.resolve({ deleted: name })),
        health: jest.fn(() => Promise.resolve(HEALTHY)),
        ...over,
    };
}

describe('Settings', () => {
    test('settings hidden from non-admins', async () => {
        const api = fakeApi({ me: jest.fn(() => Promise.resolve(builderMe)) });
        renderThemed(<SettingsPage api={api} />);
        expect(await screen.findByText(/only for orchestrator admins/i)).toBeInTheDocument();
        expect(api.getSettings).not.toHaveBeenCalled();
        expect(api.listDestinations).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
        expect(screen.queryByText('Webhook destinations')).toBeNull();
    });

    test('health warns when audit index missing', async () => {
        const message = 'The orchestrator index is missing, so audit events are being lost.';
        const api = fakeApi({
            health: jest.fn(() =>
                Promise.resolve({ ...HEALTHY, index_present: false, messages: [message], audit_index: 'so_audit' })
            ),
        });
        renderThemed(<SettingsPage api={api} />);
        expect(await screen.findByText(message)).toBeInTheDocument();
        const audit = screen.getByTestId('health-index');
        expect(within(audit).getByText(/Missing/)).toBeInTheDocument();
        // The index name comes from the server.
        expect(within(audit).getByText(/so_audit/)).toBeInTheDocument();
    });

    test('health warns when fallback unset', async () => {
        const message =
            'No fallback notification destination is set, so a job with no failure or delay action fails silently.';
        const api = fakeApi({
            getSettings: jest.fn(() => Promise.resolve({ ...SETTINGS, fallback: null })),
            health: jest.fn(() => Promise.resolve({ ...HEALTHY, fallback_set: false, messages: [message] })),
        });
        renderThemed(<SettingsPage api={api} />);
        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(within(screen.getByTestId('health-fallback')).getByText(/Not set/)).toBeInTheDocument();
    });

    test('secret fields write-only', async () => {
        const api = fakeApi();
        renderThemed(<SettingsPage api={api} />);
        const pager = (await screen.findByText('pager')).closest('tr') as HTMLElement;
        // Stored values are never shown: only whether they are set.
        expect(within(pager).getByTestId('dest-url')).toHaveTextContent('Set');
        expect(within(pager).getByTestId('dest-headers')).toHaveTextContent('Set');
        const slack = screen.getByText('slack_ops').closest('tr') as HTMLElement;
        expect(within(slack).getByTestId('dest-headers')).toHaveTextContent('Not set');

        fireEvent.click(within(pager).getByRole('button', { name: /Replace/ }));
        const urlField = screen.getByLabelText('New URL') as HTMLInputElement;
        const headersField = screen.getByLabelText(/New headers/) as HTMLTextAreaElement;
        expect(urlField.value).toBe('');
        expect(urlField.type).toBe('password');
        expect(headersField.value).toBe('');

        fireEvent.change(urlField, { target: { value: 'https://pager.example.com/new' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save destination' }));
        await waitFor(() => expect(api.saveDestination).toHaveBeenCalled());
        // An empty headers field keeps the stored headers: the key is not sent.
        expect(api.saveDestination).toHaveBeenCalledWith({
            name: 'pager',
            url: 'https://pager.example.com/new',
            preset: 'generic',
        });
    });

    test('Body format offers every preset; Routing key shows only for PagerDuty and is write-only', async () => {
        const api = fakeApi();
        renderThemed(<SettingsPage api={api} />);
        fireEvent.click(await screen.findByRole('button', { name: 'New destination' }));
        expect(screen.queryByLabelText('Routing key')).toBeNull();
        fireEvent.click(screen.getByRole('combobox', { name: 'Body format' }));
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Generic JSON', 'Slack', 'Microsoft Teams', 'PagerDuty', 'ServiceNow']);
        fireEvent.click(screen.getByRole('option', { name: 'PagerDuty' }));
        const key = screen.getByLabelText('Routing key') as HTMLInputElement;
        expect(key.type).toBe('password');
        expect(screen.getByTestId('dest-routing-key')).toHaveTextContent('Not set');
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'pd_oncall' } });
        // The URL may stay empty: the server uses the PagerDuty Events API.
        expect(screen.getByRole('button', { name: 'Save destination' })).toHaveAttribute('aria-disabled', 'true');
        fireEvent.change(key, { target: { value: 'R0UT1NG' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save destination' }));
        await waitFor(() =>
            expect(api.saveDestination).toHaveBeenCalledWith({ name: 'pd_oncall', url: '', preset: 'pagerduty', routing_key: 'R0UT1NG' })
        );
    });

    test('a stored routing key shows Set and an empty field keeps it', async () => {
        const pd: Destination = { name: 'pd', preset: 'pagerduty', host: 'events.pagerduty.com', has_headers: false, body_secret_set: true };
        const api = fakeApi({ listDestinations: jest.fn(() => Promise.resolve([...DESTS, pd])) });
        renderThemed(<SettingsPage api={api} />);
        const row = (await screen.findByText('pd')).closest('tr') as HTMLElement;
        expect(within(row).getByText('PagerDuty')).toBeInTheDocument();
        fireEvent.click(within(row).getByRole('button', { name: /Replace/ }));
        expect(screen.getByTestId('dest-routing-key')).toHaveTextContent('Set');
        expect((screen.getByLabelText('Routing key') as HTMLInputElement).value).toBe('');
        fireEvent.click(screen.getByRole('button', { name: 'Save destination' }));
        await waitFor(() => expect(api.saveDestination).toHaveBeenCalledWith({ name: 'pd', url: '', preset: 'pagerduty' }));
    });

    test('a ServiceNow URL must end in the incident table path', async () => {
        renderThemed(<SettingsPage api={fakeApi()} />);
        fireEvent.click(await screen.findByRole('button', { name: 'New destination' }));
        fireEvent.click(screen.getByRole('combobox', { name: 'Body format' }));
        fireEvent.click(screen.getByRole('option', { name: 'ServiceNow' }));
        expect(screen.queryByLabelText('Routing key')).toBeNull();
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'snow' } });
        fireEvent.change(screen.getByLabelText('New URL'), { target: { value: 'https://acme.service-now.com/' } });
        expect(screen.getByText('A ServiceNow URL ends in /api/now/table/incident.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save destination' })).toHaveAttribute('aria-disabled', 'true');
        fireEvent.change(screen.getByLabelText('New URL'), { target: { value: 'https://acme.service-now.com/api/now/table/incident' } });
        expect(screen.getByRole('button', { name: 'Save destination' })).not.toHaveAttribute('aria-disabled', 'true');
    });

    test('limits show their bounds and the server issues', async () => {
        const api = fakeApi({
            putSettings: jest.fn(() =>
                Promise.reject(new ApiError(400, 'bad_setting', 'queue_cap must be a whole number from 1 to 1000'))
            ),
        });
        renderThemed(<SettingsPage api={api} />);
        const queue = (await screen.findByLabelText('Queue cap per job')) as HTMLInputElement;
        expect(queue.value).toBe('20');
        expect(screen.getByText(/From 1 to 1000/)).toBeInTheDocument();
        expect(screen.getByText(/From 1 to 100\b/)).toBeInTheDocument();
        expect(screen.getByText(/From 1 to 50\b/)).toBeInTheDocument();
        expect(screen.getByText(/From 1 to 3650/)).toBeInTheDocument();
        expect(screen.getByText(/From 1 to 168 hours/)).toBeInTheDocument();
        fireEvent.change(queue, { target: { value: '30' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
        expect(await screen.findByText('queue_cap must be a whole number from 1 to 1000')).toBeInTheDocument();
        // Only the changed setting is sent.
        expect(api.putSettings).toHaveBeenCalledWith({ queue_cap: 30 });
    });

    test('fallback saves an email address', async () => {
        const api = fakeApi({ getSettings: jest.fn(() => Promise.resolve({ ...SETTINGS, fallback: null })) });
        renderThemed(<SettingsPage api={api} />);
        fireEvent.click(await screen.findByRole('radio', { name: 'Email' }));
        const to = screen.getByLabelText('Email address') as HTMLInputElement;
        fireEvent.change(to, { target: { value: 'oncall@example.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
        await waitFor(() =>
            expect(api.putSettings).toHaveBeenCalledWith({ fallback: { type: 'email', to: 'oncall@example.com' } })
        );
    });

    test('a webhook fallback keeps its preset when the destination changes', () => {
        const original: Settings = { ...SETTINGS, fallback: { type: 'webhook', destination: 'slack_ops', preset: 'slack' } };
        const draft: Draft = {
            ints: { max_searches: '10', max_searches_per_job: '4', queue_cap: '20', result_retention: '24', run_retention_days: '90' },
            fallbackType: 'webhook',
            email: '',
            destination: 'pager',
            preset: 'slack',
            baseUrl: '',
        };
        expect(changes(original, draft)).toEqual({ fallback: { type: 'webhook', destination: 'pager', preset: 'slack' } });
        // Unchanged, the preset is not dropped either.
        expect(changes(original, { ...draft, destination: 'slack_ops' })).toEqual({});
    });
});
