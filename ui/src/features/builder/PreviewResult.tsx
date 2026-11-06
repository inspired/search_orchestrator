/* A step's live preview in the step panel: running, done (summary line and up to 100
 * rows), failed, skipped (with Preview anyway), expired, or out of date (the last table,
 * dimmed). Statuses are plain text; errors and search messages are SUIT Messages. */
import React, { useEffect, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import CollapsiblePanel from '@splunk/react-ui/CollapsiblePanel';
import Message from '@splunk/react-ui/Message';
import Table from '@splunk/react-ui/Table';
import Typography from '@splunk/react-ui/Typography';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { PreviewInputInfo, PreviewView } from './usePreviews';

const pad = (n: number) => String(n).padStart(2, '0');

/** Epoch seconds as local "YYYY-MM-DD HH:MM". */
export function localStamp(epoch: number): string {
    const d = new Date(epoch * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ago(ms: number): string {
    const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) {
        return 'just now';
    }
    if (s < 3600) {
        return `${Math.floor(s / 60)} min ago`;
    }
    return `${Math.floor(s / 3600)} h ago`;
}

function inputText(input: PreviewInputInfo | undefined): string {
    if (!input) {
        return '';
    }
    if (input.mode === 'run') {
        return `input: run ${localStamp(input.scheduledTime)}`;
    }
    if (!input.steps.length) {
        return '';
    }
    const one = (s: (typeof input.steps)[number]) => {
        if (s.skipped) {
            return `${s.id} skipped`;
        }
        return `${s.id} ${s.failed ? 'failed preview' : 'preview'}, ${ago(s.at)}`;
    };
    return `input: ${input.steps.map(one).join('; ')}`;
}

export function summaryLine(preview: PreviewView): string {
    const count = preview.status ? preview.status.result_count : preview.results ? preview.results.total : 0;
    const parts = [`${count} row${count === 1 ? '' : 's'}`];
    if (preview.status && typeof preview.status.run_duration === 'number') {
        parts.push(`${preview.status.run_duration.toFixed(1)} s`);
    }
    const input = inputText(preview.input);
    if (input) {
        parts.push(input);
    }
    if (preview.anyway) {
        parts.push('previewed anyway');
    }
    return parts.join(' · ');
}

const show = (v: unknown): string => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));

function messageType(type: string): 'error' | 'warning' | 'info' {
    const t = type.toUpperCase();
    if (t === 'ERROR' || t === 'FATAL') {
        return 'error';
    }
    return t === 'WARN' || t === 'WARNING' ? 'warning' : 'info';
}

function ResultsTable({ preview, dimmed }: { preview: PreviewView; dimmed: boolean }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const { results } = preview;
    if (!results) {
        return null;
    }
    return (
        <div data-testid="preview-table" style={dimmed ? { opacity: 0.5 } : undefined}>
            {results.fields.length ? (
                <div style={{ overflowX: 'auto' }}>
                    <Table stripeRows>
                        <Table.Head>
                            {results.fields.map((f) => (
                                <Table.HeadCell key={f}>{f}</Table.HeadCell>
                            ))}
                        </Table.Head>
                        <Table.Body>
                            {results.rows.slice(0, 100).map((row, i) => (
                                // eslint-disable-next-line react/no-array-index-key
                                <Table.Row key={i}>
                                    {results.fields.map((f) => (
                                        <Table.Cell key={f}>{show(row[f])}</Table.Cell>
                                    ))}
                                </Table.Row>
                            ))}
                        </Table.Body>
                    </Table>
                </div>
            ) : (
                <p style={{ color: theme.contentColorMuted }}>No results.</p>
            )}
            {results.total > results.rows.length && (
                <p style={{ color: theme.contentColorMuted }}>{`showing ${results.rows.length} of ${results.total}`}</p>
            )}
        </div>
    );
}

export interface PreviewResultProps {
    preview: PreviewView | undefined;
    onCancel: () => void;
    onAnyway: () => void;
}

/** Re-renders once a minute while `on`, so "2 min ago" stays true. */
function useMinuteTick(on: boolean) {
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!on) {
            return undefined;
        }
        const timer = setInterval(() => setTick((n) => n + 1), 60000);
        return () => clearInterval(timer);
    }, [on]);
}

export default function PreviewResult({ preview, onCancel, onAnyway }: PreviewResultProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    useMinuteTick(Boolean(preview && preview.state === 'done' && preview.input && preview.input.mode === 'live' && preview.input.steps.length));
    const muted = { color: theme.contentColorMuted };
    const p = preview;
    const stale = Boolean(p && p.stale && p.state !== 'running');
    let body: React.ReactNode = null;
    if (p) {
        const messages = (p.status && p.status.messages) || [];
        const searchMessages = messages
            .filter((m) => !(p.state === 'failed' && m.text === p.error))
            .map((m) => (
                <Message key={`${m.type}-${m.text}`} type={messageType(m.type)} appearance="default">
                    {m.text}
                </Message>
            ));
        switch (p.state) {
            case 'running':
                body = (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <WaitSpinner size="small" />
                        <span>Previewing…</span>
                        <Button appearance="secondary" label="Cancel" onClick={onCancel} />
                    </div>
                );
                break;
            case 'done':
                body = (
                    <>
                        <p style={muted}>{summaryLine(p)}</p>
                        {searchMessages}
                        <ResultsTable preview={p} dimmed={stale} />
                    </>
                );
                break;
            case 'failed':
                body = (
                    <>
                        <Message type="error" appearance="default">
                            {p.error || (p.status && p.status.truncated) || 'The preview failed.'}
                        </Message>
                        {searchMessages}
                    </>
                );
                break;
            case 'skipped':
                body = (
                    <>
                        <p>{`Would be skipped: ${p.reason || 'a run would skip this step'}`}</p>
                        <Button appearance="secondary" label="Preview anyway" onClick={onAnyway} />
                    </>
                );
                break;
            default:
                body = <p style={muted}>This preview has expired on the server. Preview again to refresh.</p>;
        }
    }
    return (
        <div style={{ marginTop: '8px' }}>
            {stale && p && p.state !== 'missing' && <p style={muted}>Out of date. Preview again to refresh.</p>}
            {body}
            {p && p.spl && (
                <CollapsiblePanel title="Search sent" appearance="subtle" style={{ marginTop: '8px' }}>
                    <Typography as="p" variant="monoBody" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {p.spl}
                    </Typography>
                </CollapsiblePanel>
            )}
            <p style={{ ...muted, fontSize: '12px' }}>Previews run with your access. Real runs use the owner&apos;s.</p>
        </div>
    );
}
