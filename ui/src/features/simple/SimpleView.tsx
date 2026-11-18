/* The builder's Simple view: the job as a list of searches run top to bottom, each with
 * "then" items (save to a summary index or lookup, email, post to Slack or Teams, page,
 * write an event), between a "Starts" band (the job's one trigger) and the "If a step
 * fails" and "When done" bands. Edits go to the job through simpleModel, so Flow shows the
 * same job. A job Simple can't edit is shown read only, with what keeps it out and a way
 * to Flow. */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Dropdown from '@splunk/react-ui/Dropdown';
import Message from '@splunk/react-ui/Message';
import Select from '@splunk/react-ui/Select';
import Switch from '@splunk/react-ui/Switch';
import Text from '@splunk/react-ui/Text';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Action, Destination, Issue, Job, JobDefinition, StepOutput } from '../../api/types';
import type { BuilderAction } from '../builder/reducer';
import type { BuilderApi } from '../builder/BuilderPage';
import type { NextSlots } from '../builder/ScheduleEditor';
import type { PreviewView } from '../builder/usePreviews';
import PreviewResult from '../builder/PreviewResult';
import SplEditor from '../builder/SplEditor';
import { IssueList } from '../builder/StepPanel';
import TimeRangeField from '../builder/TimeRangeField';
import TriggerPanel from '../builder/TriggerPanel';
import { ActionFields } from '../builder/ActionsEditor';
import PresetOptions from '../builder/PresetOptions';
import { availableTokens } from '../builder/tokens';
import type { TokenGroup } from '../builder/tokens';
import OutputViewer from '../output/OutputViewer';
import { issuesByStep } from '../builder/graphLogic';
import { addSearch, addThen, moveSearch, OUTPUT_WHENS, readSimple, removeSearch, removeThen, setJobAction, THEN_LABEL, updateThen } from './simpleModel';
import type { Then, ThenKind, When } from './simpleModel';
import { PORT_STYLE } from '../builder/nodeStyle';
import type { PortId } from '../builder/nodeModel';

export interface SimpleViewProps {
    job: JobDefinition;
    dispatch: React.Dispatch<BuilderAction>;
    canEdit: boolean;
    issues: Issue[];
    jobs: Pick<Job, 'id' | 'name'>[];
    destinations: Destination[];
    nextSlots?: NextSlots;
    scheduledTime: number;
    resolveTimeRange: BuilderApi['resolveTimeRange'];
    previews: Record<string, PreviewView | undefined>;
    onPreview?: (stepId: string, opts?: { anyway?: boolean }) => void;
    onCancelPreview: (stepId: string) => void;
    onOpenFlow: () => void;
    onOpenSettings: () => void;
    onRequestRemove: (key: string) => void;
    /** Field names seen in previews, by step: offered as tokens in messages. */
    previewFields?: Record<string, string[]>;
}

const THEN_KINDS: ThenKind[] = ['summary_index', 'lookup', 'email', 'slack', 'teams', 'pagerduty', 'servicenow', 'event'];
const WHEN_ORDER: When[] = ['success', 'condition', 'failure', 'always', 'start', 'delayed'];
const WHEN_PORT: Record<When, PortId> = { success: 'success', failure: 'failure', always: 'always', start: 'start', delayed: 'delayed', condition: 'if' };
const WHEN_LABEL: Record<When, string> = {
    success: 'Succeeds',
    failure: 'Fails',
    always: 'Finishes either way',
    start: 'Starts',
    delayed: 'Is delayed',
    condition: 'If a condition is true',
};
const WHEN_HEADING: Record<When, string> = {
    success: 'When it succeeds',
    failure: 'When it fails',
    always: 'When it finishes either way',
    start: 'When it starts',
    delayed: 'When it is delayed',
    condition: 'If a condition is true',
};
const FAIL_KINDS: Array<{ value: string; label: string }> = [
    { value: '', label: 'Stop (the admin fallback is told)' },
    { value: 'email', label: 'Stop and email' },
    { value: 'slack', label: 'Stop and post to Slack' },
    { value: 'teams', label: 'Stop and post to Teams' },
    { value: 'pagerduty', label: 'Stop and page PagerDuty' },
    { value: 'servicenow', label: 'Stop and open a ServiceNow incident' },
];

