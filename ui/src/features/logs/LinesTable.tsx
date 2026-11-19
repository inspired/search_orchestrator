/* The log lines in words: time, what happened (with its category and tone), the job, run
 * and step by name, who did it and the result. A row opens to why it happened and what to
 * do (for known failures), every field, the traceback and the raw line, with links to the
 * run, its story, lines like it and Search. */
import React, { useState } from 'react';
import Link from '@splunk/react-ui/Link';
import { createURL } from '@splunk/splunk-utils/url';
import type { LogFilters, LogLine, LogNames, SearchLink } from '../../api/logs';
import { pageHref } from '../../components/PageShell';
import { CATEGORY_LABEL, describe, jobName, stepName } from './catalog';
import type { Described } from './catalog';
import { useTheme } from './charts';
import { CategoryIcon, ToneIcon, lineTime, toneColor } from './look';

const HIDDEN_FIELDS = new Set(['level', 'process', 'logger']);

export function WhyFix({ d }: { d: Described }) {
    const t = useTheme();
    if (!d.why && !d.fix) {
        return null;
    }
    const color = toneColor(t, d.tone === 'muted' || d.tone === 'info' || d.tone === 'ok' ? 'info' : d.tone);
    return (
        <div data-testid="why-fix" style={{ borderLeft: `3px solid ${color}`, padding: '4px 10px', margin: '0 0 10px', background: t.backgroundColorSection || t.backgroundColor, borderRadius: '0 6px 6px 0' }}>
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
        </div>
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
        <div data-testid="line-details" style={{ padding: '8px 4px 12px 30px' }}>
            <WhyFix d={d} />
            {fields.length > 0 && (
                <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '2px 14px', margin: '0 0 10px', fontSize: '12.5px' }}>
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
                    <div style={{ color: t.contentColorMuted, fontSize: '12px' }}>Traceback</div>
                    <pre style={{ ...mono, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '2px 0 10px', padding: '8px', background: t.backgroundColorSection || t.backgroundColor, borderRadius: '6px' }}>{line.traceback}</pre>
                </>
            )}
            <div style={{ color: t.contentColorMuted, fontSize: '12px' }}>The line as written</div>
            <pre style={{ ...mono, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '2px 0 10px' }}>{(line.raw || '').split('\n')[0]}</pre>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '13px' }}>
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
    const [open, setOpen] = useState<number | null>(null);
    const cell: React.CSSProperties = { padding: '7px 8px', verticalAlign: 'top', borderTop: `1px solid ${t.borderColorWeak || t.borderColor}` };
    const head: React.CSSProperties = { ...cell, borderTop: 0, textAlign: 'left', fontSize: '12px', color: t.contentColorMuted, fontWeight: 600, background: t.backgroundColorSection || t.backgroundColor };
    return (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
            <colgroup>
                <col style={{ width: '92px' }} />
                <col />
                <col style={{ width: '22%' }} />
                <col style={{ width: '96px' }} />
                <col style={{ width: '17%' }} />
            </colgroup>
            <thead>
                <tr>
                    <th style={head}>Time</th>
                    <th style={head}>What happened</th>
                    <th style={head}>Job · run · step</th>
                    <th style={head}>By</th>
                    <th style={head}>Result</th>
                </tr>
            </thead>
            <tbody>
                {lines.map((line, i) => {
                    const d = describe(line, names);
                    const color = toneColor(t, d.tone);
                    const isOpen = open === i;
                    const job = jobName(names, line.job_id);
                    const step = stepName(names, line.job_id, line.step_id);
                    return (
                        <React.Fragment key={`${line.time}-${i}`}>
                            <tr
                                data-testid={`log-line-${i}`}
                                data-tone={d.tone}
                                onClick={() => setOpen(isOpen ? null : i)}
                                style={{ cursor: 'pointer', background: isOpen ? t.backgroundColorHover || t.backgroundColorSection : undefined, boxShadow: d.tone === 'error' || d.tone === 'warning' ? `inset 3px 0 0 ${color}` : undefined }}
                            >
                                <td style={{ ...cell, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: t.contentColorMuted }}>{lineTime(line.time)}</td>
                                <td style={cell}>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                        <span style={{ color, flex: 'none', marginTop: '1px' }}>
                                            <ToneIcon tone={d.tone} size={15} />
                                        </span>
                                        <div style={{ minWidth: 0 }}>
                                            <button
                                                type="button"
                                                aria-expanded={isOpen}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setOpen(isOpen ? null : i);
                                                }}
                                                style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: t.contentColorDefault, textAlign: 'left', cursor: 'pointer', fontWeight: d.tone === 'error' ? 600 : 400, overflowWrap: 'anywhere' }}
                                            >
                                                {d.title}
                                            </button>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: t.contentColorMuted, marginTop: '2px' }}>
                                                <CategoryIcon category={d.category} size={12} />
                                                {CATEGORY_LABEL[d.category]}
                                                {d.why && <span style={{ color }}>{' · why and what to do inside'}</span>}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td style={{ ...cell, overflowWrap: 'anywhere' }}>
                                    {job && <div style={{ fontWeight: 500 }}>{job}</div>}
                                    {line.run_id && (
                                        <div style={{ fontSize: '12px' }}>
                                            <Link to={pageHref('run', line.step_id ? { run_id: line.run_id, step: line.step_id } : { run_id: line.run_id })} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                                {`run ${line.run_id.split(':').slice(1).join(':') || line.run_id}`}
                                            </Link>
                                        </div>
                                    )}
                                    {step && <div style={{ fontSize: '12px', color: t.contentColorMuted }}>{`step ${step}`}</div>}
                                </td>
                                <td style={{ ...cell, overflowWrap: 'anywhere' }}>{d.who}</td>
                                <td style={{ ...cell, fontSize: '12px', color: t.contentColorMuted, overflowWrap: 'anywhere' }}>{d.result || ''}</td>
                            </tr>
                            {isOpen && (
                                <tr>
                                    <td colSpan={5} style={{ padding: 0, background: t.backgroundColorHover || t.backgroundColorSection }}>
                                        <Details line={line} d={d} names={names} base={base} onFilter={onFilter} />
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    );
                })}
            </tbody>
        </table>
    );
}
