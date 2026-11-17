/* Builder toolbar buttons that open dialogs about the saved job: Backfill… (for a saved job,
 * when the user may run jobs). The dialog uses the job as the builder shows it. */
import React, { useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import type { JobDefinition, Me } from '../../api/types';
import { pageHref } from '../../components/PageShell';
import BackfillDialog from '../jobs/BackfillDialog';

export interface BuilderToolbarExtrasProps {
    /** Null for a job that is not saved yet: nothing shows. */
    jobId: string | null;
    job: JobDefinition;
    me: Me | null | undefined;
}

export default function BuilderToolbarExtras({ jobId, job, me }: BuilderToolbarExtrasProps) {
    const [backfilling, setBackfilling] = useState(false);
    const opener = useRef<HTMLElement | null>(null);
    if (!jobId || !me || !(me.can_run || me.can_admin)) {
        return null;
    }
    return (
        <>
            <Button
                appearance="secondary"
                label="Backfill…"
                disabled={job.enabled === false}
                onClick={(e: React.MouseEvent) => {
                    opener.current = e.currentTarget as HTMLElement;
                    setBackfilling(true);
                }}
            />
            {backfilling && (
                <BackfillDialog
                    job={{ ...job, id: jobId }}
                    open
                    returnFocus={opener}
                    onClose={() => setBackfilling(false)}
                    onStarted={() => {
                        window.location.href = pageHref('runs', { job_id: jobId });
                    }}
                />
            )}
        </>
    );
}
