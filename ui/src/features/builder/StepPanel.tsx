/* The side panel for the selected step: search, time range, "Depends on" (so steps can be
 * connected without a pointer), run when, delayed after, give up after, max runtime,
 * retries and step actions, with the step's issues from the client check and the server. */
import React, { useEffect, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Multiselect from '@splunk/react-ui/Multiselect';
import Select from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';
import TextArea from '@splunk/react-ui/TextArea';
import Heading from '@splunk/react-ui/Heading';
import StaticContent from '@splunk/react-ui/StaticContent';
import Typography from '@splunk/react-ui/Typography';
import type { Destination, Issue, JobDefinition, StepDef } from '../../api/types';
import ActionsEditor from './ActionsEditor';
import { isStepId, parentsOf, RUN_WHEN_PRESETS, runWhenChoice, runWhenPreset, wouldCycle } from './graphLogic';
import { BUILTIN_DEFAULTS, generatedInput } from './previewLogic';
import type { BuilderAction } from './reducer';
import { stepLabel } from './GraphView';

export function formatMinutes(seconds: number): string {
    if (seconds % 3600 === 0 && seconds >= 3600) {
        return `${seconds / 3600} h`;
    }
    return `${Math.round(seconds / 60)} min`;
}

export interface DurationFieldProps {
    id: string;
    label: string;
    /** Seconds, or null/undefined to inherit. */
    value: number | null | undefined;
    /** What an empty field means, in seconds. */
    inherited: number;
    inheritedFrom: string;
    help?: string;
    onChange: (seconds: number | null) => void;
}

const MIN_DURATION_ERROR = 'At least 1 minute.';

/** Whole minutes in the field; seconds in the job. Empty inherits. Zero is refused (a
 * give-up of 0 would give up at once): the field shows an error and the job keeps its
 * previous value. */
export function DurationField({ id, label, value, inherited, inheritedFrom, help, onChange }: DurationFieldProps) {
    const shown = value === null || value === undefined ? '' : String(Math.round(value / 60));
    const [zero, setZero] = useState<string | null>(null);
    return (
        <ControlGroup
            label={`${label} (minutes)`}
            labelFor={id}
            labelPosition="top"
            help={zero !== null ? MIN_DURATION_ERROR : help}
            error={zero !== null}
        >
            <Text
                inputId={id}
                value={zero !== null ? zero : shown}
                error={zero !== null}
                placeholder={`${inheritedFrom} (${formatMinutes(inherited)})`}
                onChange={(_e: unknown, { value: text }: { value: string }) => {
                    const digits = text.replace(/[^0-9]/g, '');
                    if (digits !== '' && parseInt(digits, 10) === 0) {
                        setZero(digits);
                        return;
                    }
                    setZero(null);
                    onChange(digits === '' ? null : parseInt(digits, 10) * 60);
                }}
            />
        </ControlGroup>
    );
}

export function IssueList({ issues }: { issues: Issue[] }) {
    return (
        <>
            {issues.map((i) => (
                <Message key={`${i.level}-${i.code}-${i.message}`} type={i.level === 'error' ? 'error' : 'warning'} appearance="default">
                    {i.message}
                </Message>
            ))}
        </>
    );
}

const RUN_WHEN_HELP: Record<string, string> = {
    cron: 'Cron fields, tested against the run’s scheduled time. e.g. * * * * 1-5 for weekdays.',
    expression: 'A token expression, e.g. $daily.resultCount$ > 0.',
};

export interface StepPanelProps {
    job: JobDefinition;
    stepId: string;
    issues: Issue[];
    dispatch: (action: BuilderAction) => void;
    destinations: Destination[];
    onRename?: (from: string, to: string) => void;
    onRequestRemove?: (id: string) => void;
}

export default function StepPanel({ job, stepId, issues, dispatch, destinations, onRename, onRequestRemove }: StepPanelProps) {
    const steps = job.steps || [];
    const edges = job.edges || [];
    const step = steps.find((s) => s.id === stepId);
    const [idDraft, setIdDraft] = useState(stepId);
    useEffect(() => setIdDraft(stepId), [stepId]);
    if (!step) {
        return null;
    }
    const p = `step-${stepId}`;
    const set = (changes: Partial<StepDef>) => dispatch({ type: 'updateStep', id: stepId, changes });
    const onValue = (key: keyof StepDef) => (_e: unknown, { value }: { value: string }) => set({ [key]: value });

    const idError = !isStepId(idDraft)
        ? 'Use a-z, 0-9 and _ (no __), starting with a letter, up to 40 characters.'
        : idDraft !== stepId && steps.some((s) => s.id === idDraft)
          ? 'Another step has this id.'
          : idDraft === 'run'
            ? "'run' is reserved."
            : '';
    const commitId = () => {
        if (idDraft !== stepId && !idError) {
            dispatch({ type: 'updateStep', id: stepId, changes: { id: idDraft } });
            if (onRename) {
                onRename(stepId, idDraft);
            }
        }
    };

    const parents = parentsOf(edges, stepId);
    const candidates = steps.filter((s) => s.id !== stepId && (parents.includes(s.id) || !wouldCycle(edges, s.id, stepId)));
    const onDepends = (_e: unknown, { values }: { values: (string | number | boolean)[] }) => {
        const next = values.map(String);
        next.filter((id) => !parents.includes(id)).forEach((from) => dispatch({ type: 'connect', from, to: stepId }));
        parents.filter((id) => !next.includes(id)).forEach((from) => dispatch({ type: 'disconnect', from, to: stepId }));
    };

    const choice = runWhenChoice(step.run_when);
    const onRunWhen = (_e: unknown, { value }: { value: unknown }) => {
        const key = String(value);
        if (key === 'every') {
            set({ run_when: null });
        } else if (key === 'cron' || key === 'expression') {
            set({ run_when: { kind: key, value: '' } });
        } else {
            set({ run_when: runWhenPreset(key) });
        }
    };

    const defaults = job.defaults || {};
    const inherit = (key: keyof typeof BUILTIN_DEFAULTS) => {
        const d = defaults[key];
        return d === undefined || d === null ? BUILTIN_DEFAULTS[key] : d;
    };
    const retries = step.retries === null || step.retries === undefined ? inherit('retries') : step.retries;

    return (
        <section aria-label={`Step ${stepLabel(step)}`}>
            <Heading level={2}>{stepLabel(step)}</Heading>
            <IssueList issues={issues} />
            <ControlGroup label="Name" labelFor={`${p}-name`} labelPosition="top">
                <Text inputId={`${p}-name`} value={step.name || ''} onChange={onValue('name')} />
            </ControlGroup>
            <ControlGroup
                label="Step id"
                labelFor={`${p}-id`}
                labelPosition="top"
                help={idError || 'Used in tokens such as $' + (idDraft || 'id') + '.sid$.'}
                error={Boolean(idError)}
            >
                <Text
                    inputId={`${p}-id`}
                    value={idDraft}
                    error={Boolean(idError)}
                    onChange={(_e: unknown, { value }: { value: string }) => setIdDraft(value)}
                    onBlur={commitId}
                    onKeyDown={(ev: React.KeyboardEvent) => {
                        if (ev.key === 'Enter') {
                            commitId();
                        }
                    }}
                />
            </ControlGroup>
            <ControlGroup label="Type" labelFor={`${p}-type`} labelPosition="top">
                <Select
                    inputId={`${p}-type`}
                    data-testid="type-select"
                    value={step.type}
                    onChange={(_e: unknown, { value }: { value: unknown }) => set({ type: value as StepDef['type'] })}
                >
                    <Select.Option label="Search" value="inline" />
                    <Select.Option label="Saved search" value="saved_search" />
                    <Select.Option label="From previous steps" value="previous" />
                </Select>
            </ControlGroup>
            {step.type === 'saved_search' ? (
                <ControlGroup
                    label="Saved search"
                    labelFor={`${p}-ref`}
                    labelPosition="top"
                    help="Runs directly if it is your private search with dispatchAs = owner; otherwise through a wrapper, without its own summary indexing and actions."
                >
                    <Text inputId={`${p}-ref`} value={step.saved_search_ref || ''} onChange={onValue('saved_search_ref')} />
                </ControlGroup>
            ) : step.type === 'previous' ? (
                <>
                    <ControlGroup label="Input (added for you)" labelPosition="top">
                        <StaticContent>
                            <Typography as="span" variant="monoBody">
                                {generatedInput(job, stepId)}
                            </Typography>
                        </StaticContent>
                    </ControlGroup>
                    <ControlGroup
                        label="Search"
                        labelFor={`${p}-spl`}
                        labelPosition="top"
                        help="Starts with |. Results of the steps before this one come first."
                    >
                        <TextArea inputId={`${p}-spl`} value={step.spl || ''} rowsMin={4} onChange={onValue('spl')} />
                    </ControlGroup>
                </>
            ) : (
                <ControlGroup label="Search" labelFor={`${p}-spl`} labelPosition="top">
                    <TextArea inputId={`${p}-spl`} value={step.spl || ''} rowsMin={4} onChange={onValue('spl')} />
                </ControlGroup>
            )}
            {step.type !== 'previous' && (
                <>
                    <ControlGroup label="Earliest" labelFor={`${p}-earliest`} labelPosition="top" help="Relative to the run's scheduled time.">
                        <Text inputId={`${p}-earliest`} value={step.earliest || ''} placeholder="-1d@d" onChange={onValue('earliest')} />
                    </ControlGroup>
                    <ControlGroup label="Latest" labelFor={`${p}-latest`} labelPosition="top">
                        <Text inputId={`${p}-latest`} value={step.latest || ''} placeholder="@d" onChange={onValue('latest')} />
                    </ControlGroup>
                </>
            )}
            <ControlGroup label="Depends on" labelFor={`${p}-depends`} labelPosition="top" help="Runs after these steps succeed. Steps that would make a loop are not listed.">
                <Multiselect inputId={`${p}-depends`} values={parents} onChange={onDepends} noOptionsMessage="No other steps can come before this one.">
                    {candidates.map((s) => (
                        <Multiselect.Option key={s.id} label={stepLabel(s)} value={s.id} />
                    ))}
                </Multiselect>
            </ControlGroup>
            <ControlGroup label="Run when" labelFor={`${p}-run-when`} labelPosition="top" help="Matched against the run's scheduled time. Skipped otherwise.">
                <Select inputId={`${p}-run-when`} data-testid="run-when-select" value={choice} onChange={onRunWhen}>
                    <Select.Option label="Every run" value="every" />
                    {RUN_WHEN_PRESETS.map((r) => (
                        <Select.Option key={r.key} label={r.label} value={r.key} />
                    ))}
                    <Select.Option label="Cron" value="cron" />
                    <Select.Option label="Expression" value="expression" />
                </Select>
            </ControlGroup>
            {(choice === 'cron' || choice === 'expression') && (
                <ControlGroup
                    label={choice === 'cron' ? 'Run-when cron' : 'Run-when expression'}
                    labelFor={`${p}-run-when-value`}
                    labelPosition="top"
                    help={RUN_WHEN_HELP[choice]}
                >
                    <Text
                        inputId={`${p}-run-when-value`}
                        value={(step.run_when && step.run_when.value) || ''}
                        placeholder={choice === 'cron' ? '* * * * 1-5' : '$daily.resultCount$ > 0'}
                        onChange={(_e: unknown, { value }: { value: string }) => set({ run_when: { kind: choice, value } })}
                    />
                </ControlGroup>
            )}
            <DurationField
                id={`${p}-delayed`}
                label="Delayed after"
                value={step.delayed_after}
                inherited={inherit('delayed_after')}
                inheritedFrom="Job default"
                help="From the scheduled time. The delay alert fires after this."
                onChange={(v) => set({ delayed_after: v })}
            />
            <DurationField
                id={`${p}-giveup`}
                label="Give up after"
                value={step.give_up_after}
                inherited={inherit('give_up_after')}
                inheritedFrom="Job default"
                help="From the scheduled time."
                onChange={(v) => set({ give_up_after: v })}
            />
            <DurationField
                id={`${p}-maxrt`}
                label="Max runtime"
                value={step.max_runtime}
                inherited={inherit('max_runtime')}
                inheritedFrom="Job default"
                help="Per attempt. Longer counts as a failed attempt."
                onChange={(v) => set({ max_runtime: v })}
            />
            <ControlGroup label="Retries" labelFor={`${p}-retries`} labelPosition="top">
                <Text
                    inputId={`${p}-retries`}
                    value={step.retries === null || step.retries === undefined ? '' : String(step.retries)}
                    placeholder={`Job default (${inherit('retries')})`}
                    onChange={(_e: unknown, { value }: { value: string }) => {
                        const digits = value.replace(/[^0-9]/g, '');
                        set({ retries: digits === '' ? null : parseInt(digits, 10) });
                    }}
                />
            </ControlGroup>
            {retries > 0 && (
                <Message type="warning" appearance="default">
                    A retry runs the search again, which can write duplicates to a summary index.
                </Message>
            )}
            <Heading level={3}>Step actions</Heading>
            <ActionsEditor
                idPrefix={`${p}-action`}
                actions={step.actions || []}
                destinations={destinations}
                onChange={(actions) => set({ actions })}
            />
            {onRequestRemove && (
                <div style={{ marginTop: '12px' }}>
                    <Button appearance="destructive" label="Remove this step" onClick={() => onRequestRemove(stepId)} />
                </div>
            )}
        </section>
    );
}
