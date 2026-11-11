/* Runs: the runs the user may see, newest first, searchable by job name and filterable by
 * state. */
import React, { useEffect, useRef, useState } from 'react';
import Message from '@splunk/react-ui/Message';
import RadioBar from '@splunk/react-ui/RadioBar';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import * as client from '../../api/client';
import { RUN_STATES } from '../../api/types';
import type { RunState } from '../../api/types';
import PageShell, { queryParam } from '../../components/PageShell';
import useDebounced, { SEARCH_DELAY_MS } from '../../hooks/useDebounced';
import usePoll from '../../hooks/usePoll';
import SchedulePanel from '../schedule/SchedulePanel';
import RunsTable, { RunsTableFilters } from './RunsTable';

const ACTIVE = ['queued', 'running', 'paused', 'blocked'];

export interface RunsApi {
    listJobs: typeof client.listJobs;
    searchRuns: typeof client.searchRuns;
    getSchedule: typeof client.getSchedule;
}

const defaultApi: RunsApi = { listJobs: client.listJobs, searchRuns: client.searchRuns, getSchedule: client.getSchedule };

type View = 'table' | 'timeline';

function initialFilters(): RunsTableFilters {
    const state = queryParam('state');
    return {
        // A link from before the search box names a job by id, which the search also finds.
        q: queryParam('q') || queryParam('job_id') || '',
        state: state && (RUN_STATES as readonly string[]).includes(state) ? (state as RunState) : undefined,
    };
}

export default function RunsPage({ api = defaultApi }: { api?: RunsApi }) {
    const [filters, setFilters] = useState<RunsTableFilters>(initialFilters);
    const [view, setView] = useState<View>(() => (queryParam('view') === 'timeline' ? 'timeline' : 'table'));
    const q = useDebounced(filters.q || '', SEARCH_DELAY_MS).trim();
    const { state } = filters;
    const [fast, setFast] = useState(true);
    const runs = usePoll(() => api.searchRuns({ q, state }), fast ? 5000 : 30000, view === 'table');
    const [jobNames, setJobNames] = useState<Record<string, string>>({});
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

    useEffect(() => {
        api.listJobs()
            .then((jobs) => {
                const names: Record<string, string> = {};
                jobs.forEach((j) => {
                    names[j.id] = j.name;
                });
                setJobNames(names);
            })
            .catch(() => undefined);
    }, [api]);

    // A new filter fetches at once, and is kept in the URL so the view can be shared.
    // The first run is skipped: usePoll already loads on mount.
    const firstFilters = useRef(true);
    useEffect(() => {
        if (firstFilters.current) {
            firstFilters.current = false;
            return;
        }
        const params = new URLSearchParams(window.location.search);
        params.delete('job_id');
        Object.entries({ q, state, view: view === 'timeline' ? view : undefined }).forEach(([key, value]) => {
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
    }, [q, state, view]);

    const rows = runs.data ? runs.data.runs : [];
    const anyActive = rows.some((r) => ACTIVE.includes(r.state));
    useEffect(() => setFast(anyActive), [anyActive]);
    useEffect(() => setNow(Math.floor(Date.now() / 1000)), [runs.data]);

    // Runs of deleted jobs still show, under their job id.
    const names = { ...jobNames };
    rows.forEach((r) => {
        if (!names[r.job_id]) {
            names[r.job_id] = r.job_id;
        }
    });

    return (
        <PageShell
            title="Runs"
            actions={
                <RadioBar
                    value={view}
                    onChange={(_e: unknown, { value }: { value: unknown }) => setView(value as View)}
                >
                    <RadioBar.Option value="table" label="Table" />
                    <RadioBar.Option value="timeline" label="Timeline" />
                </RadioBar>
            }
        >
            {view === 'table' && runs.error && (
                <Message type="error" appearance="default">
                    {`The runs could not be loaded: ${runs.error.message}`}
                </Message>
            )}
            {view === 'table' && runs.data && runs.data.partial && (
                <Message type="warning" appearance="default">
                    Only the newest runs were searched. Older matching runs may be missing, so try more of the name.
                </Message>
            )}
            {view === 'timeline' ? (
                <SchedulePanel
                    q={filters.q || ''}
                    state={state}
                    onQChange={(value) => setFilters({ ...filters, q: value })}
                    api={api}
                />
            ) : runs.loading && !runs.data ? (
                <WaitSpinner size="medium" />
            ) : (
                <RunsTable runs={rows} jobNames={names} filters={filters} onFiltersChange={setFilters} now={now} />
            )}
        </PageShell>
    );
}
