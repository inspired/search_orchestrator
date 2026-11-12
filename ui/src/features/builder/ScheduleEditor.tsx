/* One cron schedule as a friendly form: On days, Every…, Monthly, or Advanced (cron). It
 * is stored as cron; the form only writes a new cron when a field changes, so opening a
 * job never rewrites its schedules. A plain-English line says what the schedule means. */
import React, { useEffect, useState } from 'react';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import RadioBar from '@splunk/react-ui/RadioBar';
import Select from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import DayPicker from './DayPicker';
import {
    cronOfForm,
    describeForm,
    formOfCron,
    hhmm,
    HOUR_STEPS,
    MINUTE_STEPS,
    Mode,
    parseTime,
    ScheduleForm,
    switchMode,
} from './scheduleForm';

export interface ScheduleEditorProps {
    id: string;
    cron: string;
    onChange: (cron: string) => void;
    /** The job's time zone, for the summary; empty means the server's. */
    timezone?: string;
}

const HOURS = Array.from({ length: 24 }, (_x, h) => h);
const DOMS = Array.from({ length: 31 }, (_x, d) => d + 1);

function TimeField({ id, hour, minute, onChange }: { id: string; hour: number; minute: number; onChange: (h: number, m: number) => void }) {
    const [text, setText] = useState(hhmm(hour, minute));
    useEffect(() => setText(hhmm(hour, minute)), [hour, minute]);
    const parsed = parseTime(text);
    return (
        <ControlGroup label="At" labelFor={id} labelPosition="top" help={parsed ? undefined : 'Use HH:MM, such as 06:00.'} error={!parsed}>
            <Text
                inputId={id}
                value={text}
                placeholder="06:00"
                style={{ width: '90px' }}
                onChange={(_e: unknown, { value }: { value: string }) => {
                    setText(value);
                    const t = parseTime(value);
                    if (t) {
                        onChange(t[0], t[1]);
                    }
                }}
            />
        </ControlGroup>
    );
}

export default function ScheduleEditor({ id, cron, onChange, timezone }: ScheduleEditorProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [form, setForm] = useState<ScheduleForm>(() => formOfCron(cron));
    // A cron changed from outside (such as "Use this time") reopens the form, unless the
    // user chose Advanced: then it stays Advanced.
    useEffect(() => {
        if (form.mode === 'cron') {
            if (form.cron !== cron) {
                setForm({ mode: 'cron', cron });
            }
        } else if (cronOfForm(form) !== cron) {
            setForm(formOfCron(cron));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cron]);

    const set = (next: ScheduleForm) => {
        setForm(next);
        const out = cronOfForm(next);
        if (out !== cron) {
            onChange(out);
        }
    };
    const row: React.CSSProperties = { display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' };
    const days = (value: number[], change: (d: number[]) => void) => (
        <ControlGroup label="Days" labelPosition="top" help="Keep at least one day.">
            <DayPicker days={value} onChange={change} />
        </ControlGroup>
    );

    return (
        <div data-testid="schedule-editor">
            <ControlGroup label="Repeat" labelPosition="top">
                <RadioBar value={form.mode} onChange={(_e: unknown, { value }: { value: unknown }) => set(switchMode(form, value as Mode, cron))}>
                    <RadioBar.Option value="days" label="On days" />
                    <RadioBar.Option value="every" label="Every…" />
                    <RadioBar.Option value="monthly" label="Monthly" />
                    <RadioBar.Option value="cron" label="Advanced (cron)" />
                </RadioBar>
            </ControlGroup>

            {form.mode === 'days' && (
                <>
                    {days(form.days, (d) => set({ ...form, days: d }))}
                    <TimeField id={`${id}-time`} hour={form.hour} minute={form.minute} onChange={(hour, minute) => set({ ...form, hour, minute })} />
                </>
            )}

            {form.mode === 'every' && (
                <>
                    <div style={row}>
                        <ControlGroup label="Every" labelFor={`${id}-every`} labelPosition="top">
                            <Select
                                inputId={`${id}-every`}
                                value={`${form.every}${form.unit === 'minutes' ? 'm' : 'h'}`}
                                onChange={(_e: unknown, { value }: { value: unknown }) => {
                                    const v = String(value);
                                    set({ ...form, every: parseInt(v, 10), unit: v.endsWith('m') ? 'minutes' : 'hours' });
                                }}
                            >
                                {MINUTE_STEPS.map((n) => (
                                    <Select.Option key={`${n}m`} label={`${n} minutes`} value={`${n}m`} />
                                ))}
                                {HOUR_STEPS.map((n) => (
                                    <Select.Option key={`${n}h`} label={n === 1 ? '1 hour' : `${n} hours`} value={`${n}h`} />
                                ))}
                            </Select>
                        </ControlGroup>
                        <ControlGroup label="From" labelFor={`${id}-from`} labelPosition="top">
                            <Select
                                inputId={`${id}-from`}
                                value={form.fromHour}
                                onChange={(_e: unknown, { value }: { value: unknown }) => {
                                    const from = Number(value);
                                    set({ ...form, fromHour: from, toHour: Math.max(from, form.toHour) });
                                }}
                            >
                                {HOURS.map((h) => (
                                    <Select.Option key={h} label={hhmm(h, 0)} value={h} />
                                ))}
                            </Select>
                        </ControlGroup>
                        <ControlGroup label="Last hour" labelFor={`${id}-to`} labelPosition="top">
                            <Select
                                inputId={`${id}-to`}
                                value={form.toHour}
                                onChange={(_e: unknown, { value }: { value: unknown }) => {
                                    const to = Number(value);
                                    set({ ...form, toHour: to, fromHour: Math.min(to, form.fromHour) });
                                }}
                            >
                                {HOURS.map((h) => (
                                    <Select.Option key={h} label={hhmm(h, 0)} value={h} />
                                ))}
                            </Select>
                        </ControlGroup>
                    </div>
                    {days(form.days, (d) => set({ ...form, days: d }))}
                </>
            )}

            {form.mode === 'monthly' && (
                <div style={row}>
                    <ControlGroup label="On day" labelFor={`${id}-dom`} labelPosition="top">
                        <Select inputId={`${id}-dom`} value={form.dom} onChange={(_e: unknown, { value }: { value: unknown }) => set({ ...form, dom: Number(value) })}>
                            {DOMS.map((d) => (
                                <Select.Option key={d} label={String(d)} value={d} />
                            ))}
                        </Select>
                    </ControlGroup>
                    <TimeField id={`${id}-time`} hour={form.hour} minute={form.minute} onChange={(hour, minute) => set({ ...form, hour, minute })} />
                </div>
            )}

            {form.mode === 'cron' && (
                <ControlGroup label="Cron" labelFor={`${id}-cron`} labelPosition="top" help="minute hour day-of-month month day-of-week.">
                    <Text inputId={`${id}-cron`} value={form.cron} placeholder="0 1 * * *" onChange={(_e: unknown, { value }: { value: string }) => set({ mode: 'cron', cron: value })} />
                </ControlGroup>
            )}

            <div
                data-testid="schedule-summary"
                style={{ margin: '6px 0', padding: '6px 8px', borderRadius: '4px', background: theme.backgroundColorSection, fontSize: '13px' }}
            >
                {`${describeForm(form)} (${timezone || "server's time zone"})`}
                <span style={{ color: theme.contentColorMuted, marginLeft: '8px', fontSize: '12px' }}>{`cron ${cronOfForm(form)}`}</span>
            </div>
        </div>
    );
}
