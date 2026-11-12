/* Webhook destinations. The URL and headers are secrets kept in Splunk's credential store:
 * they are write-only here. The page shows whether each is set and offers a field to
 * replace it, never the stored value. */
import React, { useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import Select from '@splunk/react-ui/Select';
import Table from '@splunk/react-ui/Table';
import Text from '@splunk/react-ui/Text';
import TextArea from '@splunk/react-ui/TextArea';
import CheckCircle from '@splunk/react-icons/CheckCircle';
import MinusCircle from '@splunk/react-icons/MinusCircle';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Destination, DestinationInput } from '../../api/types';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

function SetText({ set, testId }: { set: boolean; testId: string }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const IconFor = set ? CheckCircle : MinusCircle;
    return (
        <span
            data-testid={testId}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em', color: set ? undefined : theme.contentColorMuted }}
        >
            <IconFor aria-hidden />
            <span>{set ? 'Set' : 'Not set'}</span>
        </span>
    );
}

/** `Name: value` lines to a headers object. Throws on a malformed line. */
export function parseHeaders(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    text.split('\n').forEach((line) => {
        if (!line.trim()) {
            return;
        }
        const at = line.indexOf(':');
        if (at <= 0 || !line.slice(0, at).trim()) {
            throw new Error('Each header line must look like "Name: value".');
        }
        out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    });
    return out;
}

interface EditorProps {
    /** The destination being replaced, or null for a new one. */
    existing: Destination | null;
    taken: string[];
    onSave: (dest: DestinationInput) => Promise<unknown>;
    onClose: () => void;
    returnFocus: () => void;
}

function DestinationEditor({ existing, taken, onSave, onClose, returnFocus }: EditorProps) {
    const [name, setName] = useState(existing ? existing.name : '');
    const [preset, setPreset] = useState<'slack' | 'generic'>(existing ? existing.preset : 'generic');
    const [url, setUrl] = useState('');
    const [headers, setHeaders] = useState('');
    const [clearHeaders, setClearHeaders] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    let nameError: string | null = null;
    if (!existing) {
        if (name && !NAME_RE.test(name)) {
            nameError = 'Use 1 to 64 letters, digits, _, . or -.';
        } else if (taken.includes(name)) {
            nameError = 'A destination with this name exists. Use Replace on it instead.';
        }
    }
    const urlError = url && !url.trim().toLowerCase().startsWith('https://') ? 'The URL must start with https://.' : null;
    const canSave = Boolean(name) && !nameError && Boolean(url.trim()) && !urlError && !busy;

    const save = async () => {
        setError(null);
        const body: DestinationInput = { name, url: url.trim(), preset };
        try {
            if (clearHeaders) {
                body.headers = null;
            } else if (headers.trim()) {
                body.headers = parseHeaders(headers);
            }
        } catch (err) {
            setError((err as Error).message);
            return;
        }
        setBusy(true);
        try {
            await onSave(body);
            onClose();
        } catch (err) {
            setError((err as Error).message);
            setBusy(false);
        }
    };

    return (
        <Modal open onRequestClose={onClose} returnFocus={returnFocus} style={{ width: '560px' }}>
            <Modal.Header title={existing ? `Replace ${existing.name}` : 'New webhook destination'} />
            <Modal.Body>
                <p>
                    The URL and headers are stored in Splunk&apos;s credential store and are never shown again. Enter
                    the URL each time you save.
                </p>
                {!existing && (
                    <ControlGroup
                        label="Name"
                        labelFor="dest-name"
                        labelPosition="top"
                        help={nameError || 'Job builders pick destinations by this name.'}
                        error={Boolean(nameError)}
                    >
                        <Text
                            inputId="dest-name"
                            value={name}
                            error={Boolean(nameError)}
                            onChange={(_e: unknown, { value }: { value: string }) => setName(value)}
                        />
                    </ControlGroup>
                )}
                <ControlGroup label="Body format" labelFor="dest-preset" labelPosition="top">
                    <Select
                        inputId="dest-preset"
                        value={preset}
                        onChange={(_e: unknown, { value }: { value: unknown }) => setPreset(value as 'slack' | 'generic')}
                    >
                        <Select.Option label="Generic JSON" value="generic" />
                        <Select.Option label="Slack" value="slack" />
                    </Select>
                </ControlGroup>
                <ControlGroup
                    label="New URL"
                    labelFor="dest-url"
                    labelPosition="top"
                    help={urlError || (existing ? 'Required to save. Replaces the stored URL.' : 'An https:// address.')}
                    error={Boolean(urlError)}
                >
                    <Text
                        inputId="dest-url"
                        type="password"
                        autoComplete="off"
                        value={url}
                        error={Boolean(urlError)}
                        onChange={(_e: unknown, { value }: { value: string }) => setUrl(value)}
                    />
                </ControlGroup>
                <ControlGroup
                    label="New headers (optional)"
                    labelFor="dest-headers"
                    labelPosition="top"
                    help={
                        existing && existing.has_headers
                            ? 'One "Name: value" per line. Empty keeps the stored headers.'
                            : 'One "Name: value" per line, for example an Authorization header.'
                    }
                >
                    <TextArea
                        inputId="dest-headers"
                        value={headers}
                        disabled={clearHeaders}
                        onChange={(_e: unknown, { value }: { value: string }) => setHeaders(value)}
                    />
                </ControlGroup>
                {existing && existing.has_headers && (
                    <Button
                        appearance="secondary"
                        label={clearHeaders ? 'Keep stored headers' : 'Remove stored headers'}
                        onClick={() => setClearHeaders((c) => !c)}
                    />
                )}
                {error && (
                    <Message type="error" appearance="default">
                        {error}
                    </Message>
                )}
            </Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Cancel" onClick={onClose} />
                <Button appearance="primary" label="Save destination" disabled={!canSave} onClick={save} />
            </Modal.Footer>
        </Modal>
    );
}

