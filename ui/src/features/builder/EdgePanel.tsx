/* The side panel for the selected dependency: its condition (on success, on failure,
 * always, or a condition checked by a simple comparison, an SPL expression or a search)
 * and removing it. Also the panel of an If… node. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Select from '@splunk/react-ui/Select';
import type { ConditionKind, Edge, Issue, JobDefinition } from '../../api/types';
import type { BuilderApi } from './BuilderPage';
import type { BuilderAction } from './reducer';
import { CONDITION_KINDS, DEFAULT_CONDITION_RANGE, conditionKind } from './conditions';
import { stepLabel } from './GraphView';
import { TokenInput } from './InsertToken';
import { IssueList } from './StepPanel';
import TimeRangeField from './TimeRangeField';
import { availableTokens } from './tokens';

export interface EdgePanelProps {
    job: JobDefinition;
    from: string;
    to: string;
    /** Issues about this dependency (expression issues point at its target step). */
    issues: Issue[];
    dispatch: (action: BuilderAction) => void;
    onRemoved?: () => void;
    /** Field names of each step's current preview, for the first-row tokens. */
    previewFields?: Record<string, string[]>;
    /** For the time range of a "Search returns results" condition. */
    scheduledTime?: number;
    resolveTimeRange?: BuilderApi['resolveTimeRange'];
}

const HELP: Record<ConditionKind, (from: string) => string> = {
    simple: (from) => `Checked when ${from} finishes. Compare tokens with ==, !=, >, <, and, or, not.`,
    eval: (from) =>
        `Checked when ${from} finishes: true when | makeresults | where <this> returns a row. Any eval function works, such as now(), relative_time() or match(); now() is the run's scheduled time, $run.now$ the time it is checked. Result counts and times compare as numbers; wrap first-row and parameter values in tonumber() to compare them as numbers, as in tonumber($${from}.first.count$) > 5.`,
    search: (from) =>
        `Checked when ${from} finishes: true when the search returns at least one row (it stops at the first). It runs as the job owner and can't write data. Tokens are quoted strings; use tonumber() to compare them as numbers.`,
};

const FIELD_LABEL: Record<ConditionKind, string> = { simple: 'Expression', eval: 'SPL expression', search: 'Search' };

export default function EdgePanel({ job, from, to, issues, dispatch, onRemoved, previewFields = {}, scheduledTime, resolveTimeRange }: EdgePanelProps) {
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
    const kind = conditionKind(edge);
    const title = `${name(from)} to ${name(to)}`;
    const onKind = (next: ConditionKind) => {
        if (next === 'search') {
            const keep = edge.earliest !== undefined || edge.latest !== undefined;
            set({ expression_kind: next, ...(keep ? {} : DEFAULT_CONDITION_RANGE) });
        } else {
            set({ expression_kind: next });
        }
    };
    const placeholder = kind === 'eval' ? `$${from}.resultCount$ > 0 AND now() < relative_time(now(), "@d+6h")` : kind === 'search' ? 'index=main sourcetype=access_combined status>=500' : `$${from}.resultCount$ > 0`;
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
                    <Select.Option label="When a condition is true" value="expression" />
                </Select>
            </ControlGroup>
            {condition === 'expression' && (
                <>
                    <ControlGroup label="Check with" labelFor="edge-condition-kind" labelPosition="top">
                        <Select inputId="edge-condition-kind" data-testid="condition-kind" value={kind} onChange={(_e: unknown, { value }: { value: unknown }) => onKind(value as ConditionKind)}>
                            {CONDITION_KINDS.map((k) => (
                                <Select.Option key={k.value} label={k.label} value={k.value} />
                            ))}
                        </Select>
                    </ControlGroup>
                    <ControlGroup label={FIELD_LABEL[kind]} labelFor="edge-expression" labelPosition="top" help={HELP[kind](name(from))}>
                        <TokenInput
                            key={kind}
                            inputId="edge-expression"
                            fieldLabel={FIELD_LABEL[kind]}
                            value={edge.expression || ''}
                            placeholder={placeholder}
                            groups={availableTokens(job, to, previewFields)}
                            onValue={(expression) => set({ expression })}
                            multiline
                            expandable
                            rowsMin={4}
                            pipeNewline={kind === 'search'}
                        />
                    </ControlGroup>
                    {kind === 'search' && resolveTimeRange && (
                        <TimeRangeField
                            idPrefix="edge-condition"
                            earliest={edge.earliest ?? (edge.latest === undefined ? DEFAULT_CONDITION_RANGE.earliest : '')}
                            latest={edge.latest ?? (edge.earliest === undefined ? DEFAULT_CONDITION_RANGE.latest : '')}
                            scheduledTime={scheduledTime ?? Math.floor(Date.now() / 1000)}
                            timezone={job.timezone}
                            resolve={resolveTimeRange}
                            onChange={(earliest, latest) => set({ earliest, latest })}
                        />
                    )}
                </>
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
