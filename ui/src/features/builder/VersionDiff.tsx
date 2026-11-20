/* The changes between two versions of a job, grouped by the part of the job they touch.
 * Text that spans lines is shown as two read-only blocks, removed lines first. */
import React from 'react';
import Heading from '@splunk/react-ui/Heading';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { VersionChange } from '../../api/versions';

const GROUPS: Record<string, string> = {
    steps: 'Steps',
    edges: 'Lines',
    triggers: 'Schedule',
    actions: 'Actions',
    settings: 'Job settings',
    layout: 'Layout',
};
const ORDER = ['Steps', 'Lines', 'Schedule', 'Actions', 'Job settings', 'Layout'];

const groupOf = (path: string) => GROUPS[path.split(/[.[]/)[0]] || 'Job settings';

const isMultiline = (v: unknown): v is string => typeof v === 'string' && v.includes('\n');

function Lines({ text, mark, color }: { text: string; mark: string; color: string }) {
    return (
        <pre style={{ margin: '4px 0', padding: '4px 8px', overflowX: 'auto', color }}>
            {text.split('\n').map((line, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={i}>{`${mark} ${line}`}</div>
            ))}
        </pre>
    );
}

function Change({ change }: { change: VersionChange }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const { before, after } = change;
    const blocks = isMultiline(before) || isMultiline(after);
    return (
        <li style={{ marginBottom: '6px' }}>
            {change.label}
            {blocks && (
                <div>
                    {typeof before === 'string' && before !== '' && <Lines text={before} mark="−" color={theme.statusColorHigh} />}
                    {typeof after === 'string' && after !== '' && <Lines text={after} mark="+" color={theme.statusColorNormal} />}
                </div>
            )}
        </li>
    );
}

export default function VersionDiff({ changes }: { changes: VersionChange[] }) {
    if (!changes.length) {
        return <p>No differences.</p>;
    }
    const names = ORDER.filter((g) => changes.some((c) => groupOf(c.path) === g));
    return (
        <div>
            {names.map((name) => (
                <section key={name}>
                    <Heading level={4}>{name}</Heading>
                    <ul style={{ margin: 0, paddingLeft: '20px' }}>
                        {changes
                            .filter((c) => groupOf(c.path) === name)
                            .map((c) => (
                                <Change key={`${c.path}:${c.label}`} change={c} />
                            ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}
