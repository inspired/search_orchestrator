/* The History tab: every saved version of the job, newest first, with Compare and Restore.
 * Restoring saves the old version as a new one, so nothing is lost. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import Switch from '@splunk/react-ui/Switch';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import type { SaveResponse } from '../../api/types';
import * as versionsApi from '../../api/versions';
import type { VersionChange, VersionInfo } from '../../api/versions';
import VersionDiff from './VersionDiff';

export interface HistoryProps {
    jobId: string | null;
    dirty: boolean;
    canEdit: boolean;
    onRestored: (r: SaveResponse, version: number) => void;
}

interface Shown {
    title: string;
    changes: VersionChange[];
}

export default function HistoryTab({ jobId, dirty, canEdit, onRestored }: HistoryProps) {
    const [versions, setVersions] = useState<VersionInfo[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [picked, setPicked] = useState<number[]>([]);
    const [shown, setShown] = useState<Shown | null>(null);
    const [restoring, setRestoring] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const returnFocus = useRef<HTMLElement | null>(null);

    const load = useCallback(async () => {
        if (!jobId) {
            return;
        }
        try {
            setVersions(await versionsApi.listVersions(jobId));
            setError(null);
        } catch (err) {
            setError(`The history could not be loaded: ${(err as Error).message} Reload the page to try again.`);
        }
    }, [jobId]);
    useEffect(() => {
        load();
    }, [load]);

    if (!jobId) {
        return <p>Save the job to start its history.</p>;
    }

    const compare = async (a: number, b: number | 'current') => {
        try {
            setShown({ title: `Version ${a} compared with ${b === 'current' ? 'the current job' : `version ${b}`}`, changes: await versionsApi.compareVersions(jobId, a, b) });
            setError(null);
        } catch (err) {
            setError(`The versions could not be compared: ${(err as Error).message}`);
        }
    };
    const toggle = (n: number) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
    const restore = async () => {
        if (restoring === null) {
            return;
        }
        setBusy(true);
        try {
            const res = await versionsApi.restoreVersion(jobId, restoring);
            setRestoring(null);
            setShown(null);
            setPicked([]);
            onRestored(res, restoring);
            await load();
        } catch (err) {
            setRestoring(null);
            setError(`Version ${restoring} was not restored: ${(err as Error).message}`);
        } finally {
            setBusy(false);
        }
    };

    const two = picked.length === 2;
    return (
        <div style={{ maxWidth: '760px' }}>
            {error && <Message type="error" appearance="default">{error}</Message>}
            {versions === null && !error && <WaitSpinner size="medium" />}
            {versions && !versions.length && <p>No versions yet. Each save adds one.</p>}
            {versions && versions.length > 0 && (
                <Button
                    appearance="secondary"
                    label="Compare selected"
                    disabled={!two}
                    onClick={() => {
                        const [a, b] = [...picked].sort((x, y) => x - y);
                        compare(a, b);
                    }}
                />
            )}
            <ul style={{ listStyle: 'none', padding: 0 }}>
                {(versions || []).map((v, i) => (
                    <li key={v.version} style={{ padding: '8px 0' }}>
                        <Switch
                            appearance="checkbox"
                            selected={picked.includes(v.version)}
                            onClick={() => toggle(v.version)}
                            aria-label={`Select version ${v.version}`}
                        >
                            <strong>{`Version ${v.version}`}</strong>
                        </Switch>
                        <div>{`Saved by ${v.saved_by} on ${new Date(v.saved_at * 1000).toLocaleString()}`}</div>
                        {v.restored_from ? <div>{`Restored from version ${v.restored_from}`}</div> : null}
                        {(v.summary || []).map((line) => (
                            <div key={line}>{line}</div>
                        ))}
                        <Button appearance="subtle" label="Compare with current" aria-label={`Compare version ${v.version} with current`} onClick={() => compare(v.version, 'current')} />
                        {canEdit && i > 0 && (
                            <Button appearance="subtle" label="Restore" aria-label={`Restore version ${v.version}`} onClick={() => (returnFocus.current = document.activeElement as HTMLElement | null, setRestoring(v.version))} />
                        )}
                    </li>
                ))}
            </ul>
            {shown && (
                <div>
                    <strong>{shown.title}</strong>
                    <VersionDiff changes={shown.changes} />
                </div>
            )}
            {restoring !== null && (
                <Modal open onRequestClose={() => setRestoring(null)} returnFocus={returnFocus} style={{ width: '520px' }}>
                    <Modal.Header title={`Restore version ${restoring}?`} />
                    <Modal.Body>
                        <p>{`This saves version ${restoring} as a new version. Nothing is deleted.`}</p>
                        {dirty && <Message type="warning" appearance="default">Your unsaved changes will be lost.</Message>}
                    </Modal.Body>
                    <Modal.Footer>
                        <Button appearance="secondary" label="Cancel" onClick={() => setRestoring(null)} />
                        <Button appearance="primary" label="Restore version" disabled={busy} onClick={restore} />
                    </Modal.Footer>
                </Modal>
            )}
        </div>
    );
}
