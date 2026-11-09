/* Step or job actions: a hook (on_start ... on_delayed) and one of webhook, email, event,
 * start_job or alert_action with its fields (see bin/so/actions.py). Webhooks pick a named
 * destination; the URL and headers stay on the server and are never shown. */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Select from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';
import TextArea from '@splunk/react-ui/TextArea';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Action, AlertAction, AlertActionParam, Destination } from '../../api/types';

const HOOKS: { value: Action['hook']; label: string }[] = [
    { value: 'on_start', label: 'On start' },
    { value: 'on_success', label: 'On success' },
    { value: 'on_failure', label: 'On failure' },
    { value: 'on_complete', label: 'On complete' },
    { value: 'on_delayed', label: 'On delayed' },
];

const TYPES: { value: Action['type']; label: string }[] = [
    { value: 'email', label: 'Email' },
    { value: 'webhook', label: 'Webhook' },
    { value: 'event', label: 'Event to an index' },
    { value: 'start_job', label: 'Start another job' },
    { value: 'alert_action', label: 'Alert action' },
];

/** "key=value" lines to an object, and back. */
export function parsePairs(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    text.split('\n').forEach((line) => {
        const at = line.indexOf('=');
        if (at > 0) {
            out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
        }
    });
    return out;
}

export function formatPairs(pairs: unknown): string {
    if (!pairs || typeof pairs !== 'object') {
        return '';
    }
    return Object.entries(pairs as Record<string, unknown>)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
}

/** name=value lines, kept as typed while the parsed pairs go to the job. */
function PairsField({ id, value, onChange }: { id: string; value: unknown; onChange: (pairs: Record<string, string>) => void }) {
    const [text, setText] = useState(() => formatPairs(value));
    return (
        <TextArea
            inputId={id}
            value={text}
            onChange={(_e: unknown, { value: next }: { value: string }) => {
                setText(next);
                onChange(parsePairs(next));
            }}
        />
    );
}

/** One parameter of an alert action. The default is only a hint: an empty field is left out
 * of the job, so the action uses its own default when it runs. */
function AlertParamField({ id, param, value, onChange }: { id: string; param: AlertActionParam; value: string; onChange: (next: string) => void }) {
    const onValue = (_e: unknown, { value: next }: { value: unknown }) => onChange(String(next ?? ''));
    const label = param.required ? `${param.label} (required)` : param.label;
    let control: React.ReactNode;
    if (param.type === 'select') {
        const named = param.options.find((o) => o.value === param.default);
        const blank = param.default ? `Default (${named ? named.label : param.default})` : 'Not set';
        const options = value && !param.options.some((o) => o.value === value) ? [...param.options, { value, label: value }] : param.options;
        control = (
            <Select inputId={id} value={value} onChange={onValue}>
                <Select.Option label={blank} value="" />
                {options.map((o) => (
                    <Select.Option key={o.value} label={o.label} value={o.value} />
                ))}
            </Select>
        );
    } else if (param.type === 'textarea') {
        control = <TextArea inputId={id} value={value} onChange={onValue} />;
    } else {
        control = <Text inputId={id} value={value} placeholder={param.default} onChange={onValue} />;
    }
    // A text area has no placeholder, so its default goes in the help.
    const hint = param.type === 'textarea' && param.default ? `Default: ${param.default}` : '';
    return (
        <ControlGroup label={label} labelFor={id} labelPosition="top" help={[param.help, hint].filter(Boolean).join(' ') || undefined}>
            {control}
        </ControlGroup>
    );
}

