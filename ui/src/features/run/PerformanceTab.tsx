/* What each step's search cost: runtime, events scanned, results and disk from the engine,
 * and peak CPU and memory loaded on request (bin/so/perf.py). */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Message from '@splunk/react-ui/Message';
import Table from '@splunk/react-ui/Table';
import type { RunDetail } from '../../api/types';
import { getPerformance } from '../../api/performance';
import type { StepPerf } from '../../api/performance';
import { formatDuration } from '../../format';

const DASH = '—';
const MB = 1024 * 1024;

const count = (n: number | undefined) =>
    n === undefined ? DASH : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const seconds = (n: number | undefined) =>
    n === undefined ? DASH : n < 60 ? `${n.toFixed(1)} s` : formatDuration(n);
const megabytes = (n: number | undefined) => (n === undefined ? DASH : `${n.toFixed(1)} MB`);
const bytes = (n: number | undefined) => (n === undefined ? DASH : megabytes(n / MB));
const percent = (n: number | undefined) => (n === undefined ? DASH : `${n.toFixed(1)}%`);

const sum = (rows: StepPerf[], key: keyof StepPerf): number | undefined => {
    const values = rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number');
    return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
};

export default function PerformanceTab({ run }: { run: RunDetail }) {
    const [loaded, setLoaded] = useState<Record<string, StepPerf>>({});
    const [notes, setNotes] = useState<string[]>([]);
    const [error, setError] = useState<Error | null>(null);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);

    const load = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await getPerformance(run.id);
            setLoaded(res.steps);
            setNotes(res.notes);
            setDone(true);
        } catch (err) {
            setError(err as Error);
        } finally {
            setBusy(false);
        }
    };

    const rows = run.definition.steps.map((step) => {
        const stored = (run.steps[step.id] && run.steps[step.id].perf) || {};
        return { id: step.id, name: step.name || step.id, perf: { ...loaded[step.id], ...stored } as StepPerf, cpu: loaded[step.id] };
    });
    const perfs = rows.map((r) => r.perf);
    return (
        <div>
            <Button
                label="Load CPU and memory"
                appearance="secondary"
                disabled={busy || done}
                onClick={load}
            />
            {error && (
                <Message type="error" appearance="default">
                    {`CPU and memory could not be loaded: ${error.message}. Try again in a moment.`}
                </Message>
            )}
            {notes.length > 0 && (
                <Message type="info" appearance="default">
                    {notes.join(' ')}
                </Message>
            )}
            <Table stripeRows>
                <Table.Head>
                    <Table.HeadCell>Step</Table.HeadCell>
                    <Table.HeadCell>Runtime</Table.HeadCell>
                    <Table.HeadCell>Events scanned</Table.HeadCell>
                    <Table.HeadCell>Results</Table.HeadCell>
                    <Table.HeadCell>Disk</Table.HeadCell>
                    <Table.HeadCell>Peak CPU</Table.HeadCell>
                    <Table.HeadCell>Peak memory</Table.HeadCell>
                </Table.Head>
                <Table.Body>
                    {rows.map((r) => (
                        <Table.Row key={r.id}>
                            <Table.Cell>{r.name}</Table.Cell>
                            <Table.Cell>{seconds(r.perf.run_duration)}</Table.Cell>
                            <Table.Cell>{count(r.perf.scan_count)}</Table.Cell>
                            <Table.Cell>{count(r.perf.result_count)}</Table.Cell>
                            <Table.Cell>{bytes(r.perf.disk_usage)}</Table.Cell>
                            <Table.Cell>{percent(r.cpu && r.cpu.cpu_peak)}</Table.Cell>
                            <Table.Cell>{megabytes(r.cpu && r.cpu.mem_peak_mb)}</Table.Cell>
                        </Table.Row>
                    ))}
                    <Table.Row>
                        <Table.Cell>Total</Table.Cell>
                        <Table.Cell>{seconds(sum(perfs, 'run_duration'))}</Table.Cell>
                        <Table.Cell>{count(sum(perfs, 'scan_count'))}</Table.Cell>
                        <Table.Cell>{count(sum(perfs, 'result_count'))}</Table.Cell>
                        <Table.Cell>{bytes(sum(perfs, 'disk_usage'))}</Table.Cell>
                        <Table.Cell>{DASH}</Table.Cell>
                        <Table.Cell>{DASH}</Table.Cell>
                    </Table.Row>
                </Table.Body>
            </Table>
        </div>
    );
}
