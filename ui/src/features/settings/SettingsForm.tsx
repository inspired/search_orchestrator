/* Limits, retention, the fallback notification and the base URL. The input limits match the
 * server's (put_settings in bin/so/api.py); the server still checks, and its message shows. */
import React, { useEffect, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Message from '@splunk/react-ui/Message';
import NumberInput from '@splunk/react-ui/Number';
import RadioList from '@splunk/react-ui/RadioList';
import Select from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';
import type { Destination, Settings } from '../../api/types';

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
        label: 'Concurrent searches',
        max: 100,
        unit: '',
        scale: 1,
        help: 'The most orchestrator searches running at the same time, across all jobs.',
    },
    {
        key: 'max_searches_per_job',
        label: 'Concurrent searches per job',
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
}

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
    const invalid = Object.values(errors).some(Boolean) || Boolean(emailError) || Boolean(destError);
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
