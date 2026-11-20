/* Compare: this run next to another run of the same job (by default the newest finished run
 * scheduled before it), step by step: state, run time, results and events scanned, with what
 * changed in words ("failed this time", "3.2× slower", "1 204 → 0 results", "search changed").
 * Parameters and the job's definition are compared too. */
import React, { useEffect, useState } from 'react';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Link from '@splunk/react-ui/Link';
import Message from '@splunk/react-ui/Message';
import Select from '@splunk/react-ui/Select';
import Table from '@splunk/react-ui/Table';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import * as client from '../../api/client';
import type { RunDetail, RunSummary, StepDef } from '../../api/types';
import StatusText from '../../components/StatusText';
import { pageHref } from '../../components/PageShell';
import { formatDuration, formatTime } from '../../format';

const FINISHED = ['succeeded', 'failed', 'cancelled', 'blocked'];
const SLOWER = 1.5;
const MIN_SECONDS = 10;

export interface Side {
    state: string | null;
    seconds: number | null;
    results: number | null;
    scanned: number | null;
}

export interface CompareRow {
    stepId: string;
    name: string;
    a: Side | null;
    b: Side | null;
    /** What changed, in words; empty when nothing worth saying did. */
    changes: string[];
    /** A change that reads as worse (failed now, much slower, no results now). */
    worse: boolean;
}

function side(run: RunDetail, stepId: string): Side | null {
    const st = (run.steps || {})[stepId];
    if (!st) {
        return null;
    }
    const seconds = st.started_at && st.ended_at && st.ended_at >= st.started_at ? st.ended_at - st.started_at : null;
    const perf = st.perf || {};
    return {
        state: st.state || null,
        seconds,
        results: typeof st.result_count === 'number' ? st.result_count : typeof perf.result_count === 'number' ? perf.result_count : null,
        scanned: typeof perf.scan_count === 'number' ? perf.scan_count : null,
    };
}

const num = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');

function stepMap(run: RunDetail): Map<string, StepDef> {
    return new Map((run.definition.steps || []).map((s) => [s.id, s]));
}

/** Steps of `a` (this run) next to `b` (the other run), in this run's order, then steps only `b` had. */
export function compareRuns(a: RunDetail, b: RunDetail): CompareRow[] {
    const defsA = stepMap(a);
    const defsB = stepMap(b);
    const ids = [...defsA.keys(), ...[...defsB.keys()].filter((id) => !defsA.has(id))];
    return ids.map((id) => {
        const def = defsA.get(id) || defsB.get(id);
        const sa = defsA.has(id) ? side(a, id) : null;
        const sb = defsB.has(id) ? side(b, id) : null;
        const changes: string[] = [];
        let worse = false;
        if (!defsB.has(id)) {
            changes.push('new step: not in the other run');
        } else if (!defsA.has(id)) {
            changes.push('removed: only in the other run');
        } else {
            const da = defsA.get(id) as StepDef;
            const db = defsB.get(id) as StepDef;
            if ((da.spl || '') !== (db.spl || '') || (da.saved_search_ref || '') !== (db.saved_search_ref || '')) {
                changes.push('search changed');
            }
            if ((da.earliest || '') !== (db.earliest || '') || (da.latest || '') !== (db.latest || '')) {
                changes.push('time range changed');
            }
        }
        if (sa && sb) {
            if (sa.state !== sb.state && sa.state && sb.state) {
                changes.push(`${sb.state} → ${sa.state}`);
                if (sa.state === 'failed' && sb.state !== 'failed') {
                    worse = true;
                }
            }
            if (sa.seconds !== null && sb.seconds !== null && Math.max(sa.seconds, sb.seconds) >= MIN_SECONDS) {
                const ratio = sa.seconds / Math.max(sb.seconds, 1);
                if (ratio >= SLOWER) {
                    changes.push(`${ratio.toFixed(1).replace(/\.0$/, '')}× slower`);
                    worse = worse || ratio >= 2;
                } else if (ratio <= 1 / SLOWER) {
                    changes.push(`${(1 / Math.max(ratio, 0.01)).toFixed(1).replace(/\.0$/, '')}× faster`);
                }
            }
            if (sa.results !== null && sb.results !== null && sa.results !== sb.results) {
                changes.push(`${num(sb.results)} → ${num(sa.results)} results`);
                if (sa.results === 0 && sb.results > 0) {
                    worse = true;
                }
            }
            if (sa.scanned !== null && sb.scanned !== null && sb.scanned > 0 && sa.scanned / sb.scanned >= 2) {
                changes.push(`${(sa.scanned / sb.scanned).toFixed(1).replace(/\.0$/, '')}× the events scanned`);
            }
        }
        return { stepId: id, name: (def && def.name) || id, a: sa, b: sb, changes, worse };
    });
}

/** Parameters whose value differs: "p: 1 → 2". */
export function paramChanges(a: RunDetail, b: RunDetail): string[] {
    const keys = Array.from(new Set([...Object.keys(a.params || {}), ...Object.keys(b.params || {})])).sort();
    return keys.filter((k) => (a.params || {})[k] !== (b.params || {})[k]).map((k) => `${k}: ${(b.params || {})[k] ?? '(none)'} → ${(a.params || {})[k] ?? '(none)'}`);
}

