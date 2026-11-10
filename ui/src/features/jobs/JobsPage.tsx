/* Jobs: the jobs the user may see, a page at a time and searchable by name, with Run now,
 * enable/disable, Delete and New job. */
import React, { useEffect, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Text from '@splunk/react-ui/Text';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import * as client from '../../api/client';
import type { Job, Me } from '../../api/types';
import PageShell, { pageHref } from '../../components/PageShell';
import DeleteJobDialog from './DeleteJobDialog';
import JobsTable from './JobsTable';
import RunNowDialog from './RunNowDialog';
import useDebounced, { SEARCH_DELAY_MS } from '../../hooks/useDebounced';
import usePoll from '../../hooks/usePoll';

const ACTIVE = ['queued', 'running', 'paused', 'blocked'];
const PAGE_SIZE = 50;

export interface JobsApi {
    me: typeof client.me;
    searchJobs: typeof client.searchJobs;
    setJobEnabled: typeof client.setJobEnabled;
    deleteJob: typeof client.deleteJob;
}

const defaultApi: JobsApi = {
    me: client.me,
    searchJobs: client.searchJobs,
    setJobEnabled: client.setJobEnabled,
    deleteJob: client.deleteJob,
};

export default function JobsPage({ api = defaultApi }: { api?: JobsApi }) {
    const [me, setMe] = useState<Me | null>(null);
    // Poll every 5 seconds while a run is active, and every 30 seconds otherwise.
    const [fast, setFast] = useState(true);
    const [term, setTerm] = useState('');
    const q = useDebounced(term, SEARCH_DELAY_MS).trim();
    const [view, setView] = useState({ q: '', offset: 0 });
    const jobs = usePoll(() => api.searchJobs({ ...view, limit: PAGE_SIZE }), fast ? 5000 : 30000, true);
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

    // A new search starts from the first page.
    useEffect(() => setView((v) => (v.q === q ? v : { q, offset: 0 })), [q]);

    // A new view fetches at once. The first run is skipped: usePoll already loads on mount.
    const firstView = useRef(true);
    useEffect(() => {
        if (firstView.current) {
            firstView.current = false;
            return;
        }
        jobs.refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);

    // Deleting the last jobs of the last page leaves it empty: go to the page before.
    const result = jobs.data;
    useEffect(() => {
        if (result && !result.jobs.length && result.total > 0) {
            const last = Math.floor((result.total - 1) / PAGE_SIZE) * PAGE_SIZE;
            setView((v) => (v.offset > last ? { ...v, offset: last } : v));
        }
    }, [result]);

    const rows = result ? result.jobs : [];
    const total = result ? result.total : 0;
    const anyActive = rows.some((j) => j.last_run && ACTIVE.includes(j.last_run.state));
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
            {result && result.last_run_unavailable && (
                <Message type="warning" appearance="default">
                    The last runs could not be read, so Last run shows Unknown. They will be read again shortly.
                </Message>
            )}
            <div style={{ marginBottom: '16px', maxWidth: '400px' }}>
                <ControlGroup label="Search by name" labelFor="jobs-search" labelPosition="top">
                    <Text
                        inputId="jobs-search"
                        value={term}
                        canClear
                        onChange={(_e: unknown, { value }: { value: string }) => setTerm(value)}
                    />
                </ControlGroup>
            </div>
            {jobs.loading && !jobs.data ? (
                <WaitSpinner size="medium" />
            ) : view.q && !total ? (
                <p>No jobs match this search.</p>
            ) : (
                <JobsTable
                    jobs={rows}
                    lastRunUnavailable={Boolean(result && result.last_run_unavailable)}
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
            {total > PAGE_SIZE && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
                    <Button
                        appearance="secondary"
                        label="Previous"
                        disabled={view.offset === 0}
                        onClick={() => setView((v) => ({ ...v, offset: Math.max(0, v.offset - PAGE_SIZE) }))}
                    />
                    <span>{`${view.offset + 1}\u2013${Math.min(view.offset + PAGE_SIZE, total)} of ${total}`}</span>
                    <Button
                        appearance="secondary"
                        label="Next"
                        disabled={view.offset + PAGE_SIZE >= total}
                        onClick={() => setView((v) => ({ ...v, offset: v.offset + PAGE_SIZE }))}
                    />
                </div>
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
