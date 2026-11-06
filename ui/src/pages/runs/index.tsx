/* Runs: every run the user may see, newest first, filterable by job and state. */
import React, { useEffect, useRef, useState } from 'react';
import Message from '@splunk/react-ui/Message';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import { listJobs, listRuns } from '../../api/client';
import { RUN_STATES } from '../../api/types';
import type { RunState } from '../../api/types';
import PageShell, { queryParam, renderPage } from '../../components/PageShell';
import RunsTable, { RunsTableFilters } from '../../features/runs/RunsTable';
import usePoll from '../../hooks/usePoll';

const ACTIVE = ['queued', 'running', 'paused', 'blocked'];

function initialFilters(): RunsTableFilters {
    const state = queryParam('state');
    return {
        job_id: queryParam('job_id') || undefined,
        state: state && (RUN_STATES as readonly string[]).includes(state) ? (state as RunState) : undefined,
    };
}

function RunsPage() {
    const [filters, setFilters] = useState<RunsTableFilters>(initialFilters);
    const [fast, setFast] = useState(true);
    const runs = usePoll(() => listRuns(filters), fast ? 5000 : 30000, true);
    const [jobNames, setJobNames] = useState<Record<string, string>>({});
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

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
            {runs.loading && !runs.data ? (
                <WaitSpinner size="medium" />
            ) : (
                <RunsTable
                    runs={runs.data || []}
                    jobNames={names}
                    filters={filters}
                    onFiltersChange={setFilters}
                    now={now}
                />
            )}
        </PageShell>
    );
}

renderPage(<RunsPage />, 'Runs');
