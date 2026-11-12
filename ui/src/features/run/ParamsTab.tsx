/* The parameter values this run was started with. */
import React from 'react';
import Table from '@splunk/react-ui/Table';
import type { RunDetail } from '../../api/types';

const show = (v: unknown): string =>
    v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');

export default function ParamsTab({ run }: { run: RunDetail }) {
    const names = Object.keys(run.params || {});
    if (!names.length) {
        return <p>This run has no parameters.</p>;
    }
    return (
        <Table>
            <Table.Head>
                <Table.HeadCell>Name</Table.HeadCell>
                <Table.HeadCell>Value</Table.HeadCell>
            </Table.Head>
            <Table.Body>
                {names.map((n) => (
                    <Table.Row key={n}>
                        <Table.Cell>{n}</Table.Cell>
                        <Table.Cell>{show(run.params[n])}</Table.Cell>
                    </Table.Row>
                ))}
            </Table.Body>
        </Table>
    );
}
