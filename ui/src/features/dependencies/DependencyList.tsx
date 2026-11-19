/* The Dependencies page as a table, for screen readers and keyboard users: each job with what
 * starts it and what it starts. */
import React from 'react';
import Link from '@splunk/react-ui/Link';
import Table from '@splunk/react-ui/Table';
import { pageHref } from '../../components/PageShell';
import type { JobGraph } from './jobGraph';

/** "Daily summary (after it succeeds)" for every job that starts `id`. */
export function startedBy(graph: JobGraph, id: string): string[] {
    const name = nameOf(graph);
    return graph.edges.filter((e) => e.to === id).map((e) => `${name(e.from)} (${e.label})`);
}

/** "Weekly rollup (after it succeeds)" for every job `id` starts. */
export function starts(graph: JobGraph, id: string): string[] {
    const name = nameOf(graph);
    return graph.edges.filter((e) => e.from === id).map((e) => `${name(e.to)} (${e.label})`);
}

function nameOf(graph: JobGraph): (id: string) => string {
    const names = new Map(graph.nodes.map((n) => [n.id, n.name] as const));
    return (id) => names.get(id) || id;
}

const words = (list: string[]) => (list.length ? list.join(', ') : '—');

export default function DependencyList({ graph }: { graph: JobGraph }) {
    const nodes = [...graph.nodes].sort((a, b) => a.name.localeCompare(b.name));
    return (
        <Table>
            <Table.Head>
                <Table.HeadCell>Job</Table.HeadCell>
                <Table.HeadCell>Started by</Table.HeadCell>
                <Table.HeadCell>Starts</Table.HeadCell>
            </Table.Head>
            <Table.Body>
                {nodes.map((n) => (
                    <Table.Row key={n.id}>
                        <Table.Cell>{n.hidden ? n.name : <Link to={pageHref('builder', { job_id: n.id })}>{n.name}</Link>}</Table.Cell>
                        <Table.Cell>{words(startedBy(graph, n.id))}</Table.Cell>
                        <Table.Cell>{words(starts(graph, n.id))}</Table.Cell>
                    </Table.Row>
                ))}
            </Table.Body>
        </Table>
    );
}
