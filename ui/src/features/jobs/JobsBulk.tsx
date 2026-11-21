/* The bar over the Jobs table while jobs are ticked: Run now, Enable, Disable, Export, Add tag
 * and Delete on all of them. Each job is handled as if done on its own (bulkJobs.plan says
 * which apply and why the others are skipped), one at a time, and the page is told what
 * happened job by job. Delete asks first, naming the jobs. */
import React, { useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Modal from '@splunk/react-ui/Modal';
import Text from '@splunk/react-ui/Text';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Job, Me } from '../../api/types';
import { JobBulkAction, Outcome, plan, runEach, Skipped } from './bulkJobs';

export interface JobsBulkApi {
    startRun: (jobId: string) => Promise<unknown>;
    setJobEnabled: (jobId: string, enabled: boolean) => Promise<unknown>;
    updateJob: (jobId: string, job: Job) => Promise<unknown>;
    deleteJob: (jobId: string) => Promise<unknown>;
    /** After any action: the page reloads the jobs. */
    onDone: () => void;
}

export interface JobsBulkProps {
    selected: Job[];
    me: Me | null | undefined;
    api: JobsBulkApi;
    onExport?: (jobs: Job[]) => void;
    onClear: () => void;
    /** What happened, a line per outcome: what was done, then what was skipped or failed. */
    onResult: (lines: string[]) => void;
}

const jobs = (n: number) => `${n} job${n === 1 ? '' : 's'}`;

const DONE: Record<Exclude<JobBulkAction, 'export'>, string> = {
    run: 'Started',
    enable: 'Enabled',
    disable: 'Disabled',
    tag: 'Tagged',
    delete: 'Deleted',
};

export function resultLines(action: Exclude<JobBulkAction, 'export'>, outcomes: Outcome[], skipped: Skipped[], tag = ''): string[] {
    const ok = outcomes.filter((o) => o.ok).length;
    const lines: string[] = [];
    if (ok) {
        lines.push(action === 'tag' ? `Tagged ${jobs(ok)} ${tag}.` : `${DONE[action]} ${jobs(ok)}.`);
    }
    outcomes.filter((o) => !o.ok).forEach((o) => lines.push(`${o.job.name} failed: ${o.message || 'unknown error'}.`));
    skipped.forEach((s) => lines.push(`Skipped ${s.job.name}: ${s.reason}.`));
    if (!lines.length) {
        lines.push('Nothing to do.');
    }
    return lines;
}

export default function JobsBulk({ selected, me, api, onExport, onClear, onResult }: JobsBulkProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [working, setWorking] = useState(false);
    const [tagging, setTagging] = useState(false);
    const [tag, setTag] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const opener = useRef<HTMLElement | null>(null);

    const act = async (action: Exclude<JobBulkAction, 'export'>, tagText = '') => {
        const p = plan(selected, action, me, tagText);
        setWorking(true);
        const outcomes = await runEach(p.targets, (job) => {
            switch (action) {
                case 'run':
                    return api.startRun(job.id);
                case 'enable':
                case 'disable':
                    return api.setJobEnabled(job.id, action === 'enable');
                case 'tag':
                    return api.updateJob(job.id, { ...job, tags: [...(job.tags || []), tagText] });
                default:
                    return api.deleteJob(job.id);
            }
        });
        setWorking(false);
        onResult(resultLines(action, outcomes, p.skipped, tagText));
        if (outcomes.length) {
            api.onDone();
        }
        onClear();
    };

    const deletable = plan(selected, 'delete', me);
    return (
        <div
            data-testid="jobs-bulk"
            role="region"
            aria-label="Selected jobs"
            style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', margin: '4px 0 8px', border: `1px solid ${theme.borderColor}`, borderRadius: '6px' }}
        >
            <strong>{`${jobs(selected.length)} selected`}</strong>
            <Button appearance="secondary" label="Run now" disabled={working} onClick={() => void act('run')} />
            <Button appearance="secondary" label="Enable" disabled={working} onClick={() => void act('enable')} />
            <Button appearance="secondary" label="Disable" disabled={working} onClick={() => void act('disable')} />
            {onExport && <Button appearance="secondary" label="Export" disabled={working} onClick={() => onExport(selected)} />}
            {tagging ? (
                <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                    <Text inline aria-label="Tag" value={tag} placeholder="Tag" onChange={(_e: unknown, { value }: { value: string }) => setTag(value)} style={{ width: '140px' }} />
                    <Button
                        appearance="primary"
                        label="Add"
                        disabled={working || !tag.trim()}
                        onClick={() => {
                            const t = tag.trim();
                            setTagging(false);
                            setTag('');
                            void act('tag', t);
                        }}
                    />
                    <Button appearance="subtle" label="Cancel" onClick={() => setTagging(false)} />
                </span>
            ) : (
                <Button appearance="secondary" label="Add tag" disabled={working} onClick={() => setTagging(true)} />
            )}
            <Button
                appearance="destructive"
                label="Delete"
                disabled={working}
                onClick={(e: React.MouseEvent<HTMLElement>) => {
                    opener.current = e.currentTarget;
                    setConfirmDelete(true);
                }}
            />
            <Button appearance="subtle" label="Clear" onClick={onClear} />
            {confirmDelete && (
                <Modal open onRequestClose={() => setConfirmDelete(false)} returnFocus={opener} style={{ width: '520px' }}>
                    <Modal.Header title={`Delete ${jobs(deletable.targets.length)}?`} />
                    <Modal.Body>
                        <p style={{ marginTop: 0 }}>Each job, its hidden searches, saved versions and follows are removed. Their runs stay in the run list until retention removes them.</p>
                        <ul style={{ maxHeight: '160px', overflowY: 'auto', paddingLeft: '20px' }}>
                            {deletable.targets.map((j) => (
                                <li key={j.id}>{j.name}</li>
                            ))}
                        </ul>
                        {deletable.skipped.length > 0 && <p style={{ color: theme.contentColorMuted }}>{`${jobs(deletable.skipped.length)} you can't edit ${deletable.skipped.length === 1 ? 'is' : 'are'} left as ${deletable.skipped.length === 1 ? 'it is' : 'they are'}.`}</p>}
                    </Modal.Body>
                    <Modal.Footer>
                        <Button appearance="secondary" label="Cancel" onClick={() => setConfirmDelete(false)} />
                        <Button
                            appearance="destructive"
                            label={`Delete ${jobs(deletable.targets.length)}`}
                            disabled={working || !deletable.targets.length}
                            onClick={() => {
                                setConfirmDelete(false);
                                void act('delete');
                            }}
                        />
                    </Modal.Footer>
                </Modal>
            )}
        </div>
    );
}
