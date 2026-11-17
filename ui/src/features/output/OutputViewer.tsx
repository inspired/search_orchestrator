/* "View output": a button that opens a dialog showing what a Lookup or Summary index step,
 * or an email or event action, wrote: up to 100 rows, the total, the search sent, and Open
 * in Search for the rest. For a run it searches that run's time window (and its run id, for
 * a summary index); in the builder it searches the last 24 hours, 7 days or 30 days. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Link from '@splunk/react-ui/Link';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import RadioBar from '@splunk/react-ui/RadioBar';
import Table from '@splunk/react-ui/Table';
import Typography from '@splunk/react-ui/Typography';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import { createURL } from '@splunk/splunk-utils/url';
import { cancelPreview, previewResults, previewStatus } from '../../api/client';
import type { JobDefinition, PreviewResults } from '../../api/types';
import { viewOutput } from '../../api/outputView';
import type { OutputRange, OutputTarget, OutputViewStart } from '../../api/outputView';

export const POLL_MS = 1000;
const LIMIT_S = 300;

const KIND_TITLE: Record<OutputViewStart['kind'], string> = {
    lookup: 'Lookup contents',
    summary_index: 'Events in the summary index',
    event: 'Events in the index',
    email: 'Emails sent (splunkd log)',
};

export interface OutputViewerProps {
    target: OutputTarget;
    /** Shown in the dialog title. */
    name: string;
    runId?: string;
    job?: JobDefinition;
    /** The button's label. */
    label?: string;
}

type View =
    | { state: 'idle' }
    | { state: 'running'; start?: OutputViewStart }
    | { state: 'done'; start: OutputViewStart; results: PreviewResults }
    | { state: 'error'; start?: OutputViewStart; error: string };

function show(v: unknown): string {
    if (v === null || v === undefined) {
        return '';
    }
    return Array.isArray(v) ? v.join(', ') : String(v);
}

export default function OutputViewer({ target, name, runId, job, label = 'View output' }: OutputViewerProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [open, setOpen] = useState(false);
    const [range, setRange] = useState<OutputRange>('24h');
    const [view, setView] = useState<View>({ state: 'idle' });
    const opener = useRef<HTMLButtonElement | null>(null);
    const token = useRef(0);
    const sid = useRef<string | undefined>(undefined);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const stop = useCallback(() => {
        token.current += 1;
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = undefined;
        }
        if (sid.current) {
            cancelPreview(sid.current).catch(() => undefined);
            sid.current = undefined;
        }
    }, []);
    useEffect(() => stop, [stop]);

    const run = (r: OutputRange) => {
        stop();
        const mine = token.current;
        const live = () => token.current === mine;
        setView({ state: 'running' });
        const from = runId ? { runId } : { job: job as JobDefinition, range: r };
        viewOutput(target, from).then(
            (start) => {
                if (!live()) {
                    cancelPreview(start.sid).catch(() => undefined);
                    return;
                }
                sid.current = start.sid;
                setView({ state: 'running', start });
                const poll = () => {
                    previewStatus(start.sid, LIMIT_S).then(
                        (st) => {
                            if (!live()) {
                                return;
                            }
                            if (st.state === 'running') {
                                timer.current = setTimeout(poll, POLL_MS);
                                return;
                            }
                            sid.current = undefined;
                            if (st.state !== 'done') {
                                const msg = (st.messages || []).find((m) => m.type === 'ERROR' || m.type === 'FATAL');
                                setView({ state: 'error', start, error: st.error || (msg && msg.text) || 'The search failed.' });
                                return;
                            }
                            previewResults(start.sid).then(
                                (results) => live() && setView({ state: 'done', start, results }),
                                (err: Error) => live() && setView({ state: 'error', start, error: err.message })
                            );
                        },
                        (err: Error) => live() && setView({ state: 'error', start, error: err.message })
                    );
                };
                poll();
            },
            (err: Error) => live() && setView({ state: 'error', error: err.message || 'The output could not be shown.' })
        );
    };

    const openDialog = () => {
        setOpen(true);
        run(range);
    };
    const close = () => {
        stop();
        setOpen(false);
        setView({ state: 'idle' });
    };

    const start = view.state !== 'idle' ? view.start : undefined;
    const muted = { color: theme.contentColorMuted };
    return (
        <>
            <Button appearance="secondary" label={label} onClick={openDialog} elementRef={opener} />
            {open && (
                <Modal open onRequestClose={close} returnFocus={opener} style={{ width: 'min(960px, 92vw)' }}>
                    <Modal.Header title={`${start ? KIND_TITLE[start.kind] : 'Output'}: ${name}`} />
                    <Modal.Body>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
                            {runId ? (
                                <span style={muted}>{start && start.kind === 'lookup' ? 'The lookup as it is now.' : 'During this run.'}</span>
                            ) : (
                                start?.kind !== 'lookup' && (
                                    <RadioBar
                                        aria-label="Time range"
                                        value={range}
                                        onChange={(_e: unknown, { value }: { value: unknown }) => {
                                            setRange(value as OutputRange);
                                            run(value as OutputRange);
                                        }}
                                    >
                                        <RadioBar.Option label="Last 24 hours" value="24h" />
                                        <RadioBar.Option label="7 days" value="7d" />
                                        <RadioBar.Option label="30 days" value="30d" />
                                    </RadioBar>
                                )
                            )}
                            <span style={{ flex: 1 }} />
                            {start && (
                                <Link to={createURL('/app/search/search', { sid: start.sid })} openInNewContext>
                                    Open in Search
                                </Link>
                            )}
                        </div>
                        {view.state === 'running' && (
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <WaitSpinner size="small" />
                                <span>Searching…</span>
                            </div>
                        )}
                        {view.state === 'error' && (
                            <Message type="error" appearance="default">
                                {view.error}
                            </Message>
                        )}
                        {view.state === 'done' &&
                            (view.results.fields.length ? (
                                <>
                                    <p style={muted}>
                                        {view.results.total > view.results.rows.length
                                            ? `${view.results.total} rows; showing the first ${view.results.rows.length}.`
                                            : `${view.results.total} row${view.results.total === 1 ? '' : 's'}.`}
                                    </p>
                                    <div data-testid="output-table" style={{ overflow: 'auto', maxHeight: '55vh' }}>
                                        <Table stripeRows>
                                            <Table.Head>
                                                {view.results.fields.map((f) => (
                                                    <Table.HeadCell key={f}>{f}</Table.HeadCell>
                                                ))}
                                            </Table.Head>
                                            <Table.Body>
                                                {view.results.rows.map((row, i) => (
                                                    // eslint-disable-next-line react/no-array-index-key
                                                    <Table.Row key={i}>
                                                        {view.results.fields.map((f) => (
                                                            <Table.Cell key={f}>{show(row[f])}</Table.Cell>
                                                        ))}
                                                    </Table.Row>
                                                ))}
                                            </Table.Body>
                                        </Table>
                                    </div>
                                </>
                            ) : (
                                <p style={muted}>Nothing found.</p>
                            ))}
                        {start && (
                            <Typography as="p" variant="monoBody" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...muted, marginTop: '8px' }}>
                                {start.spl}
                            </Typography>
                        )}
                    </Modal.Body>
                    <Modal.Footer>
                        <Button appearance="secondary" label="Refresh" onClick={() => run(range)} disabled={view.state === 'running'} />
                        <Button appearance="primary" label="Close" onClick={close} />
                    </Modal.Footer>
                </Modal>
            )}
        </>
    );
}
