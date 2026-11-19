/* Problems: errors and warnings grouped by what went wrong (the server takes ids and numbers
 * out), most serious and most frequent first, each explained with why and what to do, how
 * often, since when, which jobs and how many runs. */
import React from 'react';
import Link from '@splunk/react-ui/Link';
import type { LogFilters, LogNames, LogProblem } from '../../api/logs';
import { CATEGORY_LABEL, describe, jobName } from './catalog';
import { useTheme } from './charts';
import { WhyFix } from './LinesTable';
import { CategoryIcon, ToneIcon, ago, epoch, lineTime, toneColor } from './look';

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
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '16px 4px', color: t.contentColorMuted }}>
                <span style={{ color: t.statusColorNormal }}>
                    <ToneIcon tone="ok" />
                </span>
                No errors or warnings in this range and filter.
            </div>
        );
    }
    return (
        <div style={{ display: 'grid', gap: '10px' }}>
            {problems.map((p) => {
                const d = describe(p.sample, names);
                const tone = p.level === 'ERROR' ? 'error' : d.tone === 'error' ? 'error' : 'warning';
                const color = toneColor(t, tone);
                const last = epoch(p.last);
                return (
                    <article
                        key={p.signature}
                        data-testid="problem"
                        style={{ border: `1px solid ${t.borderColorWeak || t.borderColor}`, borderLeft: `4px solid ${color}`, borderRadius: '8px', padding: '10px 14px', background: t.backgroundColorPopup || t.backgroundColor }}
                    >
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                            <span style={{ color, marginTop: '2px' }}>
                                <ToneIcon tone={tone} />
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{d.title}</div>
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12px', color: t.contentColorMuted, margin: '3px 0 8px' }}>
                                    <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                                        <CategoryIcon category={d.category} size={12} />
                                        {CATEGORY_LABEL[d.category]}
                                    </span>
                                    <span>{`last ${last !== null ? ago(nowEpoch - last) : lineTime(p.last)}, first ${lineTime(p.first)}`}</span>
                                    {p.jobs.length > 0 && <span>{`jobs: ${p.jobs.map((j) => jobName(names, j)).join(', ')}`}</span>}
                                    {p.runs > 0 && <span>{`${p.runs} run${p.runs === 1 ? '' : 's'}`}</span>}
                                </div>
                                <WhyFix d={d} />
                                <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
                                    <Link onClick={() => onFilter(problemFilters(p))}>Show these lines</Link>
                                    {p.sample.run_id && <Link onClick={() => onFilter({ run_id: p.sample.run_id, event: '', text: '', level: '' })}>The latest run it happened in</Link>}
                                </div>
                            </div>
                            <div title="How many times" style={{ flex: 'none', fontSize: '20px', fontWeight: 600, color }}>
                                {`×${p.count}`}
                            </div>
                        </div>
                    </article>
                );
            })}
        </div>
    );
}
