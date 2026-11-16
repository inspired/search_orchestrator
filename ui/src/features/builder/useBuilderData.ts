/* What the builder loads from the server when it opens: the job (when editing one), the user,
 * destinations, alert actions, other jobs, and this job's recent runs for "Input from" (loaded
 * with the job, after a save, and each time the list is opened: `loadRuns`). */
import React, { useEffect, useRef, useState } from 'react';
import * as client from '../../api/client';
import type { AlertAction, Destination, Job, Me, RunSummary } from '../../api/types';
import type { BuilderApi } from './BuilderPage';
import type { BuilderAction } from './reducer';

export default function useBuilderData(api: BuilderApi, initialId: string | null, dispatch: React.Dispatch<BuilderAction>) {
    const [loading, setLoading] = useState(Boolean(initialId));
    const [loadError, setLoadError] = useState<string | null>(null);
    const [meta, setMeta] = useState<{ owner: string | null; canEdit: boolean }>({ owner: null, canEdit: true });
    const [me, setMe] = useState<Me | null>(null);
    const [destinations, setDestinations] = useState<Destination[]>([]);
    const [alertActions, setAlertActions] = useState<AlertAction[] | null>(null);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [runs, setRuns] = useState<RunSummary[]>([]);

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);
    const loadRuns = (id: string | null) => {
        if (!id) {
            return;
        }
        api.listRuns({ job_id: id, limit: 20 })
            .then((r) => mountedRef.current && setRuns(r.filter((run) => run.job_id === id)))
            .catch(() => undefined);
    };

    useEffect(() => {
        let live = true;
        api.me()
            .then((m) => live && setMe(m))
            .catch(() => undefined);
        api.listDestinations()
            .then((d) => live && setDestinations(d))
            .catch(() => undefined);
        api.listAlertActions()
            .then((a) => live && setAlertActions(a))
            .catch(() => undefined);
        api.listJobs()
            .then((j) => live && setJobs(j))
            .catch(() => undefined);
        if (initialId) {
            loadRuns(initialId);
            api.getJob(initialId)
                .then((job) => {
                    if (!live) {
                        return;
                    }
                    setMeta({ owner: job.owner, canEdit: job.permissions ? job.permissions.can_edit : true });
                    dispatch({ type: 'load', job: client.toDefinition(job) });
                    setLoading(false);
                })
                .catch((err: Error) => {
                    if (live) {
                        setLoadError(err.message);
                        setLoading(false);
                    }
                });
        }
        return () => {
            live = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { loading, loadError, meta, setMeta, me, destinations, alertActions, jobs, runs, loadRuns };
}
