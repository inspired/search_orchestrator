/* Builder toolbar buttons that open dialogs: Backfill… (for a saved job, when the user may run
 * jobs; the dialog uses the job as the builder shows it) and Snippets… (for builders and
 * admins). The Save as snippet dialog, opened from the canvas, is drawn here too. */
import React, { useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import type { JobDefinition, Me } from '../../api/types';
import { pageHref } from '../../components/PageShell';
import BackfillDialog from '../jobs/BackfillDialog';
import SaveSnippetDialog from './SaveSnippetDialog';
import SnippetsDialog from './SnippetsDialog';
import type { Snippets } from './useSnippets';

export interface BuilderToolbarExtrasProps {
    /** Null for a job that is not saved yet: no Backfill…. */
    jobId: string | null;
    job: JobDefinition;
    me: Me | null | undefined;
    snippets?: Snippets;
}

export default function BuilderToolbarExtras({ jobId, job, me, snippets }: BuilderToolbarExtrasProps) {
    const [backfilling, setBackfilling] = useState(false);
    const [listing, setListing] = useState(false);
    const opener = useRef<HTMLElement | null>(null);
    if (!me) {
        return null;
    }
    const remember = (e: React.MouseEvent) => {
        opener.current = e.currentTarget as HTMLElement;
    };
    return (
        <>
            {snippets && snippets.canUse && (
                <Button
                    appearance="secondary"
                    label="Snippets…"
                    onClick={(e: React.MouseEvent) => {
                        remember(e);
                        snippets.refresh();
                        setListing(true);
                    }}
                />
            )}
            {jobId && (me.can_run || me.can_admin) && (
                <Button
                    appearance="secondary"
                    label="Backfill…"
                    disabled={job.enabled === false}
                    onClick={(e: React.MouseEvent) => {
                        remember(e);
                        setBackfilling(true);
                    }}
                />
            )}
            {jobId && backfilling && (
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
            {snippets && listing && (
                <SnippetsDialog
                    snippets={snippets.snippets}
                    error={snippets.error}
                    me={me}
                    onRename={snippets.rename}
                    onDelete={snippets.remove}
                    onClose={() => setListing(false)}
                    returnFocus={opener}
                />
            )}
            {snippets && snippets.saving && <SaveSnippetDialog onSave={snippets.create} onClose={snippets.cancelSave} />}
        </>
    );
}
