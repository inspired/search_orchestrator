/* One cron schedule: a preset (hourly, daily, weekly, monthly) or a custom cron, a plain
 * summary, and the next few run times from the server. A cron no preset matches opens as
 * Custom and keeps its text until edited. */
import React, { useEffect, useRef, useState } from 'react';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import DefinitionList from '@splunk/react-ui/DefinitionList';
import Multiselect from '@splunk/react-ui/Multiselect';
import NumberInput from '@splunk/react-ui/Number';
import RadioBar from '@splunk/react-ui/RadioBar';
import Text from '@splunk/react-ui/Text';
import { pad, parseTime } from './PreviewBar';
import type { NextSlotsResponse } from '../../api/client';
import { DAY_NAMES, SchedulePreset, describeSchedule, fromCron, toCron } from './schedule';

export type NextSlots = (cron: string, timezone: string | null, count?: number) => Promise<NextSlotsResponse>;

export interface ScheduleEditorProps {
    id: string;
    cron: string;
    /** The job's time zone; empty is the server's. */
    timezone?: string;
    onChange: (cron: string) => void;
    nextSlots?: NextSlots;
}

const KINDS: SchedulePreset['kind'][] = ['hourly', 'daily', 'weekly', 'monthly', 'custom'];
const KIND_LABELS: Record<SchedulePreset['kind'], string> = { hourly: 'Hourly', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', custom: 'Custom' };
const DEBOUNCE_MS = 400;

/** An epoch as wall time at `offset` seconds east of UTC, the offset the server scheduled it in. */
export function formatSlot(epoch: number, offset: number): string {
    const opts: Intl.DateTimeFormatOptions = {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
    };
    return new Intl.DateTimeFormat('en-GB', opts).format(new Date((epoch + offset) * 1000));
}

/** Where the times are: the job's zone by name, or the server's with its offset when known. */
export function zoneLabel(timezone: string | null, offset: number | null): string {
    if (timezone) {
        return `in ${timezone}`;
    }
    if (offset === null) {
        return "in the server's time zone";
    }
    const abs = Math.abs(offset);
    const hhmm = `${pad(Math.floor(abs / 3600))}:${pad(Math.floor((abs % 3600) / 60))}`;
    return `in the server's time zone (UTC${offset < 0 ? '-' : '+'}${hhmm})`;
}

/** A preset of `kind`, keeping the time of the one being left. */
function switchKind(from: SchedulePreset, kind: SchedulePreset['kind']): SchedulePreset {
    const hour = 'hour' in from ? from.hour : 1;
    const minute = 'minute' in from ? from.minute : 0;
    switch (kind) {
        case 'hourly':
            return { kind, minute };
        case 'daily':
            return { kind, hour, minute };
        case 'weekly':
            return { kind, days: from.kind === 'weekly' ? from.days : [1], hour, minute };
        case 'monthly':
            return { kind, dayOfMonth: from.kind === 'monthly' ? from.dayOfMonth : 1, hour, minute };
        default:
            return { kind, cron: toCron(from) };
    }
}

export default function ScheduleEditor({ id, cron, timezone, onChange, nextSlots }: ScheduleEditorProps) {
    const [preset, setPreset] = useState<SchedulePreset>(() => fromCron(cron));
    const [timeDraft, setTimeDraft] = useState('');
    const [next, setNext] = useState<NextSlotsResponse | null>(null);
    const [cronError, setCronError] = useState<string | null>(null);
    // The cron this editor last sent up; only a different one from outside resets the preset.
    const sent = useRef(cron);
    useEffect(() => {
        if (cron === sent.current) {
            return;
        }
        sent.current = cron;
        setPreset(fromCron(cron));
    }, [cron]);
    const hasTime = preset.kind === 'daily' || preset.kind === 'weekly' || preset.kind === 'monthly';
    useEffect(() => {
        if (hasTime) {
            const p = preset as { hour: number; minute: number };
            setTimeDraft((draft) => {
                const t = parseTime(draft);
                return t && t.hour === p.hour && t.minute === p.minute ? draft : `${pad(p.hour)}:${pad(p.minute)}`;
            });
        }
    }, [preset, hasTime]);

    const apply = (next: SchedulePreset) => {
        setPreset(next);
        const out = toCron(next);
        if (next.kind === 'weekly' && !next.days.length) {
            return;
        }
        sent.current = out;
        onChange(out);
    };

    // Next runs, 400 ms after the last change; a reply for an older cron is dropped.
    useEffect(() => {
        setCronError(null);
        if (!nextSlots || !cron.trim()) {
            setNext(null);
            return undefined;
        }
        let stale = false;
        const timer = setTimeout(() => {
            nextSlots(cron, timezone || null, 3).then(
                (r) => {
                    if (!stale) {
                        setNext(r);
                    }
                },
                (e: { code?: string; message?: string }) => {
                    if (stale) {
                        return;
                    }
                    setNext(null);
                    if (e && e.code === 'bad_cron') {
                        setCronError(e.message || 'This cron expression is not valid.');
                    }
                }
            );
        }, DEBOUNCE_MS);
        return () => {
            stale = true;
            clearTimeout(timer);
        };
    }, [cron, timezone, nextSlots]);

    const timeError = hasTime && !parseTime(timeDraft);
    const setTime = (text: string) => {
        setTimeDraft(text);
        const t = parseTime(text);
        if (t && hasTime) {
            apply({ ...(preset as { kind: 'daily' }), hour: t.hour, minute: t.minute });
        }
    };

    return (
        <div>
            <ControlGroup label="Repeats" labelPosition="top">
                <RadioBar
                    aria-label="Repeats"
                    value={preset.kind}
                    onChange={(_e: unknown, { value }: { value: unknown }) => {
                        const kind = value as SchedulePreset['kind'];
                        if (kind !== preset.kind) {
                            apply(switchKind(preset, kind));
                        }
                    }}
                >
                    {KINDS.map((k) => (
                        <RadioBar.Option key={k} label={KIND_LABELS[k]} value={k} />
                    ))}
                </RadioBar>
            </ControlGroup>
            {preset.kind === 'hourly' && (
                <ControlGroup label="Minutes past the hour" labelFor={`${id}-minute`} labelPosition="top">
                    <NumberInput
                        inputId={`${id}-minute`}
                        min={0}
                        max={59}
                        step={1}
                        roundTo={0}
                        value={preset.minute}
                        onChange={(_e: unknown, { value }: { value?: number }) => {
                            if (value !== undefined && !Number.isNaN(value) && value >= 0 && value <= 59) {
                                apply({ kind: 'hourly', minute: value });
                            }
                        }}
                    />
                </ControlGroup>
            )}
            {preset.kind === 'weekly' && (
                <ControlGroup
                    label="Days"
                    labelFor={`${id}-days`}
                    labelPosition="top"
                    error={!preset.days.length}
                    help={preset.days.length ? undefined : 'Pick at least one day.'}
                >
                    <Multiselect
                        inputId={`${id}-days`}
                        values={preset.days.map(String)}
                        error={!preset.days.length}
                        onChange={(_e: unknown, { values }: { values: unknown[] }) =>
                            apply({ ...preset, days: values.map((v) => Number(v)).sort((a, b) => a - b) })
                        }
                    >
                        {DAY_NAMES.map((d, i) => (
                            <Multiselect.Option key={d} label={d} value={String(i)} />
                        ))}
                    </Multiselect>
                </ControlGroup>
            )}
            {preset.kind === 'monthly' && (
                <ControlGroup
                    label="Day of month"
                    labelFor={`${id}-dom`}
                    labelPosition="top"
                    help={preset.dayOfMonth > 28 ? 'Months without this day are skipped.' : undefined}
                >
                    <NumberInput
                        inputId={`${id}-dom`}
                        min={1}
                        max={31}
                        step={1}
                        roundTo={0}
                        value={preset.dayOfMonth}
                        onChange={(_e: unknown, { value }: { value?: number }) => {
                            if (value !== undefined && !Number.isNaN(value) && value >= 1 && value <= 31) {
                                apply({ ...preset, dayOfMonth: value });
                            }
                        }}
                    />
                </ControlGroup>
            )}
            {hasTime && (
                <ControlGroup label="Time (HH:MM)" labelFor={`${id}-time`} labelPosition="top" error={timeError} help={timeError ? 'Use HH:MM, 24-hour.' : undefined}>
                    <Text
                        inputId={`${id}-time`}
                        value={timeDraft}
                        error={timeError}
                        style={{ width: '90px' }}
                        onBlur={() => {
                            const p = preset as { hour: number; minute: number };
                            setTimeDraft(`${pad(p.hour)}:${pad(p.minute)}`);
                        }}
                        onChange={(_e: unknown, { value }: { value: string }) => setTime(value)}
                    />
                </ControlGroup>
            )}
            {preset.kind === 'custom' && (
                <ControlGroup
                    label="Cron"
                    labelFor={`${id}-cron`}
                    labelPosition="top"
                    error={!!cronError}
                    help={cronError || "minute hour day-of-month month day-of-week, in the job's time zone."}
                >
                    <Text
                        inputId={`${id}-cron`}
                        value={preset.cron}
                        error={!!cronError}
                        placeholder="0 1 * * *"
                        onChange={(_e: unknown, { value }: { value: string }) => apply({ kind: 'custom', cron: value })}
                    />
                </ControlGroup>
            )}
            <p>{`${describeSchedule(cron)}, ${next ? zoneLabel(next.timezone, next.utc_offsets[0] ?? null) : zoneLabel(timezone || null, null)}`}</p>
            {next && next.timezone_status !== 'ok' && <p>Unknown time zone; times are shown in server time.</p>}
            {next && next.slots.length > 0 && (
                <DefinitionList termWidth="90px">
                    <DefinitionList.Term>Next runs</DefinitionList.Term>
                    <DefinitionList.Description>
                        {next.slots.map((s, i) => (
                            <div key={s}>{formatSlot(s, next.utc_offsets[i] ?? 0)}</div>
                        ))}
                    </DefinitionList.Description>
                </DefinitionList>
            )}
        </div>
    );
}
