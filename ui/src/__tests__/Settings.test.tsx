import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import SettingsPage, { SettingsApi } from '../features/settings/SettingsPage';
import { changes, Draft } from '../features/settings/SettingsForm';
import { ApiError } from '../api/client';
import type { Health, Me, Settings } from '../api/types';
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


function fakeApi(over: Partial<SettingsApi> = {}): SettingsApi {
    return {
        me: jest.fn(() => Promise.resolve(adminMe)),
        getSettings: jest.fn(() => Promise.resolve({ ...SETTINGS })),
        putSettings: jest.fn((changes: Partial<Settings>) => Promise.resolve({ ...SETTINGS, ...changes } as Settings)),
        listAlertActions: jest.fn(() => Promise.resolve([{ name: 'slack', label: 'Slack', params: [] }])),
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
        expect(api.listAlertActions).not.toHaveBeenCalled();
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

    test('the log level shows in Settings and is sent only when it changes', async () => {
        renderThemed(<SettingsPage api={fakeApi()} />);
        expect(await screen.findByText('Log level')).toBeInTheDocument();
        const draft: Draft = {
            ints: { max_searches: '10', max_searches_per_job: '4', queue_cap: '20', result_retention: '24', run_retention_days: '90' },
            fallbackType: 'email',
            email: 'ops@example.com',
            alertAction: '',
            alertParams: '',
            baseUrl: '',
            logLevel: 'INFO',
            scanLimit: '',
            scanAction: 'warn',
            turnedOff: [],
        };
        expect(changes(SETTINGS, draft)).toEqual({});
        expect(changes(SETTINGS, { ...draft, logLevel: 'DEBUG' })).toEqual({ log_level: 'DEBUG' });
        expect(changes({ ...SETTINGS, log_level: 'DEBUG' }, { ...draft, logLevel: 'DEBUG' })).toEqual({});
    });

});

describe('Search cost settings', () => {
    test('the scan limit and action are sent only when they change', () => {
        const { changes: diff } = jest.requireActual('../features/settings/SettingsForm');
        const base = { max_searches: 10, max_searches_per_job: 4, queue_cap: 20, result_retention: 86400, run_retention_days: 90, fallback: null, base_url: null, log_level: 'INFO', scan_limit: null, scan_limit_action: 'warn' };
        const draft = { ints: { max_searches: '10', max_searches_per_job: '4', queue_cap: '20', result_retention: '24', run_retention_days: '90' }, fallbackType: 'none', email: '', destination: '', preset: '', baseUrl: '', logLevel: 'INFO', scanLimit: '', scanAction: 'warn' };
        expect(diff(base, draft)).toEqual({});
        expect(diff(base, { ...draft, scanLimit: '50 000 000', scanAction: 'stop' })).toEqual({ scan_limit: 50000000, scan_limit_action: 'stop' });
        expect(diff({ ...base, scan_limit: 5 }, draft)).toEqual({ scan_limit: null });
    });
});
