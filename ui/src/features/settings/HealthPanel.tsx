/* Health: the engine, the audit index and the fallback, each as plain text with an icon,
 * the server's health messages as Splunk warning messages, and where to turn on the app health
 * alerts (shipped off) and see what they found. */
import React from 'react';
import Heading from '@splunk/react-ui/Heading';
import Link from '@splunk/react-ui/Link';
import { createURL } from '@splunk/splunk-utils/url';
import Message from '@splunk/react-ui/Message';
import CheckCircle from '@splunk/react-icons/CheckCircle';
import ExclamationTriangle from '@splunk/react-icons/ExclamationTriangle';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Health } from '../../api/types';
import { formatTime } from '../../format';

interface LineProps {
    ok: boolean;
    label: string;
    value: string;
    testId: string;
}

function HealthLine({ ok, label, value, testId }: LineProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const IconFor = ok ? CheckCircle : ExclamationTriangle;
    return (
        <li data-testid={testId} style={{ display: 'flex', gap: '8px', padding: '4px 0' }}>
            <span style={{ minWidth: '200px', color: theme.contentColorMuted }}>{label}</span>
            <span
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35em',
                    color: ok ? undefined : theme.statusColorHigh,
                }}
            >
                <IconFor aria-hidden />
                <span>{value}</span>
            </span>
        </li>
    );
}

/** This app's id from the page URL (/app/<id>/...), so the test copy links to its own alerts. */
export function appId(path: string = window.location.pathname): string {
    const m = /\/app\/([^/]+)\//.exec(path);
    return m ? m[1] : 'search_orchestrator';
}

export const HEALTH_ALERTS = ['Engine not running', 'Missed schedules', 'Errors'];

export interface HealthPanelProps {
    health: Health | undefined;
    error?: Error;
}

export default function HealthPanel({ health, error }: HealthPanelProps) {
    return (
        <section aria-labelledby="settings-health">
            <Heading level={2} id="settings-health">
                Health
            </Heading>
            {error && (
                <Message type="error" appearance="default">
                    {`Health could not be loaded: ${error.message}`}
                </Message>
            )}
            {health &&
                health.messages.map((m) => (
                    <Message key={m} type="warning" appearance="default">
                        {m}
                    </Message>
                ))}
            {health && (
                <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
                    <HealthLine
                        testId="health-engine"
                        ok={health.engine_alive}
                        label="Engine"
                        value={
                            health.engine_alive
                                ? `Running${health.engine_heartbeat ? `, last seen ${formatTime(health.engine_heartbeat)}` : ''}`
                                : 'Not running'
                        }
                    />
                    <HealthLine
                        testId="health-index"
                        ok={health.index_present}
                        label="Audit index"
                        value={`${health.audit_index}: ${health.index_present ? 'Present' : 'Missing'}`}
                    />
                    <HealthLine
                        testId="health-fallback"
                        ok={health.fallback_set}
                        label="Fallback notification"
                        value={health.fallback_set ? 'Set' : 'Not set'}
                    />
                    <HealthLine
                        testId="health-commands"
                        ok
                        label="Commands waiting"
                        value={String(health.pending_commands)}
                    />
                </ul>
            )}
            <div data-testid="health-alerts" style={{ marginTop: '12px' }}>
                <p style={{ margin: '0 0 4px' }}>
                    {`App health alerts (off until an admin turns them on): ${HEALTH_ALERTS.join(', ')}. Once on, each adds a Triggered Alert when the app needs attention; edit one to add an email.`}
                </p>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <Link to={createURL(`/manager/${appId()}/saved/searches`, { app: appId(), search: 'Search Orchestrator -', count: '25' })} openInNewContext>
                        Turn the alerts on or off
                    </Link>
                    <Link to={createURL('/alerts', { app: appId() })} openInNewContext>
                        Triggered alerts
                    </Link>
                </div>
            </div>
        </section>
    );
}