function failAction(kind: string): Action | null {
    if (!kind) {
        return null;
    }
    return kind === 'email' ? { hook: 'on_failure', type: 'email', to: '' } : ({ hook: 'on_failure', type: 'webhook', preset: kind, destination: '' } as Action);
}

const kindOfAction = (a: Action | undefined): string => (!a ? '' : a.type === 'email' ? 'email' : String(a.preset || 'slack'));

/** A destination picker for a webhook preset, or an address field for email. */
function Target({ id, action, destinations, onChange, disabled }: { id: string; action: Action; destinations: Destination[]; onChange: (a: Partial<Action>) => void; disabled: boolean }) {
    if (action.type === 'email') {
        return <Text inputId={id} aria-label="Email to" placeholder="ops@example.com" value={String(action.to || '')} disabled={disabled} onChange={(_e: unknown, { value }: { value: string }) => onChange({ to: value })} />;
    }
    if (action.type === 'event') {
        return <Text inputId={id} aria-label="Index" value={String(action.index || '')} disabled={disabled} onChange={(_e: unknown, { value }: { value: string }) => onChange({ index: value })} />;
    }
    const fitting = destinations.filter((d) => d.preset === action.preset);
    return (
        <Select inputId={id} aria-label="Destination" value={String(action.destination || '')} disabled={disabled} onChange={(_e: unknown, { value }: { value: unknown }) => onChange({ destination: String(value) })}>
            <Select.Option label={fitting.length ? 'Pick a destination' : 'No destination yet (ask an admin)'} value="" />
            {fitting.map((d) => (
                <Select.Option key={d.name} label={d.name} value={d.name} />
            ))}
        </Select>
    );
}

