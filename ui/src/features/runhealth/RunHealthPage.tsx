/* Run health: how the jobs are doing, from the app's audit events in _audit (runs, steps,
 * actions, late runs) and its lines in _internal and _introspection (engine, performance),
 * searched as the viewer by bin/so/run_health_api.py, so Splunk's index access decides what
 * each viewer sees. A job picker and a time range at the top; each section loads on its own,
 * says what it is built from, and links each of its searches to Search. The job and range live
 * in the address, so a view can be shared. */
import React, { useEffect, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Link from '@splunk/react-ui/Link';
import Message from '@splunk/react-ui/Message';
import RadioBar from '@splunk/react-ui/RadioBar';
import Select from '@splunk/react-ui/Select';
import Table from '@splunk/react-ui/Table';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import Bar from '@splunk/visualizations/Bar';
import Column from '@splunk/visualizations/Column';
import Line from '@splunk/visualizations/Line';
import { createURL } from '@splunk/splunk-utils/url';
import { listJobsBrief } from '../../api/client';
import { runHealth } from '../../api/runHealth';
import type { HealthFilters, HealthRange, HealthSearch, HealthSection, Row, Sections } from '../../api/runHealth';
import type { Job } from '../../api/types';
import { pageHref, queryParam } from '../../components/PageShell';
import { formatDuration, formatTime } from '../../format';
import { useTheme } from '../logs/charts';
import { ToneIcon, TONE_WORD, toneColor } from '../logs/look';
import { paletteOf, toneHex } from '../logs/palette';
import { ChartData, Names, STATES, columnsOf, jobName, num, overTimeData, stepName, tiles } from './healthData';

export interface RunHealthApi {
    runHealth: typeof runHealth;
    listJobs: () => Promise<Job[]>;
}

const defaultApi: RunHealthApi = { runHealth, listJobs: listJobsBrief };

const RANGES: { value: HealthRange; label: string }[] = [
    { value: '24h', label: '24 hours' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
];
const SECTIONS: HealthSection[] = ['runs', 'late', 'engine', 'steps', 'actions', 'performance'];

export function initialFilters(): HealthFilters {
    const range = queryParam('range') as HealthRange | null;
    return {
        job_id: queryParam('job_id') || '',
        range: range && RANGES.some((r) => r.value === range) ? range : '24h',
    };
}

function writeAddress(f: HealthFilters) {
    const q: Record<string, string> = {};
    if (f.job_id) {
        q.job_id = f.job_id;
    }
    if (f.range && f.range !== '24h') {
        q.range = f.range;
    }
    try {
        window.history.replaceState(null, '', pageHref('run_health', q));
    } catch (err) {
        // The address isn't updated; the page still works.
    }
}

type Loaded = { [S in HealthSection]?: Sections[S] | { error: string } };

const failed = (v: unknown): v is { error: string } => Boolean(v && typeof v === 'object' && 'error' in (v as object));

// -- small parts -------------------------------------------------------------------

function SearchLinks({ searches }: { searches: HealthSearch[] }) {
    const t = useTheme();
    if (!searches.length) {
        return null;
    }
    return (
        <span style={{ fontSize: '12px', color: t.contentColorMuted }}>
            {'Open in Search: '}
            {searches.map((s, i) => (
                <React.Fragment key={s.key}>
                    {i > 0 && ' · '}
                    <Link
                        to={createURL('/app/search/search', {
                            q: s.spl,
                            earliest: s.earliest,
                            latest: s.latest,
                        })}
                        openInNewContext
                    >
                        {s.title}
                    </Link>
                </React.Fragment>
            ))}
        </span>
    );
}

function Section({ title, hint, data, children }: { title: string; hint: string; data: Loaded[HealthSection]; children: (d: never) => React.ReactNode }) {
    const t = useTheme();
    return (
        <section style={{ margin: '28px 0 0' }} aria-label={title}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                    borderBottom: `1px solid ${t.borderColorWeak || t.borderColor}`,
                    paddingBottom: '4px',
                }}
            >
                <Heading level={2} style={{ margin: 0 }}>
                    {title}
                </Heading>
                {data && !failed(data) && <SearchLinks searches={data.searches} />}
            </div>
            <p
                style={{
                    color: t.contentColorMuted,
                    fontSize: '13px',
                    margin: '6px 0 10px',
                    maxWidth: '900px',
                }}
            >
                {hint}
            </p>
            {!data && <WaitSpinner size="medium" />}
            {data && failed(data) && (
                <Message type="error" appearance="default">
                    {data.error}
                </Message>
            )}
            {data && !failed(data) && (
                <>
                    {data.notes.map((n) => (
                        <Message key={n} type="info" appearance="default">
                            {n}
                        </Message>
                    ))}
                    {children(data as never)}
                </>
            )}
        </section>
    );
}

