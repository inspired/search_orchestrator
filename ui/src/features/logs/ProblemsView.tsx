/* Problems: errors and warnings grouped by what went wrong (the server takes ids and numbers
 * out), most serious and most frequent first, each explained with why and what to do, how
 * often, since when, which jobs and how many runs, as a Splunk table; a row expands to why
 * and what to do. */
import React from 'react';
import Link from '@splunk/react-ui/Link';
import Table from '@splunk/react-ui/Table';
import type { LogFilters, LogNames, LogProblem } from '../../api/logs';
import { CATEGORY_LABEL, describe, jobName } from './catalog';
import { useTheme } from './charts';
import { LevelText, WhyFix } from './LinesTable';
import { ToneIcon, ago, epoch, lineTime } from './look';

/** Filters that show the lines of one problem. */
export function problemFilters(p: LogProblem): Partial<LogFilters> {
    if (p.event) {
        return { event: p.event, level: '', text: '' };
    }
    const msg = (p.sample.message || '').replace(/\s(\S*\d\S*|'[^']*'|"[^"]*").*$/, '').slice(0, 60).trim();
    return { event: '', level: 'WARNING', text: msg };
}

export default function ProblemsView({ problems, names, onFilter, nowEpoch }: { problems: LogProblem[]; names: LogNames; onFilter: (f: Partial<LogFilters>) => void; nowEpoch: number }) {
    const t = useTheme();
    if (!problems.length) {
        return (
            <p style={{ display: 'flex', gap: '0.35em', alignItems: 'center' }}>
                <ToneIcon tone="ok" size={14} />
                No errors or warnings in this range and filter.
            </p>
        );
    }
    return (
        <Table stripeRows rowExpansion="single">
            <Table.Head>
                <Table.HeadCell width={70}>Times</Table.HeadCell>
                <Table.HeadCell width={100}>Level</Table.HeadCell>
                <Table.HeadCell>Problem</Table.HeadCell>
                <Table.HeadCell width={130}>Area</Table.HeadCell>
                <Table.HeadCell width={200}>Jobs</Table.HeadCell>
                <Table.HeadCell width={70}>Runs</Table.HeadCell>
                <Table.HeadCell width={150}>Last seen</Table.HeadCell>
            </Table.Head>
            <Table.Body>
                {problems.map((p) => {
                    const d = describe(p.sample, names);
                    const tone = p.level === 'ERROR' || d.tone === 'error' ? 'error' : 'warning';
                    const last = epoch(p.last);
                    return (
                        <Table.Row
                            key={p.signature}
                            data-testid="problem"
                            expansionRow={
                                <Table.Row key={`${p.signature}-x`}>
                                    <Table.Cell colSpan={7}>
                                        <div style={{ padding: '4px 0 8px' }}>
                                            <WhyFix d={{ ...d, tone }} />
                                            <div style={{ color: t.contentColorMuted, margin: '0 0 8px' }}>{`First seen ${lineTime(p.first)}, last ${lineTime(p.last)}.`}</div>
                                            <div style={{ display: 'flex', gap: '16px' }}>
                                                <Link onClick={() => onFilter(problemFilters(p))}>Show these lines</Link>
                                                {p.sample.run_id && <Link onClick={() => onFilter({ run_id: p.sample.run_id, event: '', text: '', level: '' })}>The latest run it happened in</Link>}
                                            </div>
                                        </div>
                                    </Table.Cell>
                                </Table.Row>
                            }
                        >
                            <Table.Cell style={{ fontVariantNumeric: 'tabular-nums' }}>{p.count}</Table.Cell>
                            <Table.Cell>
                                <LevelText tone={tone} />
                            </Table.Cell>
                            <Table.Cell style={{ overflowWrap: 'anywhere' }}>{d.title}</Table.Cell>
                            <Table.Cell>{CATEGORY_LABEL[d.category]}</Table.Cell>
                            <Table.Cell style={{ overflowWrap: 'anywhere' }}>{p.jobs.map((j) => jobName(names, j)).join(', ')}</Table.Cell>
                            <Table.Cell>{p.runs || ''}</Table.Cell>
                            <Table.Cell>{last !== null ? ago(nowEpoch - last) : lineTime(p.last)}</Table.Cell>
                        </Table.Row>
                    );
                })}
            </Table.Body>
        </Table>
    );
}
