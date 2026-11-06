/* Jobs: every job the user may see, with Run now, enable/disable, Delete and New job. */
import React, { useEffect, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Message from '@splunk/react-ui/Message';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import * as client from '../../api/client';
import type { Job, Me } from '../../api/types';
import PageShell, { pageHref } from '../../components/PageShell';
import DeleteJobDialog from './DeleteJobDialog';
import JobsTable from './JobsTable';
import RunNowDialog from './RunNowDialog';
import usePoll from '../../hooks/usePoll';

const ACTIVE = ['queued', 'running', 'paused', 'blocked'];

export interface JobsApi {
    me: typeof client.me;
    listJobs: typeof client.listJobs;
    setJobEnabled: typeof client.setJobEnabled;
    deleteJob: typeof client.deleteJob;
}

const defaultApi: JobsApi = {
    me: client.me,
    listJobs: client.listJobs,
    setJobEnabled: client.setJobEnabled,
    deleteJob: client.deleteJob,
};

export default function JobsPage({ api = defaultApi }: { api?: JobsApi }) {
    const [me, setMe] = useState<Me | null>(null);
    // Poll every 5 seconds while a run is active, and every 30 seconds otherwise.
    const [fast, setFast] = useState(true);
    const jobs = usePoll(api.listJobs, fast ? 5000 : 30000, true);
    const [runNow, setRunNow] = useState<Job | null>(null);
    const [deleting, setDeleting] = useState<Job | null>(null);
    const deleteOpener = useRef<HTMLElement | null>(null);
    const [busy, setBusy] = useState<Record<string, boolean>>({});
    const [error, setError] = useState<string | null>(null);
    const returnFocus = useRef<HTMLElement | null>(null);

    useEffect(() => {
        api.me()
            .then(setMe)
            .catch(() => setMe(null));
    }, [api]);

    const anyActive = (jobs.data || []).some((j) => j.last_run && ACTIVE.includes(j.last_run.state));
    useEffect(() => setFast(anyActive), [anyActive]);

    // Enabling or disabling keeps the job's owner, so no ownership warning is needed.
    const onToggle = async (job: Job, enabled: boolean) => {
        setError(null);
        setBusy((b) => ({ ...b, [job.id]: true }));
        try {
            await api.setJobEnabled(job.id, enabled);
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
                    onDelete={(job, opener) => {
                        deleteOpener.current = opener;
                        setDeleting(job);
                    }}
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
            {deleting && (
                <DeleteJobDialog
                    job={deleting}
                    deleteJob={api.deleteJob}
                    onClose={() => setDeleting(null)}
                    onDeleted={() => {
                        setDeleting(null);
                        jobs.refresh();
                    }}
                    returnFocus={() => {
                        // The row's Delete button is gone after a delete.
                        if (deleteOpener.current && deleteOpener.current.isConnected) {
                            deleteOpener.current.focus();
                        }
                    }}
                />
            )}
        </PageShell>
    );
}
