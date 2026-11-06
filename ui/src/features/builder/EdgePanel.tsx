/* The side panel for the selected dependency: its condition (on success, on failure,
 * always, or a token expression) and removing it. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Select from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';
import type { Edge, Issue, JobDefinition } from '../../api/types';
import type { BuilderAction } from './reducer';
import { stepLabel } from './GraphView';
import { IssueList } from './StepPanel';

export interface EdgePanelProps {
    job: JobDefinition;
    from: string;
    to: string;
    /** Issues about this dependency (expression issues point at its target step). */
    issues: Issue[];
    dispatch: (action: BuilderAction) => void;
    onRemoved?: () => void;
}

export default function EdgePanel({ job, from, to, issues, dispatch, onRemoved }: EdgePanelProps) {
    const edge = (job.edges || []).find((e) => e.from === from && e.to === to);
    if (!edge) {
        return null;
    }
    const name = (id: string) => {
        const s = (job.steps || []).find((x) => x.id === id);
        return s ? stepLabel(s) : id;
    };
    const set = (changes: Partial<Edge>) => dispatch({ type: 'updateEdge', from, to, changes });
    const condition = edge.condition || 'on_success';
    const title = `${name(from)} to ${name(to)}`;
    return (
        <section aria-label={`Dependency ${title}`}>
            <Heading level={2}>{title}</Heading>
            <IssueList issues={issues} />
            <ControlGroup label={`${name(to)} runs`} labelFor="edge-condition" labelPosition="top">
                <Select
                    inputId="edge-condition"
                    value={condition}
                    onChange={(_e: unknown, { value }: { value: unknown }) => {
                        const next = value as Edge['condition'];
                        set(next === 'expression' ? { condition: next, expression: edge.expression || '' } : { condition: next });
                    }}
                >
                    <Select.Option label={`When ${name(from)} succeeds`} value="on_success" />
                    <Select.Option label={`When ${name(from)} fails`} value="on_failure" />
                    <Select.Option label={`Whenever ${name(from)} finishes`} value="always" />
                    <Select.Option label="When an expression is true" value="expression" />
                </Select>
            </ControlGroup>
            {condition === 'expression' && (
                <ControlGroup label="Expression" labelFor="edge-expression" labelPosition="top" help={`Checked when ${name(from)} finishes.`}>
                    <Text
                        inputId="edge-expression"
                        value={edge.expression || ''}
                        placeholder={`$${from}.resultCount$ > 0`}
                        onChange={(_e: unknown, { value }: { value: string }) => set({ expression: value })}
                    />
                </ControlGroup>
            )}
            <Button
                appearance="destructive"
                label="Remove dependency"
                onClick={() => {
                    dispatch({ type: 'disconnect', from, to });
                    if (onRemoved) {
                        onRemoved();
                    }
                }}
            />
        </section>
    );
}
