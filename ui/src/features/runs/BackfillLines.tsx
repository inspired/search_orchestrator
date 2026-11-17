/* Above the Runs table, when it is filtered by a job: one line per running backfill of that
 * job, with its progress and Cancel backfill (asked first in a Modal). */
import React, { useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import * as backfills from '../../api/backfills';
import type { Backfill, BackfillRun } from '../../api/backfills';
import usePoll from '../../hooks/usePoll';

const FINISHED = ['succeeded', 'failed', 'cancelled'];
const POLL_MS = 10000;

export interface BackfillLinesApi {
    listBackfills: typeof backfills.listBackfills;
    getBackfill: typeof backfills.getBackfill;
    cancelBackfill: typeof backfills.cancelBackfill;
}

const defaultApi: BackfillLinesApi = {
    listBackfills: backfills.listBackfills,
    getBackfill: backfills.getBackfill,
    cancelBackfill: backfills.cancelBackfill,
};

/** "Backfill of 30 runs: 12 finished, 1 running, 17 to go." Queued runs count as running. */
export function progressText(backfill: Backfill, runs: BackfillRun[]): string {
    const finished = runs.filter((r) => FINISHED.includes(r.state)).length;
    const running = runs.length - finished;
    const left = Math.max(0, backfill.count - finished - running);
    const noun = backfill.count === 1 ? 'run' : 'runs';
    return `Backfill of ${backfill.count} ${noun}: ${finished} finished, ${running} running, ${left} to go.`;
}

async function load(api: BackfillLinesApi, jobId: string) {
    const running = await api.listBackfills({ job_id: jobId, state: 'running' });
    return Promise.all(running.map((b) => api.getBackfill(b.id)));
}

export default function BackfillLines({ jobId, api = defaultApi }: { jobId: string; api?: BackfillLinesApi }) {
    const lines = usePoll(() => load(api, jobId), POLL_MS, true);
    const [cancelling, setCancelling] = useState<Backfill | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const opener = useRef<HTMLElement | null>(null);

    const cancel = async () => {
        if (!cancelling) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await api.cancelBackfill(cancelling.id);
            setCancelling(null);
            lines.refresh();
        } catch (err) {
            setError(`The backfill could not be cancelled: ${(err as Error).message}`);
        } finally {
            setBusy(false);
        }
    };

    const shown = lines.data || [];
    if (!shown.length && !error) {
        return null;
    }
    return (
        <div>
            {error && (
                <Message type="error" appearance="default">
                    {error}
                </Message>
            )}
            {shown.map(({ backfill, runs }) => (
                <div key={backfill.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '8px 0' }}>
                    <span>{progressText(backfill, runs)}</span>
                    <Button
                        appearance="secondary"
                        label="Cancel backfill"
                        onClick={(e: React.MouseEvent) => {
                            opener.current = e.currentTarget as HTMLElement;
                            setCancelling(backfill);
                        }}
                    />
                </div>
            ))}
            {cancelling && (
                <Modal
                    open
                    onRequestClose={() => setCancelling(null)}
                    returnFocus={() => opener.current && opener.current.isConnected && opener.current.focus()}
                    style={{ width: '440px' }}
                >
                    <Modal.Header title="Cancel this backfill?" />
                    <Modal.Body>
                        <p>Runs that already finished are kept.</p>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button appearance="secondary" label="Keep backfill" onClick={() => setCancelling(null)} />
                        <Button appearance="destructive" label="Cancel backfill" disabled={busy} onClick={cancel} />
                    </Modal.Footer>
                </Modal>
            )}
        </div>
    );
}
