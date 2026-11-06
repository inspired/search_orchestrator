/* Settings (orchestrator_admin only): health, limits and retention, the fallback
 * notification and webhook destinations. The page hides itself from other users; the
 * server enforces the same rule on every route. */
import React, { useCallback, useEffect, useState } from 'react';
import Message from '@splunk/react-ui/Message';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import * as client from '../../api/client';
import type { Destination, DestinationInput, Health, Me, Settings } from '../../api/types';
import PageShell from '../../components/PageShell';
import usePoll from '../../hooks/usePoll';
import Destinations from './Destinations';
import HealthPanel from './HealthPanel';
import SettingsForm from './SettingsForm';

export interface SettingsApi {
    me: () => Promise<Me>;
    getSettings: () => Promise<Settings>;
    putSettings: (changes: Partial<Settings>) => Promise<Settings>;
    listDestinations: () => Promise<Destination[]>;
    saveDestination: (dest: DestinationInput) => Promise<Destination>;
    deleteDestination: (name: string) => Promise<{ deleted: string }>;
    health: () => Promise<Health>;
}

const defaultApi: SettingsApi = {
    me: client.me,
    getSettings: client.getSettings,
    putSettings: client.putSettings,
    listDestinations: client.listDestinations,
    saveDestination: client.saveDestination,
    deleteDestination: client.deleteDestination,
    health: client.health,
};

const space: React.CSSProperties = { marginTop: '32px' };

function AdminSettings({ api }: { api: SettingsApi }) {
    const health = usePoll(api.health, 30000, true);
    const [settings, setSettings] = useState<Settings | null>(null);
    const [destinations, setDestinations] = useState<Destination[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const loadDestinations = useCallback(
        () =>
            api
                .listDestinations()
                .then(setDestinations)
                .catch((err: Error) => setLoadError(`The destinations could not be loaded: ${err.message}`)),
        [api]
    );

    useEffect(() => {
        api.getSettings()
            .then(setSettings)
            .catch((err: Error) => setLoadError(`The settings could not be loaded: ${err.message}`));
        loadDestinations();
    }, [api, loadDestinations]);

    const saveSettings = async (changes: Partial<Settings>) => {
        setSettings(await api.putSettings(changes));
        health.refresh();
    };
    const saveDestination = async (dest: DestinationInput) => {
        await api.saveDestination(dest);
        await loadDestinations();
        health.refresh();
    };
    const deleteDestination = async (name: string) => {
        await api.deleteDestination(name);
        await loadDestinations();
        health.refresh();
    };

    const fb = settings && settings.fallback;
    return (
        <>
            <HealthPanel health={health.data} error={health.error} />
            {loadError && (
                <Message type="error" appearance="default">
                    {loadError}
                </Message>
            )}
            {settings && destinations ? (
                <>
                    <div style={space}>
                        <SettingsForm settings={settings} destinations={destinations} onSave={saveSettings} />
                    </div>
                    <div style={space}>
                        <Destinations
                            destinations={destinations}
                            fallbackName={fb && fb.type === 'webhook' ? fb.destination : null}
                            onSave={saveDestination}
                            onDelete={deleteDestination}
                        />
                    </div>
                </>
            ) : (
                !loadError && <WaitSpinner size="medium" />
            )}
        </>
    );
}

export default function SettingsPage({ api = defaultApi }: { api?: SettingsApi }) {
    const [me, setMe] = useState<Me | null | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.me()
            .then(setMe)
            .catch((err: Error) => {
                setMe(null);
                setError(err.message);
            });
    }, [api]);

    let body: React.ReactNode;
    if (me === undefined) {
        body = <WaitSpinner size="medium" />;
    } else if (!me || !me.can_admin) {
        body = (
            <Message type="info" appearance="default">
                {error
                    ? `Your access could not be checked: ${error}`
                    : 'Settings are only for orchestrator admins (the orchestrator_admin capability).'}
            </Message>
        );
    } else {
        body = <AdminSettings api={api} />;
    }
    return <PageShell title="Settings">{body}</PageShell>;
}