function Panel({ title, children, grow = 1 }: { title: string; children: React.ReactNode; grow?: number }) {
    const t = useTheme();
    return (
        <div style={{ flex: `${grow} 1 420px`, minWidth: 0 }}>
            <div
                style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    margin: '0 0 6px',
                    color: t.contentColorDefault,
                }}
            >
                {title}
            </div>
            {children}
        </div>
    );
}

const Row2 = ({ children }: { children: React.ReactNode }) => <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>{children}</div>;

export interface Col {
    key: string;
    label: string;
    render?: (row: Row) => React.ReactNode;
    align?: 'right';
}

export function DataTable({ columns, rows, empty, label }: { columns: Col[]; rows: Row[]; empty: string; label: string }) {
    const t = useTheme();
    if (!rows.length) {
        return <p style={{ color: t.contentColorMuted, margin: '4px 0 8px' }}>{empty}</p>;
    }
    return (
        <div role="group" aria-label={label}>
            <Table stripeRows>
                <Table.Head>
                    {columns.map((c) => (
                        <Table.HeadCell key={c.key} align={c.align}>
                            {c.label}
                        </Table.HeadCell>
                    ))}
                </Table.Head>
                <Table.Body>
                    {rows.map((r, i) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <Table.Row key={i}>
                            {columns.map((c) => (
                                <Table.Cell key={c.key} align={c.align}>
                                    {c.render ? c.render(r) : String(r[c.key] === undefined ? '' : r[c.key])}
                                </Table.Cell>
                            ))}
                        </Table.Row>
                    ))}
                </Table.Body>
            </Table>
        </div>
    );
}

/** One of Splunk's charts, drawn from rows the page already has. */
function Chart({ kind, data, options, height = 260, empty }: { kind: 'column' | 'bar' | 'line'; data: ChartData; options: Record<string, unknown>; height?: number; empty: string }) {
    const t = useTheme();
    const ref = React.useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(600);
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') {
            return undefined;
        }
        const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    if (!data.columns.length || !data.columns[0].length) {
        return <p style={{ color: t.contentColorMuted, margin: '4px 0 8px' }}>{empty}</p>;
    }
    const Viz = kind === 'column' ? Column : kind === 'bar' ? Bar : Line;
    return (
        <div ref={ref} data-testid={`chart-${kind}`}>
            <Viz
                options={options}
                width={width}
                height={height}
                dataSources={{
                    primary: {
                        data,
                        meta: {},
                        requestParams: { offset: 0, count: data.columns[0].length },
                    },
                }}
            />
        </div>
    );
}

// -- the page ----------------------------------------------------------------------

