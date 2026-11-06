/* The actions the run triggered and how each went. */
import React from 'react';
import Table from '@splunk/react-ui/Table';
import type { ActionRun } from '../../api/types';

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export default function ActionsTab({ actions }: { actions: ActionRun[] }) {
    if (!actions.length) {
        return <p>No actions have fired for this run.</p>;
    }
    return (
        <Table stripeRows>
            <Table.Head>
                <Table.HeadCell>When</Table.HeadCell>
                <Table.HeadCell>Step</Table.HeadCell>
                <Table.HeadCell>State</Table.HeadCell>
                <Table.HeadCell>Attempts</Table.HeadCell>
                <Table.HeadCell>Error</Table.HeadCell>
            </Table.Head>
            <Table.Body>
                {actions.map((a, n) => (
                    <Table.Row key={text(a._key) || n}>
                        <Table.Cell>{text(a.hook)}</Table.Cell>
                        <Table.Cell>{text(a.step_id) || 'Run'}</Table.Cell>
                        <Table.Cell>{text(a.state)}</Table.Cell>
                        <Table.Cell>{text(a.attempts)}</Table.Cell>
                        <Table.Cell>{text(a.error)}</Table.Cell>
                    </Table.Row>
                ))}
            </Table.Body>
        </Table>
    );
}
