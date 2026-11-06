/* Confirms deleting a job. A job with active or queued runs can't be deleted (409
 * job_has_active_runs); the dialog says so and stays open. */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import { ApiError } from '../../api/client';
import type { Job } from '../../api/types';

export interface DeleteJobDialogProps {
    job: Job;
    deleteJob: (jobId: string) => Promise<unknown>;
    onDeleted: () => void;
    onClose: () => void;
    returnFocus: React.ComponentProps<typeof Modal>['returnFocus'];
}

export default function DeleteJobDialog({ job, deleteJob, onDeleted, onClose, returnFocus }: DeleteJobDialogProps) {
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const confirm = async () => {
        setBusy(true);
        setError(null);
        try {
            await deleteJob(job.id);
            onDeleted();
        } catch (err) {
            if (err instanceof ApiError && err.code === 'job_has_active_runs') {
                setError(`${job.name} has active or queued runs. Cancel them on the Runs page, then delete it.`);
            } else {
                setError(`${job.name} could not be deleted: ${(err as Error).message}`);
            }
            setBusy(false);
        }
    };

    return (
        <Modal open onRequestClose={onClose} returnFocus={returnFocus} style={{ width: '480px' }}>
            <Modal.Header title={`Delete ${job.name}?`} />
            <Modal.Body>
                <p>
                    {`This deletes the job ${job.name} (${job.id}) and its hidden saved searches. Past runs stay in the run list until they are pruned. This can't be undone.`}
                </p>
                {error && (
                    <Message type="error" appearance="default">
                        {error}
                    </Message>
                )}
            </Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Cancel" onClick={onClose} />
                <Button appearance="destructive" label="Delete job" disabled={busy} onClick={confirm} />
            </Modal.Footer>
        </Modal>
    );
}
