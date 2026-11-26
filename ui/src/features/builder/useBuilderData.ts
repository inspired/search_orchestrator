/* What the builder loads from the server when it opens: the job (when editing one), the user,
 * alert actions, other jobs, and this job's recent runs for "Input from" (loaded
 * with the job, after a save, and each time the list is opened: `loadRuns`). */
import React, { useEffect, useRef, useState } from 'react';
import * as client from '../../api/client';
import type { AlertAction, Job, Me, RunSummary } from '../../api/types';
import { dropRemovedActions } from './removedActions';
import type { BuilderApi } from './BuilderPage';
import type { BuilderAction } from './reducer';
import { setTurnedOff } from './nodeCatalog';

/** Who owns the job, whether you may edit it, and the revision you opened (sent back on
 * save, so a save never silently replaces a newer one). */
export interface BuilderMeta {
    owner: string | null;
    canEdit: boolean;
    revision?: number;
}

export default function useBuilderData(api: BuilderApi, initialId: string | null, dispatch: React.Dispatch<BuilderAction>) {
    const [loading, setLoading] = useState(Boolean(initialId));
    const [loadError, setLoadError] = useState<string | null>(null);
    const [meta, setMeta] = useState<BuilderMeta>({ owner: null, canEdit: true });
    const [me, setMe] = useState<Me | null>(null);
    const [dropped, setDropped] = useState(0);
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
            .then((m) => {
                setTurnedOff(m.turned_off);
                if (live) {
                    setMe(m);
                }
            })
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
                    setMeta({ owner: job.owner, canEdit: job.permissions ? job.permissions.can_edit : true, revision: job.revision || 0 });
                    const clean = dropRemovedActions(client.toDefinition(job));
                    setDropped(clean.dropped);
                    dispatch({ type: 'load', job: clean.job });
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

    return { loading, loadError, meta, setMeta, me, alertActions, jobs, runs, loadRuns, dropped };
}
