/* The log lines in words, as a Splunk table: time, level, what happened, the area of the app,
 * the job, run and step by name, who did it and the result. A row expands to why it
 * happened and what to do (for known failures), every field, the traceback and the line as
 * written, with links to the run, its story, lines like it and Search. The level is coloured as
 * in the charts, always with a word (and an icon, except for routine detail). */
import React from 'react';
import Link from '@splunk/react-ui/Link';
import Message from '@splunk/react-ui/Message';
import Table from '@splunk/react-ui/Table';
import { createURL } from '@splunk/splunk-utils/url';
import type { LogFilters, LogLine, LogNames, SearchLink } from '../../api/logs';
import { pageHref } from '../../components/PageShell';
import { CATEGORY_LABEL, describe, jobName, stepName } from './catalog';
import type { Described, Tone } from './catalog';
import { useTheme } from './charts';
import { ToneIcon, lineTime, toneColor } from './look';

const HIDDEN_FIELDS = new Set(['level', 'process', 'logger']);

/** Why it happened and what to do, as a Splunk message. */
export function WhyFix({ d }: { d: Described }) {
    if (!d.why && !d.fix) {
        return null;
    }
    return (
        <div data-testid="why-fix" style={{ margin: '0 0 10px' }}>
            <Message type={d.tone === 'error' ? 'error' : d.tone === 'warning' ? 'warning' : 'info'} appearance="default">
                {d.why && (
                    <div>
                        <strong>Why: </strong>
                        {d.why}
                    </div>
                )}
                {d.fix && (
                    <div>
                        <strong>What to do: </strong>
                        {d.fix}
                    </div>
                )}
            </Message>
        </div>
    );
}

const LEVEL_WORD: Record<Tone, string> = { error: 'Error', warning: 'Warning', ok: 'OK', info: 'Info', muted: 'Detail' };

/** The level as a word with its icon, in the level's colour from the page palette. */
export function LevelText({ tone }: { tone: Tone }) {
    const t = useTheme();
    return (
        <span data-testid="level-text" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em', color: toneColor(t, tone), fontWeight: tone === 'error' || tone === 'warning' ? 600 : undefined }}>
            <ToneIcon tone={tone} size={14} />
            {LEVEL_WORD[tone]}
        </span>
    );
}

function searchFor(line: LogLine, base: SearchLink | null): string | null {
    if (!base) {
        return null;
    }
    const head = base.spl.split(' | ')[0].replace(/^search /, '');
    const terms = [head.replace(/ level IN \([^)]*\)| event=\S+| run_id="[^"]*"| "[^"]*"$/g, '')];
    if (line.event) {
        terms.push(`event=${line.event}`);
    }
    if (line.run_id) {
        terms.push(`run_id="${line.run_id}"`);
    }
    return createURL('/app/search/search', { q: `search ${terms.join(' ')}`, earliest: base.earliest, latest: base.latest });
}

