/* Help: the user guide, inside the app. */
import React from 'react';
import PageShell, { renderPage } from '../../components/PageShell';
import HelpPage from '../../features/help/HelpPage';

renderPage(
    <PageShell title="Help">
        <HelpPage />
    </PageShell>,
    'Help',
);
