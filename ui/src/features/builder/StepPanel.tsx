/* The side panel for the selected step: search, time range, "Depends on" (so steps can be
 * connected without a pointer), run when, delayed after, give up after, max runtime and
 * retries, with the step's issues from the client check and the server. Its actions are
 * nodes of their own. */
import React, { useEffect, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Multiselect from '@splunk/react-ui/Multiselect';
import NumberInput from '@splunk/react-ui/Number';
import Select from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';
import Heading from '@splunk/react-ui/Heading';
import StaticContent from '@splunk/react-ui/StaticContent';
import Typography from '@splunk/react-ui/Typography';
import type { Issue, JobDefinition, StepDef } from '../../api/types';
import { DURATION_UNITS, DurationUnit, formatDuration, splitDuration, toSeconds } from './duration';
import type { BuilderApi } from './BuilderPage';
import TimeRangeField from './TimeRangeField';
import { TokenInput } from './InsertToken';
import { availableTokens } from './tokens';
import LearnMore from '../../components/LearnMore';
import PreviewResult from './PreviewResult';
import type { PreviewView } from './usePreviews';
import { isStepId, parentsOf, RUN_WHEN_PRESETS, runWhenChoice, runWhenPreset, wouldCycle } from './graphLogic';
import { BUILTIN_DEFAULTS, generatedInput } from './previewLogic';
import type { BuilderAction } from './reducer';
import { stepLabel } from './GraphView';

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

const UNIT_LABELS: Record<DurationUnit, string> = { minutes: 'Minutes', hours: 'Hours', days: 'Days' };

/** An amount and a unit in the field; seconds in the job. Empty inherits. Zero is refused (a
 * give-up of 0 would give up at once): the field shows an error and the job keeps its
 * previous value. A value that is not whole minutes keeps its seconds until edited. */
export function DurationField({ id, label, value, inherited, inheritedFrom, help, onChange }: DurationFieldProps) {
    const initial = value === null || value === undefined ? null : splitDuration(value);
    const [unit, setUnit] = useState<DurationUnit>(initial ? initial.unit : 'minutes');
    const [amount, setAmount] = useState<number | undefined>(initial ? initial.amount : undefined);
    const [zero, setZero] = useState(false);
    // What this field last sent up, so only an outside change resets the amount and unit.
    const sent = useRef<number | null | undefined>(value);
    useEffect(() => {
        if (value === sent.current) {
            return;
        }
        sent.current = value;
        const next = value === null || value === undefined ? null : splitDuration(value);
        setAmount(next ? next.amount : undefined);
        if (next) {
            setUnit(next.unit);
        }
        setZero(false);
    }, [value]);

    const emit = (seconds: number | null) => {
        sent.current = seconds;
        onChange(seconds);
    };

    return (
        <ControlGroup
            label={label}
            labelFor={id}
            labelPosition="top"
            help={zero ? MIN_DURATION_ERROR : help}
            error={zero}
            controlsLayout="fillJoin"
        >
            <NumberInput
                inputId={id}
                min={0}
                step={1}
                roundTo={0}
                value={amount}
                error={zero}
                {...{ placeholder: `${inheritedFrom} (${formatDuration(inherited)})` }}
                onChange={(_e: unknown, { value: next }: { value?: number }) => {
                    if (next === undefined || Number.isNaN(next)) {
                        setZero(false);
                        setAmount(undefined);
                        emit(null);
                        return;
                    }
                    setAmount(next);
                    if (next < 1) {
                        setZero(true);
                        return;
                    }
                    setZero(false);
                    emit(toSeconds(next, unit));
                }}
            />
            <Select
                aria-label={`${label} unit`}
                value={unit}
                onChange={(_e: unknown, { value: next }: { value: unknown }) => {
                    const u = next as DurationUnit;
                    setUnit(u);
                    if (amount !== undefined && amount >= 1) {
                        emit(toSeconds(amount, u));
                    }
                }}
            >
                {DURATION_UNITS.map((u) => (
                    <Select.Option key={u} label={UNIT_LABELS[u]} value={u} />
                ))}
            </Select>
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
    onRename?: (from: string, to: string) => void;
    onRequestRemove?: (id: string) => void;
    /** Shows "Preview step" and the step's preview result when given. */
    onPreview?: (stepId: string, opts?: { anyway?: boolean }) => void;
    onCancelPreview?: (stepId: string) => void;
    preview?: PreviewView;
    /** The preview's "as if scheduled at" time, epoch seconds. */
    scheduledTime: number;
    resolveTimeRange: BuilderApi['resolveTimeRange'];
    /** Field names of each step's current preview, for the first-row tokens. */
    previewFields?: Record<string, string[]>;
}

export default function StepPanel({
    job,
    stepId,
    issues,
    dispatch,
    onRename,
    onRequestRemove,
    onPreview,
    onCancelPreview,
    preview,
    scheduledTime,
    resolveTimeRange,
    previewFields = {},
}: StepPanelProps) {
    const steps = job.steps || [];
    const edges = job.edges || [];
    const step = steps.find((s) => s.id === stepId);
    const [idDraft, setIdDraft] = useState(stepId);
    useEffect(() => setIdDraft(stepId), [stepId]);
    if (!step) {
        return null;
    }
    const p = `step-${stepId}`;
    const tokenGroups = availableTokens(job, stepId, previewFields);
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
                help={idError || 'Short name used in tokens, such as $' + (idDraft || 'id') + '.sid$. Lowercase letters, numbers and _.'}
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
            <ControlGroup
                label="Type"
                labelFor={`${p}-type`}
                labelPosition="top"
                help={step.type === 'previous' ? 'Works on the rows the steps before it found, with no search of its own.' : undefined}
            >
                <Select
                    inputId={`${p}-type`}
                    data-testid="type-select"
                    value={step.type}
                    onChange={(_e: unknown, { value }: { value: unknown }) => set({ type: value as StepDef['type'] })}
                >
                    <Select.Option label="Search" value="inline" />
                    <Select.Option label="Saved search" value="saved_search" />
                    <Select.Option label="Results of earlier steps" value="previous" />
                </Select>
            </ControlGroup>
            {step.type === 'previous' && <LearnMore anchor="results-of-earlier-steps" topic="Results of earlier steps" />}
            {step.type === 'saved_search' ? (
                <>
                <ControlGroup
                    label="Saved search"
                    labelFor={`${p}-ref`}
                    labelPosition="top"
                    help="If this is your own private search, it runs as saved. Otherwise its own alerts and summary indexing don't run; add collect to the step if you need them."
                >
                    <Text inputId={`${p}-ref`} value={step.saved_search_ref || ''} onChange={onValue('saved_search_ref')} />
                </ControlGroup>
                <LearnMore anchor="steps" topic="saved search steps" />
                </>
            ) : (
                <>
                    {step.type === 'previous' && (
                        <ControlGroup label="Reads results from" labelPosition="top">
                            <StaticContent>
                                <Typography as="span" variant="monoBody">
                                    {generatedInput(job, stepId)}
                                </Typography>
                            </StaticContent>
                        </ControlGroup>
                    )}
                    <ControlGroup
                        label="Search"
                        labelFor={`${p}-spl`}
                        labelPosition="top"
                        help={step.type === 'previous' ? 'Starts with |. Results of the steps before this one come first.' : undefined}
                    >
                        <TokenInput
                            inputId={`${p}-spl`}
                            fieldLabel="Search"
                            multiline
                            value={step.spl || ''}
                            rowsMin={4}
                            groups={tokenGroups}
                            onValue={(spl) => set({ spl })}
                        />
                    </ControlGroup>
                    <LearnMore anchor="tokens" topic="tokens" />
                </>
            )}
            {onPreview && (
                <div style={{ marginBottom: '12px' }}>
                    <Button appearance="secondary" label="Preview step" onClick={() => onPreview(stepId)} />
                    <PreviewResult
                        preview={preview}
                        onCancel={() => onCancelPreview && onCancelPreview(stepId)}
                        onAnyway={() => onPreview(stepId, { anyway: true })}
                    />
                </div>
            )}
            {step.type !== 'previous' && (
                <TimeRangeField
                    idPrefix={p}
                    earliest={step.earliest}
                    latest={step.latest}
                    scheduledTime={scheduledTime}
                    timezone={job.timezone}
                    resolve={resolveTimeRange}
                    onChange={(earliest, latest) => set({ earliest, latest })}
                />
            )}
            <ControlGroup label="Depends on" labelFor={`${p}-depends`} labelPosition="top" help="Starts after these steps succeed. Steps that would make a loop aren't listed.">
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
            {onRequestRemove && (
                <div style={{ marginTop: '12px' }}>
                    <Button appearance="destructive" label="Remove this step" onClick={() => onRequestRemove(stepId)} />
                </div>
            )}
        </section>
    );
}
