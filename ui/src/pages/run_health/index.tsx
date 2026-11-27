/* Run health: how the jobs are doing, from the app's audit events and its lines in Splunk's
 * own logs, searched as the viewer. On the Troubleshooting page's surface, like its charts. */
import React from 'react';
import PageShell, { renderPage } from '../../components/PageShell';
import LogsSurface from '../../features/logs/Surface';
import RunHealthPage from '../../features/runhealth/RunHealthPage';

renderPage(
    <LogsSurface>
        <PageShell title="Run health">
            <RunHealthPage />
        </PageShell>
    </LogsSurface>,
    'Run health'
);
