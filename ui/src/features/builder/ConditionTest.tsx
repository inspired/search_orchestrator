/* "Test condition" under a dependency's condition field: whether the line would be taken now,
 * with the reason, the text that was checked (copyable), and the row count of a search. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import Typography from '@splunk/react-ui/Typography';
import CheckCircle from '@splunk/react-icons/CheckCircle';
import CircleSlashed from '@splunk/react-icons/CircleSlashed';
import CrossCircle from '@splunk/react-icons/CrossCircle';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { JobDefinition, PreviewInput } from '../../api/types';
import { stepLabel } from './GraphView';
import type { PreviewContext } from './previewLogic';
import useConditionTest from './useConditionTest';

export interface ConditionTestProps {
    job: JobDefinition;
    from: string;
    to: string;
    ctx: PreviewContext;
    inputFor: (stepId: string) => PreviewInput;
    /** Previews a step (absent when the job can't be edited). */
    preview?: (stepId: string) => void;
}

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0' };

export default function ConditionTest({ job, from, to, ctx, inputFor, preview }: ConditionTestProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const { view, test, cancel } = useConditionTest(job, from, to, ctx, inputFor);
    const name = (id: string) => {
        const s = (job.steps || []).find((x) => x.id === id);
        return s ? stepLabel(s) : id;
    };
    const copy = (text: string) => {
        try {
            const p = navigator.clipboard.writeText(text);
            if (p && p.catch) {
                p.catch(() => undefined);
            }
        } catch {
            // No clipboard here: the text is selectable.
        }
    };
    const running = view.state === 'running';
    const failure = (text: string) => (
        <div role="alert" style={{ ...row, color: theme.statusColorHigh }}>
            <CrossCircle aria-hidden />
            <span>{text}</span>
        </div>
    );
    const need = view.needs && view.needs[0];
    return (
        <div aria-live="polite" style={{ margin: '8px 0' }}>
            {running ? <Button label="Cancel test" onClick={cancel} /> : <Button label="Test condition" onClick={test} />}
            {running && <div style={row}>Testing…</div>}
            {view.state === 'done' && (
                <>
                    <div style={row}>
                        {view.result ? <CheckCircle aria-hidden /> : <CircleSlashed aria-hidden />}
                        <span>{view.result ? 'True: the line would be taken' : 'False: the line would not be taken'}</span>
                    </div>
                    {view.why && <Typography as="p">{view.why}</Typography>}
                    {view.count !== undefined && !view.error && <Typography as="p">{`${view.count} ${view.count === 1 ? 'row' : 'rows'}`}</Typography>}
                    {view.error && failure(view.error)}
                    {view.text && (
                        <>
                            <pre style={{ margin: '6px 0', padding: 8, overflowX: 'auto', whiteSpace: 'pre-wrap', border: `1px solid ${theme.borderColor}` }}>
                                <code>{view.text}</code>
                            </pre>
                            <Button label="Copy" onClick={() => copy(view.text || '')} />
                        </>
                    )}
                </>
            )}
            {view.state === 'needs_preview' && need && (
                <div style={row}>
                    <span>{`Preview ${name(need)} first to test this condition.`}</span>
                    {preview && <Button label={`Preview ${name(need)}`} onClick={() => preview(need)} />}
                </div>
            )}
            {view.state === 'error' && view.error && failure(view.error)}
            {view.stale && <Typography as="p">Out of date. Test again.</Typography>}
        </div>
    );
}
