/* The Jobs page with no jobs: templates for builders, a hint for everyone else. */
import React from 'react';
import Link from '@splunk/react-ui/Link';
import type { Me } from '../../api/types';
import { COMMAND } from '../../appNames';
import { pageHref } from '../../components/PageShell';
import TemplatePicker from '../builder/TemplatePicker';

export default function JobsEmpty({ me }: { me: Me | null | undefined }) {
    if (me === undefined) {
        // Access is still loading: say nothing rather than something wrong.
        return <div />;
    }
    if (me === null) {
        return <p>No jobs yet.</p>;
    }
    if (me.can_build) {
        return (
            <>
                <TemplatePicker
                    title="Build your first job"
                    hrefFor={(key) => pageHref('builder', { template: key })}
                />
                {me.can_admin && (
                    <p>
                        Check the install first: run{' '}
                        <Link to={`/app/search/search?q=${encodeURIComponent(`| ${COMMAND} selftest`)}`}>| {COMMAND} selftest</Link> in
                        Search.
                    </p>
                )}
            </>
        );
    }
    return <p>No jobs you can run yet. Ask a job owner to add one of your roles under Access.</p>;
}
