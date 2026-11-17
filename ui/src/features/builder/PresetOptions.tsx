/* Per-action options of the PagerDuty and ServiceNow presets (bin/so/presets.py PRESET_OPTIONS).
 * A default choice is not stored: choosing it removes the key, and no options removes `options`. */
import React from 'react';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Select from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';

export interface PresetOptionsProps {
    preset: unknown;
    options: Record<string, string> | undefined;
    /** The new options; undefined when none are left. */
    onChange: (options: Record<string, string> | undefined) => void;
    /** Prefix for input ids, unique on the page. */
    idPrefix?: string;
}

const SEVERITY = [
    { value: '', label: 'Default (Error, or Warning when delayed or late)' },
    { value: 'critical', label: 'Critical' },
    { value: 'error', label: 'Error' },
    { value: 'warning', label: 'Warning' },
    { value: 'info', label: 'Info' },
];
const LEVELS = [
    { value: '1', label: '1 High' },
    { value: '2', label: '2 Medium' },
    { value: '3', label: '3 Low' },
];
/** ServiceNow's urgency and impact when the action sets none. */
const LEVEL_DEFAULT = '2';
const GROUP_MAX = 100;

export default function PresetOptions({ preset, options, onChange, idPrefix = 'preset-options' }: PresetOptionsProps) {
    const current = options || {};
    const set = (key: string, value: string, fallback: string) => {
        const { [key]: _old, ...rest } = current;
        const next = value === fallback ? rest : { ...rest, [key]: value };
        onChange(Object.keys(next).length ? next : undefined);
    };
    const select = (key: string, label: string, choices: { value: string; label: string }[], fallback: string) => {
        const id = `${idPrefix}-${key}`;
        return (
            <ControlGroup label={label} labelFor={id} labelPosition="top">
                <Select inputId={id} value={current[key] ?? fallback} onChange={(_e: unknown, { value }: { value: unknown }) => set(key, String(value), fallback)}>
                    {choices.map((c) => (
                        <Select.Option key={c.value} label={c.label} value={c.value} />
                    ))}
                </Select>
            </ControlGroup>
        );
    };

    if (preset === 'pagerduty') {
        return select('severity', 'Severity', SEVERITY, '');
    }
    if (preset === 'servicenow') {
        const groupId = `${idPrefix}-assignment_group`;
        return (
            <>
                {select('urgency', 'Urgency', LEVELS, LEVEL_DEFAULT)}
                {select('impact', 'Impact', LEVELS, LEVEL_DEFAULT)}
                <ControlGroup label="Assignment group" labelFor={groupId} labelPosition="top" help={`Optional. At most ${GROUP_MAX} characters.`}>
                    <Text
                        inputId={groupId}
                        value={current.assignment_group || ''}
                        maxLength={GROUP_MAX}
                        onChange={(_e: unknown, { value }: { value: string }) => set('assignment_group', value, '')}
                    />
                </ControlGroup>
            </>
        );
    }
    return null;
}
