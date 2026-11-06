/* Placeholder: the Settings page is built in a later task. */
import React from 'react';
import Message from '@splunk/react-ui/Message';
import PageShell, { renderPage } from '../../components/PageShell';

function Placeholder() {
    return (
        <PageShell title="Settings">
            <Message type="info" appearance="default">
                This page is coming in a later task.
            </Message>
        </PageShell>
    );
}

renderPage(<Placeholder />, 'Settings');