/** The action's listed parameters as fields, and everything else as name=value lines. */
function AlertParams({ id, action, value, onChange }: { id: string; action?: AlertAction; value: unknown; onChange: (params: Record<string, string>) => void }) {
    const params = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const fields = action ? action.params : [];
    const listed = new Set(fields.map((f) => f.name));
    const strings = (keep: (key: string) => boolean) => {
        const out: Record<string, string> = {};
        Object.keys(params)
            .filter(keep)
            .forEach((key) => {
                out[key] = String(params[key]);
            });
        return out;
    };
    const setField = (name: string, next: string) => {
        const { [name]: _old, ...rest } = strings(() => true);
        onChange(next === '' ? rest : { ...rest, [name]: next });
    };
    return (
        <>
            {fields.map((f) => (
                <AlertParamField
                    key={f.name}
                    id={`${id}-${f.name}`}
                    param={f}
                    value={params[f.name] === undefined ? '' : String(params[f.name])}
                    onChange={(next) => setField(f.name, next)}
                />
            ))}
            <ControlGroup label={fields.length ? 'Other parameters' : 'Parameters'} labelFor={id} labelPosition="top" help="One name=value per line.">
                <PairsField
                    key={action ? action.name : ''}
                    id={id}
                    value={strings((key) => !listed.has(key))}
                    onChange={(other) => onChange({ ...strings((key) => listed.has(key)), ...other })}
                />
            </ControlGroup>
        </>
    );
}

