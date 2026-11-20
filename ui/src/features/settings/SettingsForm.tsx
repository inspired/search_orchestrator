/* Limits, retention, the building blocks the builder offers, the fallback notification and the base URL. The input limits match the
 * server's (put_settings in bin/so/api.py); the server still checks, and its message shows. */
import React, { useEffect, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Message from '@splunk/react-ui/Message';
import NumberInput from '@splunk/react-ui/Number';
import RadioList from '@splunk/react-ui/RadioList';
import Select from '@splunk/react-ui/Select';
import Switch from '@splunk/react-ui/Switch';
import Text from '@splunk/react-ui/Text';
import type { Destination, Settings } from '../../api/types';
import BetaTag from '../builder/BetaTag';
import { ALWAYS_ON, CATALOG, isBeta } from '../builder/nodeCatalog';
import { STEP_KINDS } from '../builder/nodeModel';

/** The building blocks an admin can turn off, grouped as the builder shows them. */
export const BLOCK_GROUPS: Array<{ label: string; kinds: string[] }> = [
    { label: 'Triggers', kinds: CATALOG.filter((e) => e.kind.startsWith('trigger_')).map((e) => e.kind) },
    { label: 'Steps', kinds: CATALOG.filter((e) => (STEP_KINDS as string[]).includes(e.kind)).map((e) => e.kind) },
    { label: 'Actions', kinds: CATALOG.filter((e) => !e.kind.startsWith('trigger_') && !(STEP_KINDS as string[]).includes(e.kind)).map((e) => e.kind) },
];

const HOUR = 3600;

interface IntField {
    key: 'max_searches' | 'max_searches_per_job' | 'queue_cap' | 'run_retention_days' | 'result_retention';
    label: string;
    max: number;
    unit: string;
    /** Seconds per displayed unit (result_retention is stored in seconds, shown in hours). */
    scale: number;
    help: string;
}

export const INT_FIELDS: IntField[] = [
    {
        key: 'max_searches',
        label: 'Searches at once',
        max: 100,
        unit: '',
        scale: 1,
        help: 'The most orchestrator searches running at the same time, across all jobs.',
    },
    {
        key: 'max_searches_per_job',
        label: 'Searches at once per job',
        max: 50,
        unit: '',
        scale: 1,
        help: 'The most searches one run may have running at the same time.',
    },
    {
        key: 'queue_cap',
        label: 'Queue cap per job',
        max: 1000,
        unit: '',
        scale: 1,
        help: 'The most runs a job may have queued. A new run past this is rejected and reported.',
    },
    {
        key: 'result_retention',
        label: 'Keep step results after a run',
        max: 168,
        unit: 'hours',
        scale: HOUR,
        help: 'How long step results stay available for a re-run after the run ends.',
    },
    {
        key: 'run_retention_days',
        label: 'Keep run records',
        max: 3650,
        unit: 'days',
        scale: 1,
        help: 'Run records older than this are removed. Audit events stay in the index.',
    },
];

type FallbackType = 'none' | 'email' | 'webhook';

export interface Draft {
    ints: Record<string, string>;
    fallbackType: FallbackType;
    email: string;
    destination: string;
    /** A webhook fallback's body preset; the page doesn't edit it, but keeps it. */
    preset: string;
    baseUrl: string;
    logLevel: LogLevel;
    /** Events scanned limit, as typed; empty is no limit. */
    scanLimit: string;
    scanAction: 'warn' | 'stop';
    /** Building blocks turned off, sorted. */
    turnedOff: string[];
}

export type LogLevel = 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG';
export const LOG_LEVELS: { value: LogLevel; label: string }[] = [
    { value: 'ERROR', label: 'Errors only' },
    { value: 'WARNING', label: 'Warnings and errors' },
    { value: 'INFO', label: 'Info (default): every change, request and warning' },
    { value: 'DEBUG', label: 'Debug: also each tick, search status and Splunk call' },
];

function toDraft(s: Settings): Draft {
    const ints: Record<string, string> = {};
    INT_FIELDS.forEach((f) => {
        const v = Number(s[f.key]);
        ints[f.key] = String(f.scale === 1 ? v : Math.ceil(v / f.scale));
    });
    const fb = s.fallback;
    return {
        ints,
        fallbackType: fb ? fb.type : 'none',
        email: fb && fb.type === 'email' ? fb.to : '',
        destination: fb && fb.type === 'webhook' ? fb.destination : '',
        preset: (fb && fb.type === 'webhook' && fb.preset) || '',
        baseUrl: s.base_url || '',
        logLevel: ((s.log_level as string) || 'INFO').toUpperCase() as LogLevel,
        scanLimit: typeof s.scan_limit === 'number' && s.scan_limit > 0 ? String(s.scan_limit) : '',
        scanAction: s.scan_limit_action === 'stop' ? 'stop' : 'warn',
        turnedOff: [...((s.turned_off as string[]) || [])].sort(),
    };
}

function intError(f: IntField, text: string): string | null {
    if (!/^\d+$/.test(text.trim())) {
        return 'Enter a whole number.';
    }
    const n = parseInt(text, 10);
    return n < 1 || n > f.max ? `Must be from 1 to ${f.max}.` : null;
}

function rangeHelp(f: IntField): string {
    return `${f.help} From 1 to ${f.max}${f.unit ? ` ${f.unit}` : ''}.`;
}

function fallbackOf(d: Draft): Settings['fallback'] {
    if (d.fallbackType === 'email') {
        return { type: 'email', to: d.email.trim() };
    }
    if (d.fallbackType === 'webhook') {
        return d.preset
            ? { type: 'webhook', destination: d.destination, preset: d.preset }
            : { type: 'webhook', destination: d.destination };
    }
    return null;
}

/** Only what changed, so an unchanged rounded value is never written back. */
export function changes(original: Settings, d: Draft): Partial<Settings> {
    const base = toDraft(original);
    const out: Record<string, unknown> = {};
    INT_FIELDS.forEach((f) => {
        if (d.ints[f.key].trim() !== base.ints[f.key]) {
            out[f.key] = parseInt(d.ints[f.key], 10) * f.scale;
        }
    });
    const fb = fallbackOf(d);
    if (JSON.stringify(fb) !== JSON.stringify(fallbackOf(base))) {
        out.fallback = fb;
    }
    if (d.baseUrl.trim() !== base.baseUrl) {
        out.base_url = d.baseUrl.trim() || null;
    }
    if (d.logLevel !== base.logLevel) {
        out.log_level = d.logLevel;
    }
    if (d.scanLimit.replace(/[\s,]/g, '') !== base.scanLimit) {
        const n = d.scanLimit.replace(/[\s,]/g, '');
        out.scan_limit = n ? parseInt(n, 10) : null;
    }
    if (d.scanAction !== base.scanAction) {
        out.scan_limit_action = d.scanAction;
    }
    if ([...(d.turnedOff || [])].sort().join() !== base.turnedOff.join()) {
        out.turned_off = [...d.turnedOff].sort();
    }
    return out as Partial<Settings>;
}

export interface SettingsFormProps {
    settings: Settings;
    destinations: Destination[];
    onSave: (changes: Partial<Settings>) => Promise<unknown>;
}

export default function SettingsForm({ settings, destinations, onSave }: SettingsFormProps) {
    const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => setDraft(toDraft(settings)), [settings]);

    const setInt = (key: string, value: string) => {
        setSaved(false);
        setDraft((d) => ({ ...d, ints: { ...d.ints, [key]: value } }));
    };
    const set = (patch: Partial<Draft>) => {
        setSaved(false);
        setDraft((d) => ({ ...d, ...patch }));
    };

    const errors: Record<string, string | null> = {};
    INT_FIELDS.forEach((f) => {
        errors[f.key] = intError(f, draft.ints[f.key]);
    });
    const emailError =
        draft.fallbackType === 'email' && !draft.email.includes('@') ? 'Enter an email address.' : null;
    const destError =
        draft.fallbackType === 'webhook' && !draft.destination ? 'Choose a webhook destination.' : null;
    const scanText = draft.scanLimit.replace(/[\s,]/g, '');
    const scanError = scanText && (!/^\d+$/.test(scanText) || parseInt(scanText, 10) < 1) ? 'Enter a whole number of events, or leave it empty for no limit.' : null;
    const invalid = Object.values(errors).some(Boolean) || Boolean(emailError) || Boolean(destError) || Boolean(scanError);
    const pending = invalid ? {} : changes(settings, draft);
    const dirty = Object.keys(pending).length > 0;

    const save = async () => {
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
            await onSave(pending);
            setSaved(true);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section aria-labelledby="settings-general" style={{ maxWidth: '720px' }}>
            <Heading level={2} id="settings-general">
                Limits and retention
            </Heading>
            {INT_FIELDS.map((f) => {
                const id = `settings-${f.key}`;
                return (
                    <ControlGroup
                        key={f.key}
                        label={f.label}
                        labelFor={id}
                        labelPosition="top"
                        help={errors[f.key] || rangeHelp(f)}
                        error={Boolean(errors[f.key])}
                    >
                        <NumberInput
                            inputId={id}
                            min={1}
                            max={f.max}
                            step={1}
                            roundTo={0}
                            value={draft.ints[f.key] === '' ? undefined : Number(draft.ints[f.key])}
                            error={Boolean(errors[f.key])}
                            onChange={(_e: unknown, { value }: { value?: number }) =>
                                setInt(f.key, value === undefined || Number.isNaN(value) ? '' : String(value))
                            }
                        />
                    </ControlGroup>
                );
            })}

            <Heading level={2}>Logs</Heading>
            <ControlGroup
                label="Log level"
                labelFor="settings-log-level"
                labelPosition="top"
                help="What the app writes to its log files (search_orchestrator.<process>.log in _internal). Applies within 30 seconds, no restart. See Troubleshooting."
            >
                <Select
                    inputId="settings-log-level"
                    value={draft.logLevel}
                    onChange={(_e: unknown, { value }: { value: unknown }) => set({ logLevel: value as LogLevel })}
                >
                    {LOG_LEVELS.map((l) => (
                        <Select.Option key={l.value} value={l.value} label={l.label} />
                    ))}
                </Select>
            </ControlGroup>

            <Heading level={2}>Search cost</Heading>
            <ControlGroup
                label="Events scanned limit"
                labelFor="settings-scan-limit"
                labelPosition="top"
                help={scanError || 'For every step that sets none of its own: how many events a step\'s search may scan. Empty: no limit. A step can set its own in its panel.'}
                error={Boolean(scanError)}
            >
                <Text inputId="settings-scan-limit" value={draft.scanLimit} placeholder="No limit" onChange={(_e: unknown, { value }: { value: string }) => set({ scanLimit: value })} />
            </ControlGroup>
            <ControlGroup label="When a step goes over" labelFor="settings-scan-action" labelPosition="top">
                <Select inputId="settings-scan-action" value={draft.scanAction} onChange={(_e: unknown, { value }: { value: unknown }) => set({ scanAction: value as 'warn' | 'stop' })}>
                    <Select.Option value="warn" label="Warn: log it, show it on the run and in Troubleshooting, and let the search finish" />
                    <Select.Option value="stop" label="Stop the search: the step fails (and retries, if it has retries)" />
                </Select>
            </ControlGroup>

            <Heading level={2}>Building blocks</Heading>
            <p data-testid="blocks-intro">
                What people can add to a job. Turn off what your teams don&apos;t use to keep the builder simple: it is no longer offered in the Flow and Simple
                editors or the examples, and a save that adds it is refused. Jobs that already use it keep working and can still be edited. Search and Schedule
                are always on. Blocks marked <strong>Beta</strong> are still in development and may not work yet.
            </p>
            {BLOCK_GROUPS.map((g) => (
                <div key={g.label} role="group" aria-label={g.label} style={{ margin: '0 0 12px' }}>
                    <div style={{ fontWeight: 600, margin: '0 0 4px' }}>{g.label}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '2px 16px' }}>
                        {g.kinds
                            .filter((k) => !(ALWAYS_ON as string[]).includes(k))
                            .map((k) => {
                                const entry = CATALOG.find((e) => e.kind === k);
                                const on = !draft.turnedOff.includes(k);
                                return (
                                    <Switch
                                        key={k}
                                        value={k}
                                        appearance="checkbox"
                                        selected={on}
                                        data-testid={`block-${k}`}
                                        title={entry ? entry.description : undefined}
                                        onClick={() => set({ turnedOff: on ? [...draft.turnedOff, k] : draft.turnedOff.filter((x) => x !== k) })}
                                    >
                                        {entry ? entry.label : k}
                                        {isBeta(k) && <BetaTag />}
                                    </Switch>
                                );
                            })}
                    </div>
                </div>
            ))}

            <Heading level={2}>Fallback notification</Heading>
            <p>
                Sent when a job has no failure or delay action, or when that action keeps failing. It carries only job,
                run and step names, status and links.
            </p>
            <RadioList
                value={draft.fallbackType}
                onChange={(_e: unknown, { value }: { value: unknown }) => set({ fallbackType: value as FallbackType })}
            >
                <RadioList.Option value="none">None</RadioList.Option>
                <RadioList.Option value="email">Email</RadioList.Option>
                <RadioList.Option value="webhook" disabled={destinations.length === 0}>
                    Webhook destination
                </RadioList.Option>
            </RadioList>
            {draft.fallbackType === 'email' && (
                <ControlGroup
                    label="Email address"
                    labelFor="settings-fallback-email"
                    labelPosition="top"
                    help={emailError || undefined}
                    error={Boolean(emailError)}
                >
                    <Text
                        inputId="settings-fallback-email"
                        value={draft.email}
                        error={Boolean(emailError)}
                        onChange={(_e: unknown, { value }: { value: string }) => set({ email: value })}
                    />
                </ControlGroup>
            )}
            {draft.fallbackType === 'webhook' && (
                <ControlGroup
                    label="Destination"
                    labelFor="settings-fallback-dest"
                    labelPosition="top"
                    help={destError || undefined}
                    error={Boolean(destError)}
                >
                    <Select
                        inputId="settings-fallback-dest"
                        value={draft.destination}
                        onChange={(_e: unknown, { value }: { value: unknown }) => set({ destination: String(value) })}
                    >
                        {destinations.map((d) => (
                            <Select.Option key={d.name} label={d.name} value={d.name} />
                        ))}
                    </Select>
                </ControlGroup>
            )}

            <Heading level={2}>Links</Heading>
            <ControlGroup
                label="Splunk Web address"
                labelFor="settings-base-url"
                labelPosition="top"
                help="Makes links in notifications absolute, for example https://splunk.example.com:8000. Empty means relative links."
            >
                <Text
                    inputId="settings-base-url"
                    value={draft.baseUrl}
                    onChange={(_e: unknown, { value }: { value: string }) => set({ baseUrl: value })}
                />
            </ControlGroup>

            {error && (
                <Message type="error" appearance="default">
                    {error}
                </Message>
            )}
            {saved && (
                <Message type="success" appearance="default">
                    Settings saved.
                </Message>
            )}
            <Button
                appearance="primary"
                label={busy ? 'Saving…' : 'Save settings'}
                aria-label="Save settings"
                disabled={busy || invalid || !dirty}
                onClick={save}
            />
        </section>
    );
}
