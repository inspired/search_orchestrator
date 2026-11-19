/* Troubleshooting: the app's own log lines, filterable by run, job, step, level and time. */
import React from 'react';
import PageShell, { renderPage } from '../../components/PageShell';
import LogsPage from '../../features/logs/LogsPage';

renderPage(
    <PageShell title="Troubleshooting">
        <LogsPage />
    </PageShell>,
    'Troubleshooting'
);