export interface ActionsEditorProps {
    actions: Action[];
    onChange: (actions: Action[]) => void;
    destinations: Destination[];
    /** The alert actions to pick from. Null while unknown: the name is typed instead. */
    alertActions?: AlertAction[] | null;
    /** Prefix for input ids, unique per editor on the page. */
    idPrefix: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** One option per alert action. A saved action missing from the list stays selectable. */
export function alertActionOptions(alertActions: AlertAction[], current: string): { value: string; label: string }[] {
    const options = alertActions.map((x) => ({ value: x.name, label: x.label === x.name ? x.name : `${x.label} (${x.name})` }));
    if (current && !alertActions.some((x) => x.name === current)) {
        options.push({ value: current, label: `${current} (not available)` });
    }
    return options;
}

export default function ActionsEditor({ actions, onChange, destinations, alertActions = null, idPrefix }: ActionsEditorProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const update = (i: number, next: Action) => onChange(actions.map((a, j) => (j === i ? next : a)));
    const remove = (i: number) => onChange(actions.filter((_a, j) => j !== i));
    const add = () => onChange([...actions, { hook: 'on_failure', type: 'email', to: '' }]);

    const field = (i: number, a: Action, key: string, label: string, opts: { placeholder?: string; multiline?: boolean; help?: string } = {}) => {
        const id = `${idPrefix}-${i}-${key}`;
        const onValue = (_e: unknown, { value }: { value: string }) => update(i, { ...a, [key]: value });
        return (
            <ControlGroup label={label} labelFor={id} labelPosition="top" help={opts.help || (opts.multiline ? opts.placeholder : undefined)}>
                {opts.multiline ? (
                    <TextArea inputId={id} value={str(a[key])} onChange={onValue} />
                ) : (
                    <Text inputId={id} value={str(a[key])} placeholder={opts.placeholder} onChange={onValue} />
                )}
            </ControlGroup>
        );
    };

    return (
        <div>
            {actions.length === 0 && <p style={{ color: theme.contentColorMuted }}>No actions.</p>}
            {actions.map((a, i) => {
                const hookId = `${idPrefix}-${i}-hook`;
                const typeId = `${idPrefix}-${i}-type`;
                const destId = `${idPrefix}-${i}-destination`;
                const presetId = `${idPrefix}-${i}-preset`;
                const paramsId = `${idPrefix}-${i}-params`;
                const alertId = `${idPrefix}-${i}-action`;
                return (
                    // Keyed by count too, so drafts re-read their action after a removal.
                    <div
                        key={`${actions.length}-${i}`}
                        style={{ borderTop: `1px solid ${theme.borderColor}`, padding: '8px 0', marginBottom: '4px' }}
                    >
                        <ControlGroup label="When" labelFor={hookId} labelPosition="top">
                            <Select
                                inputId={hookId}
                                value={a.hook}
                                onChange={(_e: unknown, { value }: { value: unknown }) => update(i, { ...a, hook: value as Action['hook'] })}
                            >
                                {HOOKS.map((h) => (
                                    <Select.Option key={h.value} label={h.label} value={h.value} />
                                ))}
                            </Select>
                        </ControlGroup>
                        <ControlGroup label="Do" labelFor={typeId} labelPosition="top">
                            <Select
                                inputId={typeId}
                                value={a.type}
                                onChange={(_e: unknown, { value }: { value: unknown }) =>
                                    update(i, { hook: a.hook, type: value as Action['type'] })
                                }
                            >
                                {TYPES.map((t) => (
                                    <Select.Option key={t.value} label={t.label} value={t.value} />
                                ))}
                            </Select>
                        </ControlGroup>
                        {a.type === 'email' && (
                            <>
                                {field(i, a, 'to', 'To', { placeholder: 'ops@example.com' })}
                                {field(i, a, 'subject', 'Subject', { placeholder: '{{job}}: {{hook}}' })}
                                {field(i, a, 'message', 'Message', { placeholder: 'Empty sends the default message.', multiline: true })}
                            </>
                        )}
                        {a.type === 'webhook' && (
                            <>
                                <ControlGroup
                                    label="Destination"
                                    labelFor={destId}
                                    labelPosition="top"
                                    help={destinations.length ? undefined : 'No destinations yet. An admin adds them in Settings.'}
                                >
                                    <Select
                                        inputId={destId}
                                        value={str(a.destination)}
                                        placeholder="Pick a destination"
                                        onChange={(_e: unknown, { value }: { value: unknown }) => update(i, { ...a, destination: String(value) })}
                                    >
                                        {destinations.map((d) => (
                                            <Select.Option key={d.name} label={d.name} value={d.name} />
                                        ))}
                                    </Select>
                                </ControlGroup>
                                <ControlGroup label="Message format" labelFor={presetId} labelPosition="top">
                                    <Select
                                        inputId={presetId}
                                        value={str(a.preset)}
                                        onChange={(_e: unknown, { value }: { value: unknown }) => {
                                            const { preset: _old, ...rest } = a;
                                            update(i, value ? { ...rest, preset: String(value) } : (rest as Action));
                                        }}
                                    >
                                        <Select.Option label="The destination's default" value="" />
                                        <Select.Option label="Slack" value="slack" />
                                        <Select.Option label="Generic JSON" value="generic" />
                                    </Select>
                                </ControlGroup>
                            </>
                        )}
                        {a.type === 'event' && (
                            <>
                                {field(i, a, 'index', 'Index', { placeholder: 'main' })}
                                {field(i, a, 'payload', 'Event', { placeholder: 'Empty writes a JSON summary of the run.', multiline: true })}
                            </>
                        )}
                        {a.type === 'start_job' && field(i, a, 'job', 'Job id', { help: 'The job to start. You need permission to run it.' })}
                        {a.type === 'alert_action' && (
                            <>
                                {alertActions ? (
                                    <ControlGroup
                                        label="Alert action"
                                        labelFor={alertId}
                                        labelPosition="top"
                                        help={alertActions.length ? undefined : 'No alert actions are available to this app.'}
                                    >
                                        <Select
                                            inputId={alertId}
                                            filter
                                            value={str(a.action)}
                                            placeholder="Pick an alert action"
                                            onChange={(_e: unknown, { value }: { value: unknown }) => update(i, { ...a, action: String(value), params: {} })}
                                        >
                                            {alertActionOptions(alertActions, str(a.action)).map((o) => (
                                                <Select.Option key={o.value} label={o.label} value={o.value} />
                                            ))}
                                        </Select>
                                    </ControlGroup>
                                ) : (
                                    field(i, a, 'action', 'Alert action name', {
                                        placeholder: 'e.g. logevent',
                                        help: 'The list of alert actions is not available, so type the name.',
                                    })
                                )}
                                <AlertParams
                                    id={paramsId}
                                    action={alertActions ? alertActions.find((x) => x.name === a.action) : undefined}
                                    value={a.params}
                                    onChange={(params) => update(i, { ...a, params })}
                                />
                            </>
                        )}
                        <Button appearance="subtle" label="Remove action" onClick={() => remove(i)} />
                    </div>
                );
            })}
            <Button appearance="secondary" label="Add action" onClick={add} />
        </div>
    );
}
