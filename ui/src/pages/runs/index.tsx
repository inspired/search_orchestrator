/* Runs: every run the user may see, newest first, filterable by job and state, with tick boxes
 * for Cancel, Re-run, Approve and Reject on many runs. Filtered by a job, each of its running
 * backfills shows as a line above the table. */
import React, { useEffect, useRef, useState } from 'react';
import Message from '@splunk/react-ui/Message';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import { bulkRuns, listJobs, listRuns, me as getMe } from '../../api/client';
import { RUN_STATES } from '../../api/types';
import type { RunState, RunSummary } from '../../api/types';
import PageShell, { queryParam, renderPage } from '../../components/PageShell';
import BackfillLines from '../../features/runs/BackfillLines';
import RunsTable, { RunsTableFilters, awaitsApproval } from '../../features/runs/RunsTable';
import usePoll from '../../hooks/usePoll';

const ACTIVE = ['queued', 'running', 'paused', 'blocked'];

function initialFilters(): RunsTableFilters {
    const state = queryParam('state');
    return {
        job_id: queryParam('job_id') || undefined,
        state:
            state === 'attention' || (state && (RUN_STATES as readonly string[]).includes(state))
                ? (state as RunState | 'attention')
                : undefined,
    };
}

// "Needs attention" is not a server state. Held runs are always failed, so it is the
// blocked runs, the failed ones and the running or paused runs with a step waiting for
// approval, merged and newest first like the server's own list.
async function fetchRuns(filters: RunsTableFilters) {
    if (filters.state !== 'attention') {
        return listRuns({ ...filters, state: filters.state });
    }
    const [blocked, failed, running, paused] = await Promise.all([
        listRuns({ ...filters, state: 'blocked' }),
        listRuns({ ...filters, state: 'failed' }),
        listRuns({ ...filters, state: 'running' }),
        listRuns({ ...filters, state: 'paused' }),
    ]);
    const byId = new Map<string, RunSummary>();
    [...blocked, ...failed, ...[...running, ...paused].filter(awaitsApproval)].forEach((r) => byId.set(r.id, r));
    return Array.from(byId.values()).sort((a, b) => b.created_at - a.created_at);
}

function RunsPage() {
    const [filters, setFilters] = useState<RunsTableFilters>(initialFilters);
    const [fast, setFast] = useState(true);
    const runs = usePoll(() => fetchRuns(filters), fast ? 5000 : 30000, true);
    const [jobNames, setJobNames] = useState<Record<string, string>>({});
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
    const [canApprove, setCanApprove] = useState(false);

    useEffect(() => {
        getMe()
            .then((m) => setCanApprove(Boolean(m.can_approve || m.can_admin)))
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        listJobs()
            .then((jobs) => {
                const names: Record<string, string> = {};
                jobs.forEach((j) => {
                    names[j.id] = j.name;
                });
                setJobNames(names);
            })
            .catch(() => undefined);
    }, []);

    // A new filter fetches at once, and is kept in the URL so the view can be shared.
    // The first run is skipped: usePoll already loads on mount.
    const firstFilters = useRef(true);
    useEffect(() => {
        if (firstFilters.current) {
            firstFilters.current = false;
            return;
        }
        const params = new URLSearchParams(window.location.search);
        ['job_id', 'state'].forEach((key) => {
            const value = filters[key as keyof RunsTableFilters];
            if (value) {
                params.set(key, value);
            } else {
                params.delete(key);
            }
        });
        const query = params.toString();
        window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
        runs.refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters]);

    const anyActive = (runs.data || []).some((r) => ACTIVE.includes(r.state));
    useEffect(() => setFast(anyActive), [anyActive]);
    useEffect(() => setNow(Math.floor(Date.now() / 1000)), [runs.data]);

    // Runs of deleted jobs still show, under their job id.
    const names = { ...jobNames };
    (runs.data || []).forEach((r) => {
        if (!names[r.job_id]) {
            names[r.job_id] = r.job_id;
        }
    });

    return (
        <PageShell title="Runs">
            {runs.error && (
                <Message type="error" appearance="default">
                    {`The runs could not be loaded: ${runs.error.message}`}
                </Message>
            )}
            {filters.job_id && <BackfillLines key={filters.job_id} jobId={filters.job_id} />}
            {runs.loading && !runs.data ? (
                <WaitSpinner size="medium" />
            ) : (
                <RunsTable
                    runs={runs.data || []}
                    jobNames={names}
                    filters={filters}
                    onFiltersChange={setFilters}
                    now={now}
                    bulk={bulkRuns}
                    canApprove={canApprove}
                    onChanged={runs.refresh}
                />
            )}
        </PageShell>
    );
}

renderPage(<RunsPage />, 'Runs');
