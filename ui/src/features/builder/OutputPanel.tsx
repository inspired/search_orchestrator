/* The side panel for a Summary index or Lookup node: where it writes, with the generated SPL
 * shown read-only. "Edit as search" turns it into a plain Results of earlier steps step. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Multiselect from '@splunk/react-ui/Multiselect';
import StaticContent from '@splunk/react-ui/StaticContent';
import Switch from '@splunk/react-ui/Switch';
import Text from '@splunk/react-ui/Text';
import Typography from '@splunk/react-ui/Typography';
import type { Issue, JobDefinition, StepOutput } from '../../api/types';
import { stepLabel } from './GraphView';
import { parentsOf, wouldCycle } from './graphLogic';
import { outputIssue, outputSpl } from './outputs';
import { previewRefusal } from './previewLogic';
import type { BuilderAction } from './reducer';
import { IssueList } from './StepPanel';

export interface OutputPanelProps {
    job: JobDefinition;
    stepId: string;
    dispatch: (action: BuilderAction) => void;
    onRequestRemove: (stepId: string) => void;
    issues?: Issue[];
}

export default function OutputPanel({ job, stepId, dispatch, onRequestRemove, issues = [] }: OutputPanelProps) {
    const steps = job.steps || [];
    const edges = job.edges || [];
    const step = steps.find((s) => s.id === stepId);
    if (!step || !step.output) {
        return null;
    }
    const output = step.output;
    const p = `output-${stepId}`;
    const write = (next: StepOutput) => dispatch({ type: 'updateStep', id: stepId, changes: { output: next, spl: outputSpl(next) } });
    const problem = outputIssue(output);
    // The field's own message replaces the same issue in the list.
    const listed = issues.filter((i) => i.code !== 'bad_output');

    const parents = parentsOf(edges, stepId);
    const candidates = steps.filter((s) => s.id !== stepId && (parents.includes(s.id) || !wouldCycle(edges, s.id, stepId)));
    const onDepends = (_e: unknown, { values }: { values: (string | number | boolean)[] }) => {
        const next = values.map(String);
        next.filter((id) => !parents.includes(id)).forEach((from) => dispatch({ type: 'connect', from, to: stepId }));
        parents.filter((id) => !next.includes(id)).forEach((from) => dispatch({ type: 'disconnect', from, to: stepId }));
    };

    return (
        <section aria-label={`Step ${stepLabel(step)}`}>
            <Heading level={2}>{stepLabel(step)}</Heading>
            <IssueList issues={listed} />
            <ControlGroup label="Name" labelFor={`${p}-name`} labelPosition="top">
                <Text inputId={`${p}-name`} value={step.name || ''} onChange={(_e: unknown, { value }: { value: string }) => dispatch({ type: 'updateStep', id: stepId, changes: { name: value } })} />
            </ControlGroup>
            {output.kind === 'summary_index' ? (
                <>
                    <ControlGroup label="Summary index" labelFor={`${p}-index`} labelPosition="top" error={Boolean(problem)} help={problem || 'The index to write to.'}>
                        <Text
                            inputId={`${p}-index`}
                            value={output.index}
                            error={Boolean(problem)}
                            placeholder="summary"
                            onChange={(_e: unknown, { value }: { value: string }) => write({ ...output, index: value })}
                        />
                    </ControlGroup>
                    <ControlGroup label="Source" labelFor={`${p}-source`} labelPosition="top" help="Optional. Sets the source of the events.">
                        <Text
                            inputId={`${p}-source`}
                            value={output.source || ''}
                            onChange={(_e: unknown, { value }: { value: string }) => {
                                const { source: _old, ...rest } = output;
                                write(value ? { ...rest, source: value } : rest);
                            }}
                        />
                    </ControlGroup>
                    <Switch appearance="toggle" selected={output.add_run_id !== false} onClick={() => write({ ...output, add_run_id: output.add_run_id === false })}>
                        Add the run id
                    </Switch>
                </>
            ) : (
                <>
                    <ControlGroup label="Lookup name" labelFor={`${p}-name-field`} labelPosition="top" error={Boolean(problem)} help={problem || 'The lookup file or definition to write to.'}>
                        <Text
                            inputId={`${p}-name-field`}
                            value={output.name}
                            error={Boolean(problem)}
                            placeholder="hosts.csv"
                            onChange={(_e: unknown, { value }: { value: string }) => write({ ...output, name: value })}
                        />
                    </ControlGroup>
                    <Switch appearance="toggle" selected={Boolean(output.append)} onClick={() => write({ ...output, append: !output.append })}>
                        Append instead of replace
                    </Switch>
                </>
            )}
            <ControlGroup label="Search" labelPosition="top" help="Generated from the settings above.">
                <StaticContent>
                    <Typography as="span" variant="monoBody">
                        {step.spl || ''}
                    </Typography>
                </StaticContent>
            </ControlGroup>
            <div style={{ marginBottom: '12px' }}>
                <Button appearance="secondary" label="Preview step" disabled />
                <Typography as="p" variant="body">
                    {previewRefusal(job, stepId, true)}
                </Typography>
            </div>
            <div style={{ marginBottom: '12px' }}>
                <Button appearance="secondary" label="Edit as search" onClick={() => dispatch({ type: 'updateStep', id: stepId, changes: { output: undefined } })} />
            </div>
            <ControlGroup label="Depends on" labelFor={`${p}-depends`} labelPosition="top" help="Starts after these steps succeed. Steps that would make a loop aren't listed.">
                <Multiselect inputId={`${p}-depends`} values={parents} onChange={onDepends} noOptionsMessage="No other steps can come before this one.">
                    {candidates.map((s) => (
                        <Multiselect.Option key={s.id} label={stepLabel(s)} value={s.id} />
                    ))}
                </Multiselect>
            </ControlGroup>
            <div style={{ marginTop: '12px' }}>
                <Button appearance="destructive" label="Remove this step" onClick={() => onRequestRemove(stepId)} />
            </div>
        </section>
    );
}
