/* Placeholder: the Run page is built in a later task. */
import React from 'react';
import Message from '@splunk/react-ui/Message';
import PageShell, { queryParam, renderPage } from '../../components/PageShell';

function Placeholder() {
    const id = queryParam('run_id');
    return (
        <PageShell title="Run">
            <Message type="info" appearance="default">
                {`This page is coming in a later task.${id ? ` (${id})` : ''}`}
            </Message>
        </PageShell>
    );
}

renderPage(<Placeholder />, 'Run');
