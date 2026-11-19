/* Troubleshooting: the app's own log lines (bin/so/logs.py) from _internal, searched as the
 * viewer (bin/so/logs_api.py). Filters by run, job, step, level, process, text and time;
 * quick views for errors, the engine and one run; each line opens to its full text, and the
 * whole search opens in Search. The run page and step drawer link here with run_id and
 * step_id filled in. */
import React, { useCallback, useEffect, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Link from '@splunk/react-ui/Link';
import Message from '@splunk/react-ui/Message';
import RadioBar from '@splunk/react-ui/RadioBar';
import Select from '@splunk/react-ui/Select';
import Table from '@splunk/react-ui/Table';
import Text from '@splunk/react-ui/Text';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import { createURL } from '@splunk/splunk-utils/url';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import { searchLogs } from '../../api/logs';
import type { LogFilters, LogLine, LogRange, LogsResponse } from '../../api/logs';
import { pageHref, queryParam } from '../../components/PageShell';

const RANGES: { value: LogRange; label: string }[] = [
    { value: '15m', label: '15 min' },
    { value: '1h', label: '1 hour' },
    { value: '24h', label: '24 hours' },
    { value: '7d', label: '7 days' },
];

export function initialFilters(): LogFilters {
    const range = queryParam('range') as LogRange | null;
    const level = (queryParam('level') || '').toUpperCase();
    return {
        run_id: queryParam('run_id') || '',
        job_id: queryParam('job_id') || '',
        step_id: queryParam('step_id') || '',
        process: (queryParam('process') as LogFilters['process']) || '',
        level: (['ERROR', 'WARNING', 'INFO', 'DEBUG'].includes(level) ? level : '') as LogFilters['level'],
        text: queryParam('text') || '',
        range: range && RANGES.some((r) => r.value === range) ? range : '24h',
    };
}

/** The level's colour: errors high, warnings medium, the rest muted. */
function levelColor(theme: Record<string, string>, level?: string): string {
    if (level === 'ERROR' || level === 'CRITICAL') {
        return theme.statusColorHigh;
    }
    if (level === 'WARNING') {
        return theme.statusColorMedium;
    }
    return theme.contentColorMuted;
}

export interface LogsApi {
    searchLogs: (filters: LogFilters) => Promise<LogsResponse>;
}

const defaultApi: LogsApi = { searchLogs };

export default function LogsPage({ api = defaultApi }: { api?: LogsApi }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [draft, setDraft] = useState<LogFilters>(initialFilters);
    const [result, setResult] = useState<LogsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState<number | null>(null);

    const run = useCallback(
        async (filters: LogFilters) => {
            setBusy(true);
            setError(null);
            setOpen(null);
            try {
                setResult(await api.searchLogs(filters));
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setBusy(false);
            }
        },
        [api]
    );

    useEffect(() => {
        run(initialFilters());
    }, [run]);

    const set = (patch: Partial<LogFilters>) => setDraft((d) => ({ ...d, ...patch }));
    const apply = (patch: Partial<LogFilters> = {}) => {
        const next = { ...draft, ...patch };
        setDraft(next);
        run(next);
    };
    const quick: { label: string; patch: Partial<LogFilters> }[] = [
        { label: 'Errors and warnings', patch: { level: 'WARNING', process: '', text: '', run_id: '', job_id: '', step_id: '' } },
        { label: 'The engine', patch: { process: 'engine', level: 'INFO', text: '', run_id: '', job_id: '', step_id: '' } },
        { label: 'Screens and API calls', patch: { process: 'rest', level: 'DEBUG', text: 'event=request', run_id: '', job_id: '', step_id: '' } },
    ];
    const text = (key: 'run_id' | 'job_id' | 'step_id' | 'text', label: string, help?: string) => (
        <ControlGroup label={label} labelFor={`logs-${key}`} labelPosition="top" help={help}>
            <Text
                inputId={`logs-${key}`}
                value={(draft[key] as string) || ''}
                onChange={(_e: unknown, { value }: { value: string }) => set({ [key]: value })}
                onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && apply()}
            />
        </ControlGroup>
    );

    return (
        <div>
            <p style={{ maxWidth: '820px' }}>
                Every part of the app writes what it does to its own log file in <code>_internal</code>: the engine (schedules,
                runs, steps, searches, conditions, actions, approvals, chaining, backfills) and the screens and API (every
                request, preview and setting). Each line has <code>key=value</code> fields such as <code>run_id</code>,{' '}
                <code>step_id</code> and <code>event</code>. Set how much is written with <strong>Log level</strong> in{' '}
                <Link to={pageHref('settings')}>Settings</Link>; search them yourself with the <code>`orchestrator_logs`</code>{' '}
                macro.
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '12px 0' }}>
                {quick.map((q) => (
                    <Button key={q.label} appearance="secondary" label={q.label} onClick={() => apply(q.patch)} />
                ))}
                {draft.run_id && (
                    <Button appearance="secondary" label="This run only" onClick={() => apply({ level: 'DEBUG', process: '', text: '' })} />
                )}
            </div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {text('run_id', 'Run ID')}
                {text('job_id', 'Job ID')}
                {text('step_id', 'Step ID')}
                <ControlGroup label="Level" labelFor="logs-level" labelPosition="top">
                    <Select inputId="logs-level" value={draft.level || ''} onChange={(_e: unknown, { value }: { value: unknown }) => set({ level: value as LogFilters['level'] })}>
                        <Select.Option value="" label="Info and up" />
                        <Select.Option value="ERROR" label="Errors" />
                        <Select.Option value="WARNING" label="Warnings and up" />
                        <Select.Option value="DEBUG" label="Everything (debug)" />
                    </Select>
                </ControlGroup>
                <ControlGroup label="Part" labelFor="logs-process" labelPosition="top">
                    <Select inputId="logs-process" value={draft.process || ''} onChange={(_e: unknown, { value }: { value: unknown }) => set({ process: value as LogFilters['process'] })}>
                        <Select.Option value="" label="All" />
                        <Select.Option value="engine" label="Engine" />
                        <Select.Option value="rest" label="Screens and API" />
                    </Select>
                </ControlGroup>
                {text('text', 'Text')}
                <ControlGroup label="Time" labelPosition="top">
                    <RadioBar aria-label="Time" value={draft.range} onChange={(_e: unknown, { value }: { value: unknown }) => set({ range: value as LogRange })}>
                        {RANGES.map((r) => (
                            <RadioBar.Option key={r.value} label={r.label} value={r.value} />
                        ))}
                    </RadioBar>
                </ControlGroup>
                <Button appearance="primary" label={busy ? 'Searching…' : 'Search'} disabled={busy} onClick={() => apply()} />
            </div>
            {error && (
                <Message type="error" appearance="default">
                    {`The logs could not be searched: ${error}`}
                </Message>
            )}
            {result && result.notes.length > 0 && (
                <Message type="info" appearance="default">
                    {result.notes.join(' ')}
                </Message>
            )}
            {result && (
                <p>
                    <Link to={createURL('/app/search/search', { q: result.spl, earliest: result.earliest, latest: result.latest })} openInNewContext>
                        Open this search in Search
                    </Link>
                    {` · ${result.lines.length} line${result.lines.length === 1 ? '' : 's'}, newest first`}
                </p>
            )}
            {busy && !result && <WaitSpinner size="medium" />}
            {result && result.lines.length > 0 && (
                <Table stripeRows>
                    <Table.Head>
                        <Table.HeadCell>Time</Table.HeadCell>
                        <Table.HeadCell>Level</Table.HeadCell>
                        <Table.HeadCell>Part</Table.HeadCell>
                        <Table.HeadCell>Event</Table.HeadCell>
                        <Table.HeadCell>Run and step</Table.HeadCell>
                        <Table.HeadCell>Line</Table.HeadCell>
                    </Table.Head>
                    <Table.Body>
                        {result.lines.map((l: LogLine, i: number) => (
                            <Table.Row key={i} data-testid={`log-line-${i}`}>
                                <Table.Cell style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{(l.time || '').replace('T', ' ').slice(0, 19)}</Table.Cell>
                                <Table.Cell>
                                    <span style={{ color: levelColor(theme, l.level), fontWeight: l.level === 'ERROR' || l.level === 'WARNING' ? 600 : undefined }}>{l.level || ''}</span>
                                </Table.Cell>
                                <Table.Cell>{l.process === 'rest' ? 'Screens and API' : l.process === 'engine' ? 'Engine' : l.process || ''}</Table.Cell>
                                <Table.Cell>{l.event || ''}</Table.Cell>
                                <Table.Cell>
                                    {l.run_id ? (
                                        <Link to={pageHref('run', l.step_id ? { run_id: l.run_id, step: l.step_id } : { run_id: l.run_id })}>
                                            {l.step_id ? `${l.run_id} · ${l.step_id}` : l.run_id}
                                        </Link>
                                    ) : (
                                        l.job_id || ''
                                    )}
                                </Table.Cell>
                                <Table.Cell>
                                    <button
                                        type="button"
                                        aria-expanded={open === i}
                                        onClick={() => setOpen(open === i ? null : i)}
                                        style={{
                                            background: 'none',
                                            border: 0,
                                            padding: 0,
                                            font: 'inherit',
                                            color: 'inherit',
                                            textAlign: 'left',
                                            cursor: 'pointer',
                                            fontFamily: 'monospace',
                                            fontSize: '12px',
                                            whiteSpace: open === i ? 'pre-wrap' : 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            maxWidth: open === i ? 'none' : '520px',
                                            display: 'block',
                                            overflowWrap: 'anywhere',
                                        }}
                                    >
                                        {l.raw || ''}
                                    </button>
                                </Table.Cell>
                            </Table.Row>
                        ))}
                    </Table.Body>
                </Table>
            )}
        </div>
    );
}
