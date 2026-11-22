/* A "Learn more about <topic>" link to a section of the in-app Help page. */
import React from 'react';
import Link from '@splunk/react-ui/Link';
import { pageHref } from './PageShell';

export function helpHref(anchor: string): string {
    return `${pageHref('help')}#${anchor}`;
}

export interface LearnMoreProps {
    anchor: string;
    topic: string;
}

export default function LearnMore({ anchor, topic }: LearnMoreProps) {
    return (
        <Link to={helpHref(anchor)} openInNewContext>
            {`Learn more about ${topic}`}
        </Link>
    );
}