export default function RunHealthPage({ api = defaultApi }: { api?: RunHealthApi }) {
    const t = useTheme();
    const palette = paletteOf(t);
    const [filters, setFilters] = useState<HealthFilters>(initialFilters);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loaded, setLoaded] = useState<Loaded>({});
    const [reload, setReload] = useState(0);

    useEffect(() => {
        api.listJobs().then(setJobs, () => setJobs([]));
    }, [api]);

    useEffect(() => {
        writeAddress(filters);
        let live = true;
        setLoaded({});
        SECTIONS.forEach((s) => {
            api.runHealth(s, filters).then(
                (data) => live && setLoaded((l) => ({ ...l, [s]: data })),
                (err: unknown) =>
                    live &&
                    setLoaded((l) => ({
                        ...l,
                        [s]: { error: err instanceof Error ? err.message : String(err) },
                    }))
            );
        });
        return () => {
            live = false;
        };
    }, [api, filters, reload]);

    const ok = <S extends HealthSection>(s: S): Sections[S] | null => {
        const v = loaded[s];
        return v && !failed(v) ? (v as Sections[S]) : null;
    };
    const names: Names = Object.assign({}, ...SECTIONS.map((s) => (ok(s) ? (ok(s) as { names: Names }).names : {})));
    const job = (r: Row, key = 'job_id') => jobName(names, r[key]);
    const step = (r: Row) => stepName(names, r.job_id, r.step_id);
    const at = (v: unknown) => (num(v) === null ? '' : formatTime(num(v)));
    const secs = (v: unknown) => (num(v) === null ? '' : formatDuration(num(v) as number));
    const runLink = (r: Row) =>
        r.run_id ? (
            <Link to={pageHref('run', { run_id: String(r.run_id) })} title="Open the run">
                {String(r.run_id)}
            </Link>
        ) : (
            ''
        );
    const toneOf = (state: string) => (STATES.find((s) => s.key === state) || STATES[STATES.length - 1]).tone;
    const stateCell = (r: Row) => {
        const state = String(r.state || '');
        const tone = toneOf(state);
        return (
            <span
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: toneColor(t, tone),
                }}
            >
                <ToneIcon tone={tone} size={14} />
                {state}
            </span>
        );
    };
    const stateColors = Object.fromEntries(STATES.map((s) => [s.key, toneHex(palette, s.tone)]));

    return (
        <div>
            <div
                style={{
                    display: 'flex',
                    gap: '16px',
                    alignItems: 'flex-end',
                    flexWrap: 'wrap',
                    margin: '8px 0 4px',
                }}
            >
                <ControlGroup label="Job" labelPosition="top">
                    <Select
                        value={filters.job_id || ''}
                        onChange={(_e: unknown, { value }: { value: unknown }) => setFilters((f) => ({ ...f, job_id: String(value || '') }))}
                        filter
                        style={{ minWidth: '260px' }}
                    >
                        <Select.Option label="All jobs" value="" />
                        {jobs.map((j) => (
                            <Select.Option key={j.id} label={j.name || j.id} value={j.id} />
                        ))}
                    </Select>
                </ControlGroup>
                <ControlGroup label="Time range" labelPosition="top">
                    <RadioBar value={filters.range} onChange={(_e: unknown, { value }: { value: unknown }) => setFilters((f) => ({ ...f, range: value as HealthRange }))}>
                        {RANGES.map((r) => (
                            <RadioBar.Option key={r.value} value={r.value} label={r.label} />
                        ))}
                    </RadioBar>
                </ControlGroup>
                <Button appearance="secondary" label="Refresh" onClick={() => setReload((n) => n + 1)} />
            </div>

            <div
                role="list"
                aria-label="Health"
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    margin: '16px 0 4px',
                    borderTop: `1px solid ${t.borderColorWeak || t.borderColor}`,
                    borderBottom: `1px solid ${t.borderColorWeak || t.borderColor}`,
                }}
            >
                {tiles(ok('runs'), ok('late'), ok('engine')).map((x, i) => (
                    <div
                        key={x.id}
                        role="listitem"
                        data-testid={`tile-${x.id}`}
                        data-tone={x.tone}
                        title={x.tone === 'muted' ? undefined : TONE_WORD[x.tone]}
                        style={{
                            flex: '1 1 130px',
                            padding: '12px 16px',
                            borderLeft: i ? `1px solid ${t.borderColorWeak || t.borderColor}` : 0,
                            minWidth: 0,
                        }}
                    >
                        <div style={{ fontSize: '12px', color: t.contentColorMuted }}>{x.label}</div>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '26px',
                                lineHeight: 1.25,
                                color: x.tone === 'muted' ? t.contentColorDefault : toneColor(t, x.tone),
                            }}
                        >
                            <ToneIcon tone={x.tone} size={18} />
                            {x.value}
                        </div>
                        <div
                            style={{
                                fontSize: '12px',
                                color: t.contentColorMuted,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {x.sub}
                        </div>
                    </div>
                ))}
            </div>

            <Section
                title="Runs"
                hint="Runs with activity in the time range, by their latest state. Held is a failed run that keeps later runs of its job waiting; blocked waits for a re-run, a cancel or its deadline. Success rate is succeeded out of finished runs (succeeded, failed, held); cancelled runs are left out."
                data={loaded.runs}
            >
                {(d: Sections['runs']) => (
                    <>
                        <Panel title="Runs over time, by state">
                            <Chart
                                kind="column"
                                data={overTimeData(d.over_time)}
                                options={{
                                    stackMode: 'stacked',
                                    seriesColorsByField: stateColors,
                                    xAxisTitleVisibility: 'hide',
                                    yAxisTitleText: 'Runs',
                                    legendDisplay: 'right',
                                }}
                                empty="No runs in this time range."
                            />
                        </Panel>
                        <Panel title="Runs that need attention">
                            <DataTable
                                label="Runs that need attention"
                                rows={d.attention}
                                empty="No failed, held or blocked runs."
                                columns={[
                                    { key: 'job_id', label: 'Job', render: (r) => job(r) },
                                    { key: 'run_id', label: 'Run', render: runLink },
                                    { key: 'state', label: 'State', render: stateCell },
                                    {
                                        key: 'last_seen',
                                        label: 'Last change',
                                        render: (r) => at(r.last_seen),
                                    },
                                    { key: 'reason', label: 'Reason' },
                                ]}
                            />
                        </Panel>
                    </>
                )}
            </Section>

            <Section
                title="Steps"
                hint="Which steps fail most, and which run longest: from dispatch to the engine seeing the search finish (to within one engine tick). A delayed step passed its delayed after time while unfinished."
                data={loaded.steps}
            >
                {(d: Sections['steps']) => (
                    <Row2>
                        <Panel title="Steps that fail most">
                            <DataTable
                                label="Steps that fail most"
                                rows={d.failing}
                                empty="No step failed."
                                columns={[
                                    { key: 'job_id', label: 'Job', render: (r) => job(r) },
                                    { key: 'step_id', label: 'Step', render: step },
                                    { key: 'failures', label: 'Failures', align: 'right' },
                                    { key: 'attempts', label: 'Attempts', align: 'right' },
                                    { key: 'failure_pct', label: 'Failed %', align: 'right' },
                                    {
                                        key: 'failed_at',
                                        label: 'Last failure',
                                        render: (r) => at(r.failed_at),
                                    },
                                    { key: 'latest_error', label: 'Latest error' },
                                ]}
                            />
                        </Panel>
                        <Panel title="Slowest steps">
                            <DataTable
                                label="Slowest steps"
                                rows={d.slowest}
                                empty="No step finished."
                                columns={[
                                    { key: 'job_id', label: 'Job', render: (r) => job(r) },
                                    { key: 'step_id', label: 'Step', render: step },
                                    { key: 'attempts', label: 'Attempts', align: 'right' },
                                    {
                                        key: 'median_s',
                                        label: 'Median',
                                        align: 'right',
                                        render: (r) => secs(r.median_s),
                                    },
                                    {
                                        key: 'p95_s',
                                        label: '95th percentile',
                                        align: 'right',
                                        render: (r) => secs(r.p95_s),
                                    },
                                    {
                                        key: 'delayed_runs',
                                        label: 'Delayed runs',
                                        align: 'right',
                                    },
                                    { key: 'delayed_pct', label: 'Delayed %', align: 'right' },
                                ]}
                            />
                        </Panel>
                    </Row2>
                )}
            </Section>

            <Section title="Actions" hint="Notifications and follow-up actions sent, and given up on after their retries, per type." data={loaded.actions}>
                {(d: Sections['actions']) => (
                    <Row2>
                        <Panel title="Sent and failed per type" grow={0.6}>
                            <Chart
                                kind="bar"
                                data={columnsOf(d.by_type, ['action', 'sent', 'failed'])}
                                options={{
                                    stackMode: 'stacked',
                                    seriesColorsByField: {
                                        sent: palette.ok,
                                        failed: palette.error,
                                    },
                                    xAxisTitleVisibility: 'hide',
                                    yAxisTitleVisibility: 'hide',
                                    legendDisplay: 'bottom',
                                }}
                                empty="No actions ran."
                            />
                        </Panel>
                        <Panel title="Latest action failures">
                            <DataTable
                                label="Latest action failures"
                                rows={d.failures}
                                empty="No action failed."
                                columns={[
                                    { key: 'at', label: 'Time', render: (r) => at(r.at) },
                                    { key: 'job_id', label: 'Job', render: (r) => job(r) },
                                    { key: 'run_id', label: 'Run', render: runLink },
                                    { key: 'action', label: 'Action' },
                                    { key: 'hook', label: 'When' },
                                    { key: 'attempts', label: 'Attempts', align: 'right' },
                                    { key: 'error', label: 'Error' },
                                ]}
                            />
                        </Panel>
                    </Row2>
                )}
            </Section>

            <Section title="Late runs" hint="Runs that passed their deadline before they finished, and by how much." data={loaded.late}>
                {(d: Sections['late']) => (
                    <DataTable
                        label="Late runs"
                        rows={d.late}
                        empty="No run missed its deadline."
                        columns={[
                            {
                                key: 'scheduled',
                                label: 'Scheduled',
                                render: (r) => at(r.scheduled),
                            },
                            { key: 'job_id', label: 'Job', render: (r) => job(r) },
                            { key: 'run_id', label: 'Run', render: runLink },
                            {
                                key: 'deadline',
                                label: 'Deadline',
                                render: (r) => at(r.deadline),
                            },
                            {
                                key: 'late_by',
                                label: 'Late by',
                                align: 'right',
                                render: (r) => secs(r.late_by),
                            },
                            { key: 'state', label: 'State', render: stateCell },
                        ]}
                    />
                )}
            </Section>

            <Section
                title="Engine"
                hint="From _internal (splunkd.log): errors and warnings of the engine, the REST handler, the alert action and the search command, and Python tracebacks. Engine last seen also counts the engine process in _introspection and its audit events. For the app's own log lines, use Troubleshooting."
                data={loaded.engine}
            >
                {(d: Sections['engine']) => (
                    <Row2>
                        <Panel title="Errors and warnings">
                            <DataTable
                                label="Errors and warnings"
                                rows={d.errors}
                                empty="No errors or warnings."
                                columns={[
                                    { key: 'script', label: 'Part' },
                                    { key: 'level', label: 'Level' },
                                    { key: 'count', label: 'Count', align: 'right' },
                                    {
                                        key: 'last_seen',
                                        label: 'Last seen',
                                        render: (r) => at(r.last_seen),
                                    },
                                    { key: 'latest_message', label: 'Latest message' },
                                ]}
                            />
                        </Panel>
                        <Panel title="Python tracebacks">
                            <DataTable
                                label="Python tracebacks"
                                rows={d.tracebacks}
                                empty="No tracebacks or exceptions."
                                columns={[
                                    { key: 'script', label: 'Part' },
                                    { key: 'tracebacks', label: 'Tracebacks', align: 'right' },
                                    { key: 'exceptions', label: 'Exceptions', align: 'right' },
                                    { key: 'exception', label: 'Latest exception' },
                                    { key: 'detail', label: 'Detail' },
                                    {
                                        key: 'last_seen',
                                        label: 'Last seen',
                                        render: (r) => at(r.last_seen),
                                    },
                                ]}
                            />
                        </Panel>
                    </Row2>
                )}
            </Section>

            <Section
                title="Performance"
                hint="What the steps cost, from the numbers the engine stores on each step attempt (runs from before 1.23.0 have none). Peak CPU and memory come from _introspection."
                data={loaded.performance}
            >
                {(d: Sections['performance']) => (
                    <>
                        <Row2>
                            <Panel title="Median runtime per job (seconds)">
                                <Chart
                                    kind="line"
                                    data={columnsOf(d.runtime)}
                                    options={{
                                        xAxisTitleVisibility: 'hide',
                                        yAxisTitleText: 'Seconds',
                                        legendDisplay: 'right',
                                    }}
                                    empty="No runtimes in this time range."
                                />
                            </Panel>
                            <Panel title="Events scanned per job">
                                <Chart
                                    kind="line"
                                    data={columnsOf(d.scanned)}
                                    options={{
                                        xAxisTitleVisibility: 'hide',
                                        yAxisTitleText: 'Events',
                                        legendDisplay: 'right',
                                    }}
                                    empty="No scan counts in this time range."
                                />
                            </Panel>
                        </Row2>
                        <Row2>
                            <Panel title="Slowest steps by runtime">
                                <DataTable
                                    label="Slowest steps by runtime"
                                    rows={d.slowest}
                                    empty="No step runtimes."
                                    columns={[
                                        { key: 'job_id', label: 'Job', render: (r) => job(r) },
                                        { key: 'step_id', label: 'Step', render: step },
                                        {
                                            key: 'median_s',
                                            label: 'Median',
                                            align: 'right',
                                            render: (r) => secs(r.median_s),
                                        },
                                        { key: 'attempts', label: 'Attempts', align: 'right' },
                                        { key: 'runs', label: 'Runs', align: 'right' },
                                    ]}
                                />
                            </Panel>
                            <Panel title="Peak CPU and memory per job">
                                <DataTable
                                    label="Peak CPU and memory per job"
                                    rows={d.peaks}
                                    empty="No CPU or memory samples (needs _introspection)."
                                    columns={[
                                        { key: 'job_id', label: 'Job', render: (r) => job(r) },
                                        { key: 'searches', label: 'Searches', align: 'right' },
                                        {
                                            key: 'peak_cpu_pct',
                                            label: 'Peak CPU %',
                                            align: 'right',
                                        },
                                        {
                                            key: 'peak_mem_mb',
                                            label: 'Peak memory (MB)',
                                            align: 'right',
                                        },
                                    ]}
                                />
                            </Panel>
                        </Row2>
                    </>
                )}
            </Section>
        </div>
    );
}
