/* Every search attempt of the run, oldest first. */
import React from 'react';
import Link from '@splunk/react-ui/Link';
import Table from '@splunk/react-ui/Table';
import type { StepAttempt } from '../../api/types';
import { formatTime } from '../../format';
import { searchJobUrl } from './StepDrawer';

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export default function LogsTab({ attempts }: { attempts: StepAttempt[] }) {
    if (!attempts.length) {
        return <p>No search attempts yet.</p>;
    }
    const sorted = [...attempts].sort(
        (a, b) => Number(a.started_at || 0) - Number(b.started_at || 0) || a.attempt - b.attempt
    );
    return (
        <Table stripeRows>
            <Table.Head>
                <Table.HeadCell>Step</Table.HeadCell>
                <Table.HeadCell>Attempt</Table.HeadCell>
                <Table.HeadCell>Started</Table.HeadCell>
                <Table.HeadCell>Result</Table.HeadCell>
                <Table.HeadCell>Search job</Table.HeadCell>
            </Table.Head>
            <Table.Body>
                {sorted.map((a) => (
                    <Table.Row key={`${a.step_id}:${a.attempt}`}>
                        <Table.Cell>{a.step_id}</Table.Cell>
                        <Table.Cell>{a.attempt}</Table.Cell>
                        <Table.Cell>{a.started_at ? formatTime(Number(a.started_at)) : ''}</Table.Cell>
                        <Table.Cell>{text(a.error) || text(a.outcome) || text(a.state)}</Table.Cell>
                        <Table.Cell>
                            {a.sid ? (
                                <Link to={searchJobUrl(String(a.sid))} openInNewContext>
                                    Open
                                </Link>
                            ) : (
                                ''
                            )}
                        </Table.Cell>
                    </Table.Row>
                ))}
            </Table.Body>
        </Table>
    );
}
