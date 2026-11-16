/* The side panel for the Whole job node: what its lines do, and its outgoing actions. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import Heading from '@splunk/react-ui/Heading';
import type { JobDefinition } from '../../api/types';
import { actionKey, buildGraph, portForHook } from './nodeModel';
import { PORT_STYLE } from './nodeStyle';

export interface JobNodePanelProps {
    job: JobDefinition;
    onSelect: (key: string) => void;
}

export default function JobNodePanel({ job, onSelect }: JobNodePanelProps) {
    const nodes = buildGraph(job).nodes;
    const actions = (job.actions || []).map((a, i) => {
        const node = nodes.find((n) => n.key === actionKey('job', i));
        const port = PORT_STYLE[portForHook(a.hook)].label;
        return { key: actionKey('job', i), label: `${port}: ${node ? node.label : a.type}${node && node.detail ? ` (${node.detail})` : ''}` };
    });
    return (
        <section aria-label="Whole job">
            <Heading level={2}>Whole job</Heading>
            <p>Lines from Whole job fire for the whole run. Without a Failed line, the fallback notification in Settings is used.</p>
            {actions.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0 }}>
                    {actions.map((a) => (
                        <li key={a.key}>
                            <Button appearance="subtle" label={a.label} onClick={() => onSelect(a.key)} />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
