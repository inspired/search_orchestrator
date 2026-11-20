/* The Jobs page with no jobs: templates and the example jobs for builders, a hint for everyone else. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import Link from '@splunk/react-ui/Link';
import type { Me } from '../../api/types';
import { COMMAND } from '../../appNames';
import { pageHref } from '../../components/PageShell';
import TemplatePicker from '../builder/TemplatePicker';

export default function JobsEmpty({ me, onBrowseExamples }: { me: Me | null | undefined; onBrowseExamples?: () => void }) {
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
                {onBrowseExamples && (
                    <p>
                        Or start from one of ten ready-made jobs, from simple to advanced:{' '}
                        <Button appearance="secondary" inline label="Browse examples" onClick={onBrowseExamples} />
                    </p>
                )}
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
