/* Declared parameters: name, label, type, default, enum values and an optional regex.
 * Steps use them as $run.param.<name>$. */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Select from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { ParamDecl, ParamType } from '../../api/types';

export const PARAM_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

function ValuesField({ id, values, onChange }: { id: string; values: string[]; onChange: (values: string[]) => void }) {
    const [text, setText] = useState(values.join(', '));
    return (
        <Text
            inputId={id}
            value={text}
            placeholder="a, b, c"
            onChange={(_e: unknown, { value }: { value: string }) => {
                setText(value);
                onChange(value.split(',').map((v) => v.trim()).filter(Boolean));
            }}
        />
    );
}

export interface ParamsTabProps {
    params: ParamDecl[];
    onChange: (params: ParamDecl[]) => void;
}

export default function ParamsTab({ params, onChange }: ParamsTabProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const update = (i: number, changes: Partial<ParamDecl>) =>
        onChange(
            params.map((p, j) => {
                if (j !== i) {
                    return p;
                }
                const next = { ...p, ...changes };
                (Object.keys(next) as (keyof ParamDecl)[]).forEach((k) => {
                    if (next[k] === '' && k !== 'name') {
                        delete next[k];
                    }
                });
                if (next.type !== 'enum') {
                    delete next.values;
                }
                return next;
            })
        );
    return (
        <div style={{ maxWidth: '640px' }}>
            <p style={{ color: theme.contentColorMuted }}>Steps read a parameter as $run.param.name$. Run now asks for them.</p>
            {params.map((p, i) => {
                const id = `param-${params.length}-${i}`;
                const nameError = p.name && !PARAM_NAME_RE.test(p.name) ? 'Letters, digits and _, starting with a letter.' : undefined;
                return (
                    <div key={id} style={{ borderTop: `1px solid ${theme.borderColor}`, padding: '8px 0' }}>
                        <ControlGroup label="Name" labelFor={`${id}-name`} labelPosition="top" help={nameError} error={Boolean(nameError)}>
                            <Text inputId={`${id}-name`} value={p.name} error={Boolean(nameError)} onChange={(_e: unknown, { value }: { value: string }) => update(i, { name: value })} />
                        </ControlGroup>
                        <ControlGroup label="Label" labelFor={`${id}-label`} labelPosition="top">
                            <Text inputId={`${id}-label`} value={p.label || ''} onChange={(_e: unknown, { value }: { value: string }) => update(i, { label: value })} />
                        </ControlGroup>
                        <ControlGroup label="Type" labelFor={`${id}-type`} labelPosition="top">
                            <Select inputId={`${id}-type`} value={p.type || 'string'} onChange={(_e: unknown, { value }: { value: unknown }) => update(i, { type: value as ParamType })}>
                                <Select.Option label="Text" value="string" />
                                <Select.Option label="Number" value="number" />
                                <Select.Option label="One of a list" value="enum" />
                                <Select.Option label="Time" value="time" />
                            </Select>
                        </ControlGroup>
                        {p.type === 'enum' && (
                            <ControlGroup label="Values" labelFor={`${id}-values`} labelPosition="top" help="Separated by commas.">
                                <ValuesField id={`${id}-values`} values={p.values || []} onChange={(values) => update(i, { values })} />
                            </ControlGroup>
                        )}
                        <ControlGroup label="Default" labelFor={`${id}-default`} labelPosition="top">
                            <Text
                                inputId={`${id}-default`}
                                value={p.default === null || p.default === undefined ? '' : String(p.default)}
                                onChange={(_e: unknown, { value }: { value: string }) => update(i, { default: value })}
                            />
                        </ControlGroup>
                        <ControlGroup label="Must match (regex)" labelFor={`${id}-regex`} labelPosition="top">
                            <Text inputId={`${id}-regex`} value={p.regex || ''} onChange={(_e: unknown, { value }: { value: string }) => update(i, { regex: value })} />
                        </ControlGroup>
                        <Button appearance="subtle" label="Remove parameter" onClick={() => onChange(params.filter((_p, j) => j !== i))} />
                    </div>
                );
            })}
            <Button appearance="secondary" label="Add parameter" onClick={() => onChange([...params, { name: '', type: 'string' }])} />
        </div>
    );
}
