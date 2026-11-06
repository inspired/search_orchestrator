/* The preview bar above the step graph: "as if scheduled at" (local date and HH:MM), one
 * control per run parameter, and where upstream results come from (live previews or one
 * of the job's recent runs). Choosing a run takes its scheduled time and parameters. */
import React, { useEffect, useState } from 'react';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import DateInput from '@splunk/react-ui/Date';
import Select from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { ParamDecl, RunSummary } from '../../api/types';
import { localStamp } from './PreviewResult';

const RUNS_SHOWN = 20;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const pad = (n: number) => String(n).padStart(2, '0');

function dateOf(epoch: number): string {
    const d = new Date(epoch * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeOf(epoch: number): string {
    const d = new Date(epoch * 1000);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local date "YYYY-MM-DD" and time "HH:MM" as epoch seconds. */
function toEpoch(date: string, time: string): number | null {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const tm = TIME_RE.exec(time);
    if (!dm || !tm) {
        return null;
    }
    const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
    return Math.floor(d.getTime() / 1000);
}

export interface PreviewBarProps {
    /** Epoch seconds. */
    scheduledTime: number;
    onScheduledTime: (epoch: number) => void;
    params: ParamDecl[];
    values: Record<string, string>;
    onValues: (values: Record<string, string>) => void;
    /** `live` or a run id. */
    source: string;
    onSource: (source: string) => void;
    /** This job's runs; empty for an unsaved job. */
    runs: RunSummary[];
}

export default function PreviewBar({ scheduledTime, onScheduledTime, params, values, onValues, source, onSource, runs }: PreviewBarProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [timeDraft, setTimeDraft] = useState(timeOf(scheduledTime));
    useEffect(() => setTimeDraft(timeOf(scheduledTime)), [scheduledTime]);
    const timeError = !TIME_RE.test(timeDraft);
    const shown = [...runs].sort((a, b) => b.scheduled_time - a.scheduled_time).slice(0, RUNS_SHOWN);

    const onPick = (_e: unknown, { value }: { value: unknown }) => {
        const id = String(value);
        onSource(id);
        const run = shown.find((r) => r.id === id);
        if (run) {
            onScheduledTime(run.scheduled_time);
            onValues({ ...(run.params || {}) });
        }
    };

    return (
        <div
            role="group"
            aria-label="Preview settings"
            style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0 16px',
                alignItems: 'flex-start',
                borderBottom: `1px solid ${theme.borderColor}`,
                marginBottom: '8px',
            }}
        >
            <ControlGroup label="Preview as if scheduled at" labelFor="preview-date" labelPosition="top" help="Your browser's time zone.">
                <DateInput
                    inputId="preview-date"
                    value={dateOf(scheduledTime)}
                    onChange={(_e: unknown, { value }: { value: string }) => {
                        const epoch = toEpoch(value, timeOf(scheduledTime));
                        if (epoch !== null) {
                            onScheduledTime(epoch);
                        }
                    }}
                />
            </ControlGroup>
            <ControlGroup
                label="Time (HH:MM)"
                labelFor="preview-time"
                labelPosition="top"
                help={timeError ? 'Use HH:MM, 24-hour.' : undefined}
                error={timeError}
            >
                <Text
                    inputId="preview-time"
                    value={timeDraft}
                    error={timeError}
                    style={{ width: '90px' }}
                    onChange={(_e: unknown, { value }: { value: string }) => {
                        setTimeDraft(value);
                        const epoch = toEpoch(dateOf(scheduledTime), value);
                        if (epoch !== null) {
                            onScheduledTime(epoch);
                        }
                    }}
                />
            </ControlGroup>
            {params
                .filter((p) => p.name)
                .map((p) => {
                    const id = `preview-param-${p.name}`;
                    const placeholder = p.default === null || p.default === undefined ? '' : String(p.default);
                    const set = (value: string) => onValues({ ...values, [p.name]: value });
                    return (
                        <ControlGroup key={p.name} label={p.label || p.name} labelFor={id} labelPosition="top">
                            {p.type === 'enum' ? (
                                <Select
                                    inputId={id}
                                    value={values[p.name] ?? placeholder}
                                    onChange={(_e: unknown, { value }: { value: unknown }) => set(String(value))}
                                >
                                    {(p.values || []).map((v) => (
                                        <Select.Option key={v} label={v} value={v} />
                                    ))}
                                </Select>
                            ) : (
                                <Text
                                    inputId={id}
                                    value={values[p.name] ?? ''}
                                    placeholder={placeholder}
                                    onChange={(_e: unknown, { value }: { value: string }) => set(value)}
                                />
                            )}
                        </ControlGroup>
                    );
                })}
            <ControlGroup label="Input from" labelFor="preview-source" labelPosition="top">
                <Select inputId="preview-source" data-testid="input-from" value={source} onChange={onPick}>
                    <Select.Option label="Live previews" value="live" />
                    {shown.map((r) => (
                        <Select.Option key={r.id} label={`${localStamp(r.scheduled_time)} · ${r.state}`} value={r.id} />
                    ))}
                </Select>
            </ControlGroup>
        </div>
    );
}
