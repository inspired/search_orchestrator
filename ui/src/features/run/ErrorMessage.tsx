/* An API failure in a Message, with the server's issues listed under it. */
import React from 'react';
import Message from '@splunk/react-ui/Message';
import type { ApiError } from '../../api/client';

export default function ErrorMessage({ error }: { error: ApiError | Error }) {
    const issues = (error as ApiError).issues || [];
    return (
        <Message type="error" appearance="default">
            {error.message}
            {issues.length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingLeft: '20px' }}>
                    {issues.map((i, n) => (
                        <li key={`${i.code}-${n}`}>{i.step ? `${i.step}: ${i.message}` : i.message}</li>
                    ))}
                </ul>
            )}
        </Message>
    );
}
