/* Checks the job against the server a moment after the last edit. A reply counts only if
 * its request was for the latest job object (every edit makes a new one), so a slow reply
 * for an older version can never overwrite the issues of a newer one. A failed check
 * keeps the previous issues and says nothing. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Issue, JobDefinition, ValidateResponse } from '../../api/types';

export interface AutoValidateOptions {
    delayMs?: number;
    enabled?: boolean;
}

export interface AutoValidate {
    issues: Issue[];
    checkedJob: JobDefinition | null;
    checking: boolean;
    /** Shows a result obtained elsewhere (a save's own check); ignored unless `job` is the latest. */
    accept: (job: JobDefinition, res: Pick<ValidateResponse, 'issues'>) => void;
}

export default function useAutoValidate(
    job: JobDefinition,
    validate: (job: JobDefinition) => Promise<ValidateResponse>,
    opts: AutoValidateOptions = {}
): AutoValidate {
    const { delayMs = 800, enabled = true } = opts;
    const [result, setResult] = useState<{ issues: Issue[]; checkedJob: JobDefinition | null }>({ issues: [], checkedJob: null });
    const [checkingJob, setCheckingJob] = useState<JobDefinition | null>(null);
    const latest = useRef(job);
    latest.current = job;
    const validateRef = useRef(validate);
    validateRef.current = validate;
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            setCheckingJob(job);
            validateRef
                .current(job)
                .then((res) => {
                    if (alive.current && latest.current === job) {
                        setResult({ issues: res.issues || [], checkedJob: job });
                    }
                })
                .catch(() => undefined)
                .then(() => {
                    if (alive.current && latest.current === job) {
                        setCheckingJob(null);
                    }
                });
        }, delayMs);
        return () => window.clearTimeout(timer);
    }, [job, enabled, delayMs]);

    const accept = useCallback((forJob: JobDefinition, res: Pick<ValidateResponse, 'issues'>) => {
        if (alive.current && latest.current === forJob) {
            setResult({ issues: res.issues || [], checkedJob: forJob });
        }
    }, []);

    return { issues: result.issues, checkedJob: result.checkedJob, checking: checkingJob === job, accept };
}
