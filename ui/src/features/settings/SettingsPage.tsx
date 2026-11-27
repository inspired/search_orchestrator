/* Settings (orchestrator_admin only): health, limits and retention, the fallback
 * notification. The page hides itself from other users; the
 * server enforces the same rule on every route. */
import React, { useEffect, useState } from 'react';
import Message from '@splunk/react-ui/Message';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import * as client from '../../api/client';
import type { AlertAction, Health, Me, Settings } from '../../api/types';
import { CAP_ADMIN } from '../../appNames';
import PageShell from '../../components/PageShell';
import usePoll from '../../hooks/usePoll';
import HealthPanel from './HealthPanel';
import SettingsForm from './SettingsForm';

export interface SettingsApi {
    me: () => Promise<Me>;
    getSettings: () => Promise<Settings>;
    putSettings: (changes: Partial<Settings>) => Promise<Settings>;
    listAlertActions: () => Promise<AlertAction[]>;
    health: () => Promise<Health>;
}

const defaultApi: SettingsApi = {
    me: client.me,
    getSettings: client.getSettings,
    putSettings: client.putSettings,
    listAlertActions: client.listAlertActions,
    health: client.health,
};

const space: React.CSSProperties = { marginTop: '32px' };

function AdminSettings({ api }: { api: SettingsApi }) {
    const health = usePoll(api.health, 30000, true);
    const [settings, setSettings] = useState<Settings | null>(null);
    const [alertActions, setAlertActions] = useState<AlertAction[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        api.getSettings()
            .then(setSettings)
            .catch((err: Error) => setLoadError(`The settings could not be loaded: ${err.message}`));
        api.listAlertActions()
            .then(setAlertActions)
            .catch(() => setAlertActions([]));
    }, [api]);

    const saveSettings = async (changes: Partial<Settings>) => {
        setSettings(await api.putSettings(changes));
        health.refresh();
    };

    return (
        <>
            <HealthPanel health={health.data} error={health.error} />
            {loadError && (
                <Message type="error" appearance="default">
                    {loadError}
                </Message>
            )}
            {settings ? (
                <div style={space}>
                    <SettingsForm settings={settings} alertActions={alertActions} onSave={saveSettings} />
                </div>
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
                    : `Settings are only for orchestrator admins (the ${CAP_ADMIN} capability).`}
            </Message>
        );
    } else {
        body = <AdminSettings api={api} />;
    }
    return <PageShell title="Settings">{body}</PageShell>;
}