function Details({ line, d, names, base, onFilter }: { line: LogLine; d: Described; names: LogNames; base: SearchLink | null; onFilter: (f: Partial<LogFilters>, story?: boolean) => void }) {
    const t = useTheme();
    const fields = Object.entries(line.fields || {}).filter(([k]) => !HIDDEN_FIELDS.has(k));
    const mono: React.CSSProperties = { fontFamily: t.fontFamilyMono || 'monospace', fontSize: '12px' };
    const href = searchFor(line, base);
    return (
        <div data-testid="line-details" style={{ padding: '4px 0 8px' }}>
            <WhyFix d={d} />
            {fields.length > 0 && (
                <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '2px 16px', margin: '0 0 10px' }}>
                    {fields.map(([k, v]) => (
                        <React.Fragment key={k}>
                            <dt style={{ color: t.contentColorMuted }}>{k}</dt>
                            <dd style={{ margin: 0, ...mono, overflowWrap: 'anywhere' }}>
                                {v}
                                {k === 'job_id' && names[v] ? <span style={{ color: t.contentColorMuted }}>{` (${names[v].name})`}</span> : null}
                            </dd>
                        </React.Fragment>
                    ))}
                </dl>
            )}
            {line.traceback && (
                <>
                    <div style={{ color: t.contentColorMuted }}>Traceback</div>
                    <pre style={{ ...mono, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '2px 0 10px' }}>{line.traceback}</pre>
                </>
            )}
            <div style={{ color: t.contentColorMuted }}>The line as written</div>
            <pre style={{ ...mono, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '2px 0 10px' }}>{(line.raw || '').split('\n')[0]}</pre>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                {line.run_id && <Link to={pageHref('run', line.step_id ? { run_id: line.run_id, step: line.step_id } : { run_id: line.run_id })}>Open the run</Link>}
                {line.run_id && <Link onClick={() => onFilter({ run_id: line.run_id }, true)}>The story of this run</Link>}
                {line.event && <Link onClick={() => onFilter({ event: line.event, level: 'DEBUG' })}>{`Only lines like this (${line.event})`}</Link>}
                {line.job_id && <Link onClick={() => onFilter({ job_id: line.job_id })}>{`Only ${jobName(names, line.job_id)}`}</Link>}
                {href && (
                    <Link to={href} openInNewContext>
                        Open in Search
                    </Link>
                )}
            </div>
        </div>
    );
}

export default function LinesTable({ lines, names, base, onFilter }: { lines: LogLine[]; names: LogNames; base: SearchLink | null; onFilter: (f: Partial<LogFilters>, story?: boolean) => void }) {
    const t = useTheme();
    return (
        <Table rowExpansion="single">
            <Table.Head>
                <Table.HeadCell width={100}>Time</Table.HeadCell>
                <Table.HeadCell width={100}>Level</Table.HeadCell>
                <Table.HeadCell>What happened</Table.HeadCell>
                <Table.HeadCell width={130}>Area</Table.HeadCell>
                <Table.HeadCell width={220}>Job · run · step</Table.HeadCell>
                <Table.HeadCell width={100}>By</Table.HeadCell>
                <Table.HeadCell width={200}>Result</Table.HeadCell>
            </Table.Head>
            <Table.Body>
                {lines.map((line, i) => {
                    const d = describe(line, names);
                    const job = jobName(names, line.job_id);
                    const step = stepName(names, line.job_id, line.step_id);
                    const key = `${line.time}-${i}`;
                    return (
                        <Table.Row
                            key={key}
                            data-testid={`log-line-${i}`}
                            data-tone={d.tone}
                            expansionRow={
                                <Table.Row key={`${key}-x`}>
                                    <Table.Cell colSpan={7}>
                                        <Details line={line} d={d} names={names} base={base} onFilter={onFilter} />
                                    </Table.Cell>
                                </Table.Row>
                            }
                        >
                            <Table.Cell style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{lineTime(line.time)}</Table.Cell>
                            <Table.Cell>
                                <LevelText tone={d.tone} />
                            </Table.Cell>
                            <Table.Cell style={{ overflowWrap: 'anywhere' }}>{d.title}</Table.Cell>
                            <Table.Cell>{CATEGORY_LABEL[d.category]}</Table.Cell>
                            <Table.Cell style={{ overflowWrap: 'anywhere' }}>
                                <div>
                                    {job && <div>{job}</div>}
                                    {line.run_id && (
                                        <div>
                                            <Link to={pageHref('run', line.step_id ? { run_id: line.run_id, step: line.step_id } : { run_id: line.run_id })}>
                                                {`run ${line.run_id.split(':').slice(1).join(':') || line.run_id}`}
                                            </Link>
                                        </div>
                                    )}
                                    {step && <div style={{ color: t.contentColorMuted }}>{`step ${step}`}</div>}
                                </div>
                            </Table.Cell>
                            <Table.Cell style={{ overflowWrap: 'anywhere' }}>{d.who}</Table.Cell>
                            <Table.Cell style={{ color: t.contentColorMuted, overflowWrap: 'anywhere' }}>{d.result || ''}</Table.Cell>
                        </Table.Row>
                    );
                })}
            </Table.Body>
        </Table>
    );
}
