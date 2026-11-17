/* The selected job on the Dependencies page: what starts it, what it starts, and links to its
 * builder and its runs. A job the viewer can't see has no links. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import { pageHref } from '../../components/PageShell';
import type { JobGraph } from './jobGraph';
import { startedBy, starts } from './DependencyList';

function Entries({ title, list, empty }: { title: string; list: string[]; empty: string }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    return (
        <div style={{ marginTop: '8px' }}>
            <div style={{ fontWeight: Number(theme.fontWeightSemiBold) || 600 }}>{title}</div>
            {list.length ? (
                <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                    {list.map((s) => (
                        <li key={s}>{s}</li>
                    ))}
                </ul>
            ) : (
                <div style={{ color: theme.contentColorMuted }}>{empty}</div>
            )}
        </div>
    );
}

export default function DependencyPanel({ graph, id }: { graph: JobGraph; id: string }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) {
        return null;
    }
    return (
        <section
            aria-label={node.name}
            style={{ marginTop: '12px', padding: '12px 14px', border: `1px solid ${theme.borderColor}`, borderRadius: '4px', background: theme.backgroundColorSection }}
        >
            <h3 style={{ margin: 0, fontSize: '16px' }}>{node.name}</h3>
            <Entries title="Started by" list={startedBy(graph, id)} empty="No other job starts it." />
            <Entries title="Starts" list={starts(graph, id)} empty="It starts no other job." />
            {node.hidden ? (
                <div style={{ marginTop: '8px', color: theme.contentColorMuted }}>
                    You don't have access to this job, so it can't be opened. Ask its owner to share it.
                </div>
            ) : (
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <Button appearance="primary" label="Open job" to={pageHref('builder', { job_id: id })} />
                    <Button appearance="secondary" label="Open runs" to={pageHref('runs', { job_id: id })} />
                </div>
            )}
        </section>
    );
}