export default function SimpleView(p: SimpleViewProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const { job, dispatch } = p;
    const simple = readSimple(job);
    const readOnly = !p.canEdit || simple.reasons.length > 0;
    const [open, setOpen] = useState<Record<string, boolean>>(() => (simple.chain[0] ? { [simple.chain[0].step.id]: true } : {}));
    const set = (next: JobDefinition, key?: string) => dispatch({ type: 'setJob', job: next, key });
    const byStep = issuesByStep(p.issues);
    const line = `1px solid ${theme.borderColorWeak || theme.borderColor}`;
    const card: React.CSSProperties = { border: line, borderRadius: '8px', background: theme.backgroundColorSection || theme.backgroundColor, padding: '12px 14px' };
    const label: React.CSSProperties = { fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, color: theme.contentColorMuted, minWidth: '110px' };
    const trigger = (job.triggers || [])[0];
    const firstId = simple.chain[0] ? simple.chain[0].step.id : null;

    const addTrigger = (kind: 'trigger_cron' | 'trigger_completion') => {
        const t = kind === 'trigger_cron' ? { type: 'cron', cron: '0 6 * * *', enabled: true } : { type: 'completion', job: '', on: 'success' as const, enabled: true };
        set({ ...job, triggers: [{ ...t, steps: firstId ? [firstId] : [] }] });
    };

    const failure = simple.failure >= 0 ? (job.actions || [])[simple.failure] : undefined;
    const whenDone = simple.whenDone >= 0 ? (job.actions || [])[simple.whenDone] : undefined;

    return (
        <div data-testid="simple-view" style={{ display: 'grid', gap: '12px', maxWidth: '920px' }}>
            {simple.reasons.length > 0 && (
                <Message type="warning" appearance="fill">
                    {`This job uses things Simple can't change: ${simple.reasons.join('; ')}. `}
                    <Button appearance="secondary" label="Edit in Flow" onClick={p.onOpenFlow} />
                </Message>
            )}

            <section aria-label="Starts" style={{ ...card, display: 'grid', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={label}>Starts</span>
                    {!trigger && (
                        <>
                            <span style={{ color: theme.contentColorMuted }}>Only when you run it.</span>
                            {!readOnly && <Button appearance="secondary" label="Add a schedule" onClick={() => addTrigger('trigger_cron')} />}
                            {!readOnly && <Button appearance="subtle" label="Start after another job" onClick={() => addTrigger('trigger_completion')} />}
                        </>
                    )}
                </div>
                {trigger && (
                    <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                        <TriggerPanel job={job} index={0} jobs={p.jobs} nextSlots={p.nextSlots} dispatch={dispatch} onRequestRemove={p.onRequestRemove} onOpenSettings={p.onOpenSettings} />
                    </fieldset>
                )}
            </section>

            <ol aria-label="Searches" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
                {simple.chain.map(({ step, thens }, i) => {
                    const isOpen = Boolean(open[step.id]);
                    const pre = `simple-${step.id}`;
                    const upd = (changes: Partial<typeof step>) => dispatch({ type: 'updateStep', id: step.id, changes });
                    const preview = p.previews[step.id];
                    return (
                        <li key={step.id} style={{ display: 'grid', gap: '6px' }}>
                            {i > 0 && <div style={{ color: theme.contentColorMuted, fontSize: '12px', paddingLeft: '14px' }}>↓ then, when it succeeds</div>}
                            <div style={card}>
                                <button
                                    type="button"
                                    aria-expanded={isOpen}
                                    onClick={() => setOpen((o) => ({ ...o, [step.id]: !isOpen }))}
                                    style={{ display: 'flex', gap: '10px', alignItems: 'center', width: '100%', background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
                                >
                                    <span
                                        aria-hidden
                                        style={{ width: '24px', height: '24px', flex: 'none', borderRadius: '50%', border: `2px solid ${theme.categoricalA2Strong || theme.focusColor}`, display: 'grid', placeItems: 'center', fontSize: '12px', fontWeight: 700 }}
                                    >
                                        {i + 1}
                                    </span>
                                    <span style={{ minWidth: 0, flex: 1 }}>
                                        <span style={{ display: 'block', fontWeight: 600 }}>{step.name || step.id}</span>
                                        <span style={{ display: 'block', fontFamily: theme.monoFontFamily, fontSize: '12px', color: theme.contentColorMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {(step.spl || step.saved_search_ref || '').replace(/\s*\n\s*/g, ' ')}
                                        </span>
                                    </span>
                                    {(byStep[step.id] || []).some((x) => x.level === 'error') && <span style={{ color: theme.statusColorHigh, fontSize: '12px' }}>needs fixing</span>}
                                    <span aria-hidden>{isOpen ? '▾' : '▸'}</span>
                                </button>
                                {isOpen && (
                                    <fieldset disabled={readOnly} style={{ border: 0, margin: '10px 0 0', padding: '10px 0 0', borderTop: line, minWidth: 0, display: 'grid', gap: '4px' }}>
                                        <IssueList issues={byStep[step.id] || []} />
                                        <ControlGroup label="Name" labelFor={`${pre}-name`} labelPosition="top">
                                            <Text inputId={`${pre}-name`} value={step.name || ''} onChange={(_e: unknown, { value }: { value: string }) => upd({ name: value })} />
                                        </ControlGroup>
                                        <ControlGroup label="Searches" labelFor={`${pre}-type`} labelPosition="top">
                                            <Select
                                                inputId={`${pre}-type`}
                                                value={step.type}
                                                onChange={(_e: unknown, { value }: { value: unknown }) =>
                                                    upd(value === 'previous' ? { type: 'previous', spl: step.spl && step.spl.trim().startsWith('|') ? step.spl : '| stats count', earliest: undefined, latest: undefined } : { type: 'inline', earliest: step.earliest || '-24h', latest: step.latest || 'now' })
                                                }
                                            >
                                                <Select.Option label="Its own data" value="inline" />
                                                {i > 0 && <Select.Option label="The results of the search above" value="previous" />}
                                                {step.type === 'saved_search' && <Select.Option label="A saved search (edit in Flow)" value="saved_search" />}
                                            </Select>
                                        </ControlGroup>
                                        {step.type !== 'saved_search' && (
                                            <ControlGroup label="Search" labelFor={`${pre}-spl`} labelPosition="top" help={step.type === 'previous' ? 'Starts with |; works on the rows of the search above.' : undefined}>
                                                <SplEditor inputId={`${pre}-spl`} value={step.spl || ''} readOnly={readOnly} onChange={(value) => upd({ spl: value })} />
                                            </ControlGroup>
                                        )}
                                        {step.type === 'inline' && (
                                            <TimeRangeField
                                                idPrefix={pre}
                                                earliest={step.earliest}
                                                latest={step.latest}
                                                scheduledTime={p.scheduledTime}
                                                timezone={job.timezone}
                                                resolve={p.resolveTimeRange}
                                                onChange={(earliest, latest) => upd({ earliest, latest })}
                                            />
                                        )}
                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                                            {p.onPreview && <Button appearance="secondary" label="Preview" onClick={() => p.onPreview && p.onPreview(step.id)} />}
                                            {!readOnly && <Button appearance="subtle" label="Move up" disabled={i === 0} onClick={() => set(moveSearch(job, step.id, -1))} />}
                                            {!readOnly && <Button appearance="subtle" label="Move down" disabled={i === simple.chain.length - 1} onClick={() => set(moveSearch(job, step.id, 1))} />}
                                            <span style={{ flex: 1 }} />
                                            {!readOnly && <Button appearance="destructive" label="Remove search" onClick={() => set(removeSearch(job, step.id))} />}
                                        </div>
                                        {p.onPreview && (
                                            <PreviewResult preview={preview} onCancel={() => p.onCancelPreview(step.id)} onAnyway={() => p.onPreview && p.onPreview(step.id, { anyway: true })} />
                                        )}
                                    </fieldset>
                                )}
                                <ThenList
                                    stepId={step.id}
                                    thens={thens}
                                    job={job}
                                    readOnly={readOnly}
                                    destinations={p.destinations}
                                    set={set}
                                    byStep={byStep}
                                    tokenGroups={availableTokens(job, step.id, p.previewFields || {})}
                                />
                            </div>
                        </li>
                    );
                })}
            </ol>
            {!readOnly && (
                <button
                    type="button"
                    onClick={() => {
                        const added = addSearch(job);
                        set(added.job);
                        setOpen({ [added.id]: true });
                    }}
                    style={{ border: `1px dashed ${theme.borderColorStrong || theme.borderColor}`, borderRadius: '8px', background: 'none', padding: '10px', color: theme.focusColor, fontWeight: 600, cursor: 'pointer', font: 'inherit' }}
                >
                    + Add search
                </button>
            )}

            <section aria-label="If a step fails" style={{ ...card, display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={label}>If any step fails</span>
                <div style={{ minWidth: '240px' }}>
                    <Select
                        inputId="simple-fail"
                        aria-label="If a step fails"
                        value={kindOfAction(failure)}
                        disabled={readOnly}
                        onChange={(_e: unknown, { value }: { value: unknown }) => set(setJobAction(job, simple.failure, failAction(String(value))))}
                    >
                        {FAIL_KINDS.map((k) => (
                            <Select.Option key={k.value} label={k.label} value={k.value} />
                        ))}
                    </Select>
                </div>
                {failure && (
                    <div style={{ minWidth: '220px', flex: '1 1 220px' }}>
                        <Target id="simple-fail-target" action={failure} destinations={p.destinations} disabled={readOnly} onChange={(c) => set(setJobAction(job, simple.failure, { ...failure, ...c } as Action), 'fail-target')} />
                    </div>
                )}
            </section>

            <section aria-label="When done" style={{ ...card, display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={label}>When done</span>
                <div style={{ minWidth: '260px' }}>
                    <Select
                        inputId="simple-done"
                        aria-label="When done"
                        value={whenDone ? String(whenDone.job || '') : ''}
                        disabled={readOnly}
                        onChange={(_e: unknown, { value }: { value: unknown }) =>
                            set(setJobAction(job, simple.whenDone, value ? ({ hook: 'on_success', type: 'start_job', job: String(value) } as Action) : null))
                        }
                    >
                        <Select.Option label="Nothing more" value="" />
                        {p.jobs
                            .filter((j) => j.id !== job.id)
                            .map((j) => (
                                <Select.Option key={j.id} label={`Start job “${j.name}”`} value={j.id} />
                            ))}
                    </Select>
                </div>
            </section>
        </div>
    );
}

function ThenList({
    stepId,
    thens,
    job,
    readOnly,
    destinations,
    set,
    byStep,
    tokenGroups,
}: {
    stepId: string;
    thens: Then[];
    job: JobDefinition;
    readOnly: boolean;
    destinations: Destination[];
    set: (next: JobDefinition, key?: string) => void;
    byStep: Record<string, Issue[]>;
    tokenGroups: TokenGroup[];
}) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [shown, setShown] = useState<Record<string, boolean>>({});
    const row: React.CSSProperties = {
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '6px 10px',
        border: `1px dashed ${theme.borderColorStrong || theme.borderColor}`,
        borderRadius: '6px',
    };
    const renderRow = (t: Then) => {
        const key = 'stepId' in t ? `out-${t.stepId}` : `act-${t.index}`;
        const id = `simple-${stepId}-${key}`;
        const outputField = (out: StepOutput) =>
            out.kind === 'summary_index' ? (
                <Text inputId={id} aria-label="Summary index" value={out.index} disabled={readOnly} onChange={(_e: unknown, { value }: { value: string }) => set(updateThen(job, stepId, t, { output: { ...out, index: value } }), id)} />
            ) : (
                <Text inputId={id} aria-label="Lookup" placeholder="my_lookup.csv" value={out.name} disabled={readOnly} onChange={(_e: unknown, { value }: { value: string }) => set(updateThen(job, stepId, t, { output: { ...out, name: value } }), id)} />
            );
        const issues = 'stepId' in t ? byStep[t.stepId] || [] : [];
        return (
            <div key={key} data-testid="simple-then" style={{ display: 'grid', gap: '2px' }}>
                <div style={row}>
                    <span aria-hidden style={{ color: theme.contentColorMuted }}>→</span>
                    <strong style={{ minWidth: '150px' }}>{THEN_LABEL[t.kind]}</strong>
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                        {'stepId' in t ? (
                            outputField(t.output)
                        ) : (
                            <Target id={id} action={t.action} destinations={destinations} disabled={readOnly} onChange={(c) => set(updateThen(job, stepId, t, { action: c }), id)} />
                        )}
                    </div>
                    {t.when === 'condition' && (
                        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                            <Text
                                inputId={`${id}-condition`}
                                aria-label="Condition"
                                value={t.condition || ''}
                                disabled={readOnly}
                                onChange={(_e: unknown, { value }: { value: string }) => set(updateThen(job, stepId, t, { condition: value }), `${id}-condition`)}
                            />
                        </div>
                    )}
                    {t.when === 'success' && (
                        <Switch appearance="checkbox" selected={t.onlyIfResults} disabled={readOnly} onClick={() => set(updateThen(job, stepId, t, { onlyIfResults: !t.onlyIfResults }))}>
                            Only if it found results
                        </Switch>
                    )}
                    <Button
                        appearance="subtle"
                        label={shown[key] ? 'Hide settings' : 'Settings'}
                        aria-expanded={Boolean(shown[key])}
                        aria-label={`${shown[key] ? 'Hide settings of' : 'Settings of'} ${THEN_LABEL[t.kind]}`}
                        onClick={() => setShown((s) => ({ ...s, [key]: !s[key] }))}
                    />
                    {!readOnly && <Button appearance="subtle" label="Remove" aria-label={`Remove ${THEN_LABEL[t.kind]}`} onClick={() => set(removeThen(job, stepId, t))} />}
                </div>
                {shown[key] && (
                    <fieldset
                        disabled={readOnly}
                        data-testid="simple-then-settings"
                        style={{ border: `1px solid ${theme.borderColorWeak || theme.borderColor}`, borderRadius: '6px', margin: '0 0 0 24px', padding: '8px 12px', minWidth: 0 }}
                    >
                        <ThenSettings then={t} stepId={stepId} job={job} idPrefix={id} destinations={destinations} tokenGroups={tokenGroups} set={set} />
                    </fieldset>
                )}
                {issues.length > 0 && <IssueList issues={issues} />}
            </div>
        );
    };
    const sections = WHEN_ORDER.map((w) => ({ w, items: thens.filter((x) => x.when === w) })).filter((s) => s.items.length > 0);
    return (
        <div style={{ display: 'grid', gap: '6px', marginTop: '10px' }}>
            {sections.map(({ w, items }) => (
                <React.Fragment key={w}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', fontWeight: 600, color: theme.contentColorMuted, marginTop: '4px' }}>
                        <span aria-hidden style={{ color: theme[PORT_STYLE[WHEN_PORT[w]].colorToken], width: '14px', textAlign: 'center' }}>
                            {PORT_STYLE[WHEN_PORT[w]].glyph}
                        </span>
                        {WHEN_HEADING[w]}
                    </div>
                    {items.map(renderRow)}
                </React.Fragment>
            ))}
            {!readOnly && <AddThen onAdd={(kind, when) => set(addThen(job, stepId, kind, when))} />}
        </div>
    );
}

/** "+ Add…": pick when (the Flow editor's When list) and then what happens. */
function AddThen({ onAdd }: { onAdd: (kind: ThenKind, when: When) => void }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [open, setOpen] = useState(false);
    const [when, setWhen] = useState<When>('success');
    const kinds = THEN_KINDS.filter((k) => !(k === 'summary_index' || k === 'lookup') || OUTPUT_WHENS.includes(when));
    const option = (active: boolean): React.CSSProperties => ({
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        width: '100%',
        textAlign: 'left',
        border: 0,
        borderRadius: '4px',
        padding: '6px 10px',
        font: 'inherit',
        cursor: 'pointer',
        color: theme.contentColorDefault,
        background: active ? theme.backgroundColorHover || theme.backgroundColorSection : 'transparent',
    });
    const muted = { color: theme.contentColorMuted, fontSize: '12px' };
    return (
        <div>
            <Dropdown
                open={open}
                onRequestOpen={() => setOpen(true)}
                onRequestClose={() => setOpen(false)}
                toggle={<Button appearance="subtle" label="+ Add…" isMenu />}
            >
                <div data-testid="simple-add" style={{ display: 'flex', gap: '4px', padding: '6px', flexWrap: 'wrap', maxWidth: '560px' }}>
                    <div role="radiogroup" aria-label="When this search" style={{ flex: '1 1 240px', minWidth: 0 }}>
                        <div style={{ ...muted, padding: '4px 10px' }}>When this search…</div>
                        {WHEN_ORDER.map((w) => (
                            <button key={w} type="button" role="radio" aria-checked={when === w} onClick={() => setWhen(w)} style={option(when === w)}>
                                <span aria-hidden style={{ color: theme[PORT_STYLE[WHEN_PORT[w]].colorToken], width: '16px', textAlign: 'center' }}>
                                    {PORT_STYLE[WHEN_PORT[w]].glyph}
                                </span>
                                <span style={{ flex: 1 }}>{WHEN_LABEL[w]}</span>
                                {!OUTPUT_WHENS.includes(w) && <span style={muted}>messages only</span>}
                            </button>
                        ))}
                    </div>
                    <div role="menu" aria-label="Then" style={{ flex: '1 1 220px', minWidth: 0, borderLeft: `1px solid ${theme.borderColorWeak || theme.borderColor}` }}>
                        <div style={{ ...muted, padding: '4px 10px' }}>…then</div>
                        {kinds.map((k) => (
                            <button
                                key={k}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    onAdd(k, when);
                                    setOpen(false);
                                }}
                                style={option(false)}
                            >
                                {THEN_LABEL[k]}
                            </button>
                        ))}
                    </div>
                </div>
            </Dropdown>
        </div>
    );
}

/** Every setting of one "then": the action's own fields (subject and message for email,
 * body options for webhooks, payload for events), or the output's index, source, run id
 * marker or append; and View output for what it wrote. */
function ThenSettings({
    then: t,
    stepId,
    job,
    idPrefix,
    destinations,
    tokenGroups,
    set,
}: {
    then: Then;
    stepId: string;
    job: JobDefinition;
    idPrefix: string;
    destinations: Destination[];
    tokenGroups: TokenGroup[];
    set: (next: JobDefinition, key?: string) => void;
}) {
    if ('stepId' in t) {
        const out = t.output;
        const put = (next: StepOutput, key: string) => set(updateThen(job, stepId, t, { output: next }), `${idPrefix}-${key}`);
        return (
            <>
                {out.kind === 'summary_index' ? (
                    <>
                        <ControlGroup label="Source" labelFor={`${idPrefix}-source`} labelPosition="top" help="Optional; lets you find these events later, as in source=daily.">
                            <Text inputId={`${idPrefix}-source`} value={out.source || ''} onChange={(_e: unknown, { value }: { value: string }) => put({ ...out, source: value }, 'source')} />
                        </ControlGroup>
                        <Switch appearance="toggle" selected={out.add_run_id !== false} onClick={() => put({ ...out, add_run_id: out.add_run_id === false }, 'runid')}>
                            Add the run id (so_run) to each event
                        </Switch>
                    </>
                ) : (
                    <Switch appearance="toggle" selected={Boolean(out.append)} onClick={() => put({ ...out, append: !out.append }, 'append')}>
                        Append instead of replacing the lookup
                    </Switch>
                )}
                <div style={{ marginTop: '8px' }}>
                    <OutputViewer target={{ step_id: t.stepId }} name={THEN_LABEL[t.kind]} job={job} />
                </div>
            </>
        );
    }
    const action = t.action;
    return (
        <>
            <ActionFields
                action={action}
                idPrefix={idPrefix}
                destinations={destinations}
                tokenGroups={tokenGroups}
                onChange={(next) => set(updateThen(job, stepId, t, { action: next }), `${idPrefix}-fields`)}
            />
            {action.type === 'webhook' && (
                <PresetOptions
                    preset={action.preset}
                    options={action.options}
                    idPrefix={`${idPrefix}-options`}
                    onChange={(options) => set(updateThen(job, stepId, t, { action: { options } }), `${idPrefix}-options`)}
                />
            )}
            {(action.type === 'email' || action.type === 'event') && (
                <div style={{ marginTop: '8px' }}>
                    <OutputViewer target={{ action: { scope: stepId, index: t.index } }} name={THEN_LABEL[t.kind]} job={job} label={action.type === 'email' ? 'View sent emails' : 'View output'} />
                </div>
            )}
        </>
    );
}
