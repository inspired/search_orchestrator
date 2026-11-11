/* The Jobs page with no jobs: templates for builders, a hint for everyone else. */
import React from 'react';
import Link from '@splunk/react-ui/Link';
import type { Me } from '../../api/types';
import { pageHref } from '../../components/PageShell';
import TemplatePicker from '../builder/TemplatePicker';

export default function JobsEmpty({ me }: { me: Me | null | undefined }) {
    if (me && me.can_build) {
        return (
            <>
                <TemplatePicker
                    title="Build your first job"
                    hrefFor={(key) => pageHref('builder', { template: key })}
                />
                {me.can_admin && (
                    <p>
                        Check the install first: run{' '}
                        <Link to="/app/search/search?q=%7C%20orchestrate%20selftest">| orchestrate selftest</Link> in
                        Search.
                    </p>
                )}
            </>
        );
    }
    return <p>No jobs you can run yet. Ask a job owner to add one of your roles under Access.</p>;
}
