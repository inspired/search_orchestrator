/* Jobs: every job the user may see, with Run now, enable/disable and New job. */
import React, { useEffect, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import { listJobs, me as fetchMe, toDefinition, updateJob } from '../../api/client';
import type { Job, Me } from '../../api/types';
import PageShell, { pageHref, renderPage } from '../../components/PageShell';
import JobsTable from '../../features/jobs/JobsTable';
import RunNowDialog from '../../features/jobs/RunNowDialog';
import usePoll from '../../hooks/usePoll';

const ACTIVE = ['queued', 'running', 'paused', 'blocked'];

function JobsPage() {
    const [me, setMe] = useState<Me | null>(null);
    // Poll every 5 seconds while a run is active, and every 30 seconds otherwise.
    const [fast, setFast] = useState(true);
    const jobs = usePoll(listJobs, fast ? 5000 : 30000, true);
    const [runNow, setRunNow] = useState<Job | null>(null);
    const [confirm, setConfirm] = useState<{ job: Job; enabled: boolean } | null>(null);
    const [busy, setBusy] = useState<Record<string, boolean>>({});
    const [error, setError] = useState<string | null>(null);
    const returnFocus = useRef<HTMLElement | null>(null);

    useEffect(() => {
        fetchMe()
            .then(setMe)
            .catch(() => setMe(null));
    }, []);

    const anyActive = (jobs.data || []).some((j) => j.last_run && ACTIVE.includes(j.last_run.state));
    useEffect(() => setFast(anyActive), [anyActive]);

    const save = async (job: Job, enabled: boolean) => {
        setConfirm(null);
        setError(null);
        setBusy((b) => ({ ...b, [job.id]: true }));
        try {
            await updateJob(job.id, { ...toDefinition(job), enabled });
            jobs.refresh();
        } catch (err) {
            setError(`${job.name} could not be ${enabled ? 'enabled' : 'disabled'}: ${(err as Error).message}`);
        } finally {
            setBusy((b) => {
                const next = { ...b };
                delete next[job.id];
                return next;
            });
        }
    };

    const onToggle = (job: Job, enabled: boolean) => {
        if (me && job.owner !== me.user) {
            setConfirm({ job, enabled });
        } else {
            save(job, enabled);
        }
    };

    const actions =
        me && me.can_build ? (
            <Button appearance="primary" label="New job" to={pageHref('builder')} />
        ) : undefined;

    return (
        <PageShell title="Jobs" actions={actions}>
            {error && (
                <Message type="error" appearance="default">
                    {error}
                </Message>
            )}
            {jobs.error && (
                <Message type="error" appearance="default">
                    {`The jobs could not be loaded: ${jobs.error.message}`}
                </Message>
            )}
            {jobs.loading && !jobs.data ? (
                <WaitSpinner size="medium" />
            ) : (
                <JobsTable
                    jobs={jobs.data || []}
                    me={me}
                    busy={busy}
                    onRunNow={(job) => setRunNow(job)}
                    onToggleEnabled={onToggle}
                />
            )}
            {runNow && (
                <RunNowDialog
                    job={runNow}
                    open
                    returnFocus={returnFocus}
                    onClose={() => setRunNow(null)}
                    onStarted={(runId) => {
                        window.location.href = pageHref('run', { run_id: runId });
                    }}
                />
            )}
            {confirm && (
                <Modal open onRequestClose={() => setConfirm(null)} returnFocus={returnFocus} style={{ width: '480px' }}>
                    <Modal.Header title={`${confirm.enabled ? 'Enable' : 'Disable'} ${confirm.job.name}?`} />
                    <Modal.Body>
                        <p>
                            {`This job belongs to ${confirm.job.owner}. Saving it makes you the owner, and its searches will run as you from now on.`}
                        </p>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button appearance="secondary" label="Cancel" onClick={() => setConfirm(null)} />
                        <Button
                            appearance="primary"
                            label={`${confirm.enabled ? 'Enable' : 'Disable'} and take ownership`}
                            onClick={() => save(confirm.job, confirm.enabled)}
                        />
                    </Modal.Footer>
                </Modal>
            )}
        </PageShell>
    );
}

renderPage(<JobsPage />, 'Jobs');
