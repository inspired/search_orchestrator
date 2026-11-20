/* Troubleshooting: the app's own log lines, filterable by run, job, step, level and time. */
import React from 'react';
import PageShell, { renderPage } from '../../components/PageShell';
import LogsPage from '../../features/logs/LogsPage';
import LogsSurface from '../../features/logs/Surface';

renderPage(
    <LogsSurface>
        <PageShell title="Troubleshooting">
            <LogsPage />
        </PageShell>
    </LogsSurface>,
    'Troubleshooting'
);
