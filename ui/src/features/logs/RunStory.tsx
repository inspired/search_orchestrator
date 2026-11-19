/* The story of one run, from its log lines oldest first, as a Splunk table: each event in
 * words with the time since the run was created, with the waits between them explained ("queued for
 * 2m 10s: waiting for its turn", "the search ran for 45s", "waiting for someone to
 * approve"). Repeated status checks of the same search fold into one line. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import Link from '@splunk/react-ui/Link';
import Table from '@splunk/react-ui/Table';
import type { LogLine, LogNames } from '../../api/logs';
import { pageHref } from '../../components/PageShell';
import { describe, jobName, stepName } from './catalog';
import type { Described } from './catalog';
import { useTheme } from './charts';
import { LevelText, WhyFix } from './LinesTable';
import { epoch, lineTime, span } from './look';

export interface StoryItem {
    line: LogLine;
    d: Described;
    at: number | null;
    /** Folded repeats (search status checks). */
    repeats: number;
}

export interface Gap {
    seconds: number;
    text: string;
}

const GAP_MIN = 10;

export function fold(lines: LogLine[], names: LogNames): StoryItem[] {
    const out: StoryItem[] = [];
    lines.forEach((line) => {
        const prev = out[out.length - 1];
        if (prev && line.event === 'search_status' && prev.line.event === 'search_status' && prev.line.step_id === line.step_id && (line.fields || {}).state === (prev.line.fields || {}).state) {
            prev.repeats += 1;
            return;
        }
        out.push({ line, d: describe(line, names), at: epoch(line.time), repeats: 1 });
    });
    return out;
}

/** Why nothing happened between two events. */
export function explainGap(a: LogLine, b: LogLine, seconds: number, names: LogNames): Gap {
    const fa = a.fields || {};
    const fb = b.fields || {};
    const step = stepName(names, a.job_id, a.step_id || b.step_id);
    let text = 'nothing was logged (the engine looks at the run every tick, about every 5 seconds)';
    if ((a.event === 'run_created' || (a.event === 'run_state' && fa.to === 'queued')) && b.event === 'run_state' && fb.to === 'running') {
        text = 'queued: waiting for its turn (a job runs one run at a time, within the search limits in Settings)';
    } else if (a.event === 'run_created' || (a.event === 'run_state' && fa.to === 'queued')) {
        text = 'queued: waiting for its turn';
    } else if ((a.event === 'step_dispatched' || a.event === 'search_status') && a.step_id && a.step_id === b.step_id) {
        text = `the search for step ${step} was running`;
    } else if (a.event === 'approval_requested' || (a.event === 'step_state' && fa.to === 'awaiting_approval')) {
        text = `waiting for someone to approve step ${step}`;
    } else if (a.event === 'action_retry') {
        text = 'waiting before trying the action again';
    } else if (a.event === 'condition_dispatched') {
        text = 'the condition search was running';
    } else if (a.event === 'run_state' && fa.to === 'paused') {
        text = 'the run was paused';
    } else if (a.event === 'step_state' && fa.to === 'waiting' && b.event === 'step_dispatched') {
        text = `step ${step} waited for the steps before it, or for a free search slot`;
    } else if (b.event === 'step_dispatched' && b.step_id) {
        text = `step ${stepName(names, b.job_id, b.step_id)} waited for a free search slot or for the steps before it`;
    }
    return { seconds, text };
}

export function RunPicker({ runs, onPick }: { runs: Array<{ id: string; label: string }>; onPick: (runId: string) => void }) {
    const t = useTheme();
    return (
        <div style={{ padding: '8px 0' }}>
            <p style={{ margin: '0 0 8px' }}>Pick a run to see its story: every event from created to finished, with the waits explained. Or click a run in the lines.</p>
            {runs.length === 0 ? (
                <p style={{ color: t.contentColorMuted }}>No recent runs.</p>
            ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {runs.map((r) => (
                        <Button key={r.id} appearance="secondary" label={r.label} onClick={() => onPick(r.id)} />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function RunStory({ runId, lines, names }: { runId: string; lines: LogLine[]; names: LogNames }) {
    const t = useTheme();
    const items = fold(lines, names);
    if (!items.length) {
        return <p>{`Nothing logged for run ${runId} in this time range. Try a longer time, or set Log level to Info or Debug.`}</p>;
    }
    const start = items.find((i) => i.at !== null)?.at ?? null;
    const end = [...items].reverse().find((i) => i.at !== null)?.at ?? null;
    const job = jobName(names, items.find((i) => i.line.job_id)?.line.job_id);
    const last = [...items].reverse().find((i) => i.line.event === 'run_state');
    const errors = items.filter((i) => i.d.tone === 'error').length;
    const rows: React.ReactElement[] = [];
    items.forEach((item, i) => {
        const prev = items[i - 1];
        const gap = prev && prev.at !== null && item.at !== null && item.at - prev.at >= GAP_MIN ? explainGap(prev.line, item.line, item.at - prev.at, names) : null;
        if (gap) {
            rows.push(
                <Table.Row key={`gap-${i}`} data-testid="story-gap">
                    <Table.Cell />
                    <Table.Cell colSpan={3} style={{ color: t.contentColorMuted, fontStyle: 'italic' }}>{`${span(gap.seconds)}: ${gap.text}`}</Table.Cell>
                </Table.Row>
            );
        }
        rows.push(
            <Table.Row key={`e-${i}`}>
                <Table.Cell style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{start !== null && item.at !== null ? `+${span(item.at - start)}` : ''}</Table.Cell>
                <Table.Cell>
                    <LevelText tone={item.d.tone} />
                </Table.Cell>
                <Table.Cell style={{ overflowWrap: 'anywhere' }}>
                    {item.d.title}
                    {item.repeats > 1 && <span style={{ color: t.contentColorMuted }}>{` (checked ${item.repeats} times)`}</span>}
                    {(item.d.tone === 'error' || item.d.tone === 'warning') && (item.d.why || item.d.fix) && (
                        <div style={{ marginTop: '6px' }}>
                            <WhyFix d={item.d} />
                        </div>
                    )}
                </Table.Cell>
                <Table.Cell style={{ color: t.contentColorMuted }}>{item.d.result || ''}</Table.Cell>
            </Table.Row>
        );
    });
    return (
        <div>
            <p style={{ margin: '0 0 10px' }}>
                <strong>{job || runId}</strong>
                {' · '}
                {[
                    start !== null ? `from ${lineTime(items[0].line.time)}` : '',
                    start !== null && end !== null ? `${span(end - start)} logged` : '',
                    last ? `last state: ${(last.line.fields || {}).to || ''}` : '',
                    `${items.length} events`,
                    errors ? `${errors} error${errors === 1 ? '' : 's'}` : '',
                ]
                    .filter(Boolean)
                    .join(' · ')}
                {' · '}
                <Link to={pageHref('run', { run_id: runId })}>Open the run</Link>
            </p>
            <Table stripeRows data-testid="run-story">
                <Table.Head>
                    <Table.HeadCell width={90}>Since start</Table.HeadCell>
                    <Table.HeadCell width={100}>Level</Table.HeadCell>
                    <Table.HeadCell>What happened</Table.HeadCell>
                    <Table.HeadCell width={200}>Result</Table.HeadCell>
                </Table.Head>
                <Table.Body>{rows}</Table.Body>
            </Table>
        </div>
    );
}
