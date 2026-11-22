/* Dependencies: every job the viewer can see and how jobs start each other, as a graph or a
 * list. Built in the browser from the Jobs list; refreshes every 30 seconds. */
import React, { useEffect, useMemo, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Message from '@splunk/react-ui/Message';
import RadioBar from '@splunk/react-ui/RadioBar';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import { listJobs } from '../../api/client';
import PageShell, { pageHref, renderPage } from '../../components/PageShell';
import DependencyGraph from '../../features/dependencies/DependencyGraph';
import DependencyList from '../../features/dependencies/DependencyList';
import DependencyPanel from '../../features/dependencies/DependencyPanel';
import { buildJobGraph } from '../../features/dependencies/jobGraph';
import usePoll from '../../hooks/usePoll';

type View = 'graph' | 'list';

function DependenciesPage() {
    const jobs = usePoll(listJobs, 30000, true);
    const [view, setView] = useState<View>('graph');
    const [selected, setSelected] = useState<string | null>(null);
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
    useEffect(() => setNow(Math.floor(Date.now() / 1000)), [jobs.data]);
    const graph = useMemo(() => buildJobGraph(jobs.data || []), [jobs.data]);
    const names = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.name] as const)), [graph]);
    const shown = selected && names.has(selected) ? selected : null;
    const open = (id: string) => window.location.assign(pageHref('builder', { job_id: id }));

    return (
        <PageShell title="Dependencies">
            {jobs.error && (
                <Message type="error" appearance="default">
                    {`The jobs could not be loaded: ${jobs.error.message}`}
                </Message>
            )}
            {jobs.loading && !jobs.data ? (
                <WaitSpinner size="medium" />
            ) : (
                <>
                    <div style={{ marginBottom: '8px' }}>
                        <RadioBar aria-label="Show as" value={view} onChange={(_e: unknown, { value }: { value: unknown }) => setView(value as View)}>
                            <RadioBar.Option label="Graph" value="graph" />
                            <RadioBar.Option label="List" value="list" />
                        </RadioBar>
                    </div>
                    {view === 'graph' ? (
                        <>
                            {graph.nodes.length > graph.unconnected.length ? (
                                <DependencyGraph graph={graph} selected={shown} onSelect={setSelected} onOpen={open} now={now} />
                            ) : (
                                <p>No job starts another yet. Add a completion trigger or a start-job action to a job to connect it.</p>
                            )}
                            {graph.unconnected.length > 0 && (
                                <div role="group" aria-label="Not connected" style={{ marginTop: '8px' }}>
                                    <div style={{ marginBottom: '4px' }}>Not connected</div>
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                        {graph.unconnected.map((id) => (
                                            <Button
                                                key={id}
                                                appearance={shown === id ? 'secondary' : 'subtle'}
                                                label={names.get(id) || id}
                                                aria-pressed={shown === id}
                                                onClick={() => setSelected(id)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                            {shown && <DependencyPanel graph={graph} id={shown} />}
                        </>
                    ) : (
                        <DependencyList graph={graph} />
                    )}
                </>
            )}
        </PageShell>
    );
}

renderPage(<DependenciesPage />, 'Dependencies');