export interface DestinationsProps {
    destinations: Destination[];
    /** The fallback destination's name, which can't be deleted. */
    fallbackName?: string | null;
    onSave: (dest: DestinationInput) => Promise<unknown>;
    onDelete: (name: string) => Promise<unknown>;
}

export default function Destinations({ destinations, fallbackName, onSave, onDelete }: DestinationsProps) {
    const [editing, setEditing] = useState<Destination | 'new' | null>(null);
    const [confirm, setConfirm] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    // The button that opened a dialog gets focus back when it closes, if it still exists.
    const opener = useRef<HTMLElement | null>(null);
    const returnFocus = () => {
        if (opener.current && opener.current.isConnected) {
            opener.current.focus();
        }
    };
    const open = (e: React.MouseEvent, then: () => void) => {
        opener.current = e.currentTarget as HTMLElement;
        then();
    };

    const remove = async (name: string) => {
        setConfirm(null);
        setError(null);
        try {
            await onDelete(name);
        } catch (err) {
            setError((err as Error).message);
        }
    };

    return (
        <section aria-labelledby="settings-destinations">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Heading level={2} id="settings-destinations">
                    Webhook destinations
                </Heading>
                <Button appearance="secondary" label="New destination" onClick={(e: React.MouseEvent) => open(e, () => setEditing('new'))} />
            </div>
            <p>
                Job builders pick a destination by name; they never see its URL. Calls always verify TLS. Splunk Cloud
                may block outbound calls until an admin allows the host.
            </p>
            {error && (
                <Message type="error" appearance="default">
                    {error}
                </Message>
            )}
            {destinations.length === 0 ? (
                <p>No destinations yet.</p>
            ) : (
                <Table>
                    <Table.Head>
                        <Table.HeadCell>Name</Table.HeadCell>
                        <Table.HeadCell>Format</Table.HeadCell>
                        <Table.HeadCell>Host</Table.HeadCell>
                        <Table.HeadCell>URL</Table.HeadCell>
                        <Table.HeadCell>Headers</Table.HeadCell>
                        <Table.HeadCell>Actions</Table.HeadCell>
                    </Table.Head>
                    <Table.Body>
                        {destinations.map((d) => (
                            <Table.Row key={d.name}>
                                <Table.Cell>{d.name}</Table.Cell>
                                <Table.Cell>{d.preset === 'slack' ? 'Slack' : 'Generic JSON'}</Table.Cell>
                                <Table.Cell>{d.host || ''}</Table.Cell>
                                <Table.Cell>
                                    <SetText set testId="dest-url" />
                                </Table.Cell>
                                <Table.Cell>
                                    <SetText set={d.has_headers} testId="dest-headers" />
                                </Table.Cell>
                                <Table.Cell>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <Button
                                            appearance="secondary"
                                            label="Replace"
                                            aria-label={`Replace ${d.name}`}
                                            onClick={(e: React.MouseEvent) => open(e, () => setEditing(d))}
                                        />
                                        <Button
                                            appearance="secondary"
                                            label="Delete"
                                            aria-label={`Delete ${d.name}`}
                                            disabled={d.name === fallbackName}
                                            title={d.name === fallbackName ? 'Used as the fallback notification' : undefined}
                                            onClick={(e: React.MouseEvent) => open(e, () => setConfirm(d.name))}
                                        />
                                    </div>
                                </Table.Cell>
                            </Table.Row>
                        ))}
                    </Table.Body>
                </Table>
            )}
            {editing && (
                <DestinationEditor
                    existing={editing === 'new' ? null : editing}
                    taken={destinations.map((d) => d.name)}
                    onSave={onSave}
                    onClose={() => setEditing(null)}
                    returnFocus={returnFocus}
                />
            )}
            {confirm && (
                <Modal open onRequestClose={() => setConfirm(null)} returnFocus={returnFocus} style={{ width: '480px' }}>
                    <Modal.Header title={`Delete ${confirm}?`} />
                    <Modal.Body>
                        <p>
                            Its stored URL and headers are deleted too. Jobs that use it will fail validation when next
                            saved, and their webhook actions will fail.
                        </p>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button appearance="secondary" label="Cancel" onClick={() => setConfirm(null)} />
                        <Button appearance="destructive" label="Delete" onClick={() => remove(confirm)} />
                    </Modal.Footer>
                </Modal>
            )}
        </section>
    );
}