/** The run to compare with by default: the newest finished run scheduled before this one, else the newest other. */
export function defaultOther(run: RunDetail, runs: RunSummary[]): RunSummary | null {
    const others = runs.filter((r) => r.id !== run.id && FINISHED.includes(r.state)).sort((x, y) => y.scheduled_time - x.scheduled_time || y.created_at - x.created_at);
    return others.find((r) => r.scheduled_time <= run.scheduled_time) || others[0] || null;
}

const runTime = (r: RunDetail) => (r.started_at && r.ended_at ? r.ended_at - r.started_at : null);

function Cell({ s }: { s: Side | null }) {
    if (!s) {
        return <span>—</span>;
    }
    return (
        <div>
            {s.state && <StatusText state={s.state as never} />}
            <div style={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
                {[s.seconds !== null ? formatDuration(s.seconds) : null, s.results !== null ? `${num(s.results)} results` : null, s.scanned !== null ? `${num(s.scanned)} scanned` : null].filter(Boolean).join(' · ')}
            </div>
        </div>
    );
}

export interface CompareApi {
    listRuns: typeof client.listRuns;
    getRun: typeof client.getRun;
}

const defaultApi: CompareApi = { listRuns: client.listRuns, getRun: client.getRun };

export default function CompareTab({ run, api = defaultApi }: { run: RunDetail; api?: CompareApi }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [runs, setRuns] = useState<RunSummary[] | null>(null);
    const [otherId, setOtherId] = useState<string>('');
    const [other, setOther] = useState<RunDetail | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        api.listRuns({ job_id: run.job_id, limit: 50 })
            .then((list) => {
                if (!live) {
                    return;
                }
                setRuns(list);
                const pick = defaultOther(run, list);
                setOtherId((cur) => cur || (pick ? pick.id : ''));
            })
            .catch((e: Error) => live && setError(e.message));
        return () => {
            live = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, run.id, run.job_id]);

    useEffect(() => {
        if (!otherId) {
            setOther(null);
            return undefined;
        }
        let live = true;
        api.getRun(otherId)
            .then((r) => live && setOther(r.run))
            .catch((e: Error) => live && setError(e.message));
        return () => {
            live = false;
        };
    }, [api, otherId]);

    if (error) {
        return (
            <Message type="error" appearance="default">
                {`The other run could not be loaded: ${error}`}
            </Message>
        );
    }
    if (!runs) {
        return <WaitSpinner size="medium" />;
    }
    const choices = runs.filter((r) => r.id !== run.id);
    if (!choices.length) {
        return <p>There is no other run of this job to compare with yet.</p>;
    }
    const rows = other ? compareRuns(run, other) : [];
    const params = other ? paramChanges(run, other) : [];
    const ta = runTime(run);
    const tb = other ? runTime(other) : null;
    return (
        <div style={{ padding: '8px 0' }}>
            <ControlGroup label="Compare with" labelFor="compare-with" labelPosition="top">
                <Select inputId="compare-with" value={otherId} onChange={(_e: unknown, { value }: { value: unknown }) => setOtherId(String(value))}>
                    {choices.map((r) => (
                        <Select.Option key={r.id} value={r.id} label={`${r.number ? `Run #${r.number} · ` : ''}${formatTime(r.scheduled_time)} · ${r.state}`} />
                    ))}
                </Select>
            </ControlGroup>
            {!other ? (
                <WaitSpinner size="medium" />
            ) : (
                <>
                    <p data-testid="compare-summary" style={{ margin: '8px 0' }}>
                        {[
                            `This run ${run.state}${ta !== null ? ` in ${formatDuration(ta)}` : ''}; the other ${other.state}${tb !== null ? ` in ${formatDuration(tb)}` : ''}.`,
                            run.definition_changed || JSON.stringify(run.definition.steps) !== JSON.stringify(other.definition.steps) ? 'The job was changed between them.' : 'Same job definition.',
                            params.length ? `Parameters: ${params.join(', ')}.` : 'Same parameters.',
                        ].join(' ')}{' '}
                        <Link to={pageHref('run', { run_id: other.id })}>Open the other run</Link>
                    </p>
                    <Table data-testid="compare-table">
                        <Table.Head>
                            <Table.HeadCell>Step</Table.HeadCell>
                            <Table.HeadCell width={220}>This run</Table.HeadCell>
                            <Table.HeadCell width={220}>{`Other run (${formatTime(other.scheduled_time)})`}</Table.HeadCell>
                            <Table.HeadCell>What changed</Table.HeadCell>
                        </Table.Head>
                        <Table.Body>
                            {rows.map((r) => (
                                <Table.Row key={r.stepId} data-testid={`compare-${r.stepId}`}>
                                    <Table.Cell>{r.name}</Table.Cell>
                                    <Table.Cell>
                                        <Cell s={r.a} />
                                    </Table.Cell>
                                    <Table.Cell>
                                        <Cell s={r.b} />
                                    </Table.Cell>
                                    <Table.Cell style={{ color: r.worse ? theme.statusColorMedium : r.changes.length ? undefined : theme.contentColorMuted }}>{r.changes.length ? r.changes.join(' · ') : 'No change'}</Table.Cell>
                                </Table.Row>
                            ))}
                        </Table.Body>
                    </Table>
                </>
            )}
        </div>
    );
}
