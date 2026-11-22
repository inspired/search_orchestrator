/* Backfill: run a job once for each slot of a past range. From and To are a date and an HH:MM
 * time in the browser's time zone. The summary is the server's dry run, asked for 400 ms after
 * the last change; Start backfill stays dimmed, with the reason, until it is a valid one. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import DateInput from '@splunk/react-ui/Date';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import RadioList from '@splunk/react-ui/RadioList';
import Select from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import {
    Backfill,
    BackfillRequest,
    createBackfill as defaultCreateBackfill,
    planBackfill as defaultPlanBackfill,
} from '../../api/backfills';
import type { Job, ParamDecl } from '../../api/types';
import { DurationField } from '../builder/StepPanel';
import { checkParam, ParamFields } from './RunNowDialog';

const DEBOUNCE_MS = 400;
const DAY = 86400;
const DEFAULT_DAYS = 30;
const MAX_CONCURRENCY = 5;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TIME_ERROR = 'Use HH:MM, 24-hour.';

const pad = (n: number) => String(n).padStart(2, '0');

function dateOf(epoch: number): string {
    const d = new Date(epoch * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local date "YYYY-MM-DD" and time "HH:MM" as epoch seconds, or null. */
function toEpoch(date: string, time: string): number | null {
    const dm = DATE_RE.exec(date);
    const tm = TIME_RE.exec(time);
    if (!dm || !tm) {
        return null;
    }
    const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
    return Math.floor(d.getTime() / 1000);
}

/** "1 Oct 01:00" in the browser's time zone. */
function slotText(epoch: number): string {
    const d = new Date(epoch * 1000);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function summaryText(slots: number[], count: number): string {
    if (count === 1) {
        return `1 run, at ${slotText(slots[0])}.`;
    }
    return `${count} runs, from ${slotText(slots[0])} to ${slotText(slots[slots.length - 1])}.`;
}

function initialValues(params: ParamDecl[]): Record<string, string> {
    const out: Record<string, string> = {};
    params.forEach((p) => {
        out[p.name] = p.default !== null && p.default !== undefined ? String(p.default) : '';
    });
    return out;
}

type Summary = { kind: 'loading' } | { kind: 'ok'; text: string } | { kind: 'error'; text: string };

export interface BackfillDialogProps {
    job: Pick<Job, 'id' | 'name' | 'params' | 'triggers'>;
    open: boolean;
    onClose: () => void;
    onStarted: (backfill: Backfill) => void;
    /** Epoch seconds the default range ends at (today's midnight); for tests. */
    now?: number;
    planBackfill?: typeof defaultPlanBackfill;
    createBackfill?: typeof defaultCreateBackfill;
    returnFocus?: React.ComponentProps<typeof Modal>['returnFocus'];
}

export default function BackfillDialog({
    job,
    open,
    onClose,
    onStarted,
    now,
    planBackfill = defaultPlanBackfill,
    createBackfill = defaultCreateBackfill,
    returnFocus = () => undefined,
}: BackfillDialogProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const params = job.params || [];
    const hasSchedule = (job.triggers || []).some((t) => t.type === 'cron' && t.enabled !== false);
    const [range] = useState(() => {
        const today = new Date((now ?? Date.now() / 1000) * 1000);
        today.setHours(0, 0, 0, 0);
        const end = Math.floor(today.getTime() / 1000);
        const start = new Date(today);
        start.setDate(start.getDate() - DEFAULT_DAYS);
        return { from: dateOf(start.getTime() / 1000), to: dateOf(end) };
    });
    const [fromDate, setFromDate] = useState(range.from);
    const [fromTime, setFromTime] = useState('00:00');
    const [toDate, setToDate] = useState(range.to);
    const [toTime, setToTime] = useState('00:00');
    const [source, setSource] = useState<'schedule' | 'step'>(hasSchedule ? 'schedule' : 'step');
    const [step, setStep] = useState<number | null>(DAY);
    const [concurrency, setConcurrency] = useState(1);
    const [values, setValues] = useState<Record<string, string>>(() => initialValues(params));
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [summary, setSummary] = useState<Summary>({ kind: 'loading' });
    const [formError, setFormError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const asked = useRef(0);

    const fromBad = !TIME_RE.test(fromTime);
    const toBad = !TIME_RE.test(toTime);
    const from = toEpoch(fromDate, fromTime);
    const to = toEpoch(toDate, toTime);

    // The request, or why there is none yet.
    const req = useMemo((): BackfillRequest | string => {
        if (from === null || to === null) {
            return 'Enter From and To as a date and an HH:MM time.';
        }
        if (source === 'step' && step === null) {
            return 'Enter how often to run, such as every 1 day.';
        }
        const out: BackfillRequest = { from, to, source, concurrency };
        if (source === 'step' && step !== null) {
            out.step = step;
        }
        if (params.length) {
            out.params = values;
        }
        return out;
    }, [from, to, source, step, concurrency, values, params.length]);
    const reqKey = JSON.stringify(req);

    useEffect(() => {
        const ask = ++asked.current;
        if (typeof req === 'string') {
            setSummary({ kind: 'error', text: req });
            return undefined;
        }
        setSummary({ kind: 'loading' });
        const timer = setTimeout(() => {
            planBackfill(job.id, req).then(
                (out) => ask === asked.current && setSummary({ kind: 'ok', text: summaryText(out.slots, out.count) }),
                (err: Error) => ask === asked.current && setSummary({ kind: 'error', text: err.message || 'The runs could not be counted.' })
            );
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reqKey, job.id]);

    const setValue = (name: string, value: string) => {
        setValues((v) => ({ ...v, [name]: value }));
        setErrors((e) => {
            const next = { ...e };
            delete next[name];
            return next;
        });
    };

    const submit = async () => {
        if (typeof req === 'string' || summary.kind !== 'ok') {
            return;
        }
        const found: Record<string, string> = {};
        params.forEach((p) => {
            const problem = checkParam(p, values[p.name] || '');
            if (problem) {
                found[p.name] = problem;
            }
        });
        setErrors(found);
        setFormError(null);
        if (Object.keys(found).length) {
            return;
        }
        setSubmitting(true);
        try {
            onStarted(await createBackfill(job.id, req));
        } catch (err) {
            setFormError((err as Error).message || 'The backfill could not be started.');
        } finally {
            setSubmitting(false);
        }
    };

    const ready = summary.kind === 'ok' && !submitting;
    const reason = summary.kind === 'loading' ? 'Counting the runs…' : summary.kind === 'error' ? 'Fix the problem shown above first.' : null;
    const row: React.CSSProperties = { display: 'flex', gap: '16px' };

    const timeField = (id: string, label: string, value: string, bad: boolean, set: (v: string) => void) => (
        <ControlGroup label={label} labelFor={id} labelPosition="top" help={bad ? TIME_ERROR : undefined} error={bad}>
            <Text inputId={id} value={value} error={bad} style={{ width: '90px' }} onChange={(_e: unknown, { value: v }: { value: string }) => set(v)} />
        </ControlGroup>
    );

    return (
        <Modal open={open} onRequestClose={onClose} returnFocus={returnFocus} style={{ width: '560px' }}>
            <Modal.Header title={`Backfill: ${job.name}`} />
            <Modal.Body>
                {formError && (
                    <Message type="error" appearance="default">
                        {formError}
                    </Message>
                )}
                <div style={row}>
                    <ControlGroup label="From" labelFor="backfill-from" labelPosition="top" help="Your browser's time zone.">
                        <DateInput inputId="backfill-from" value={fromDate} onChange={(_e: unknown, { value }: { value: string }) => setFromDate(value)} />
                    </ControlGroup>
                    {timeField('backfill-from-time', 'From time (HH:MM)', fromTime, fromBad, setFromTime)}
                </div>
                <div style={row}>
                    <ControlGroup label="To" labelFor="backfill-to" labelPosition="top" help="Not included.">
                        <DateInput inputId="backfill-to" value={toDate} onChange={(_e: unknown, { value }: { value: string }) => setToDate(value)} />
                    </ControlGroup>
                    {timeField('backfill-to-time', 'To time (HH:MM)', toTime, toBad, setToTime)}
                </div>
                <ControlGroup label="Runs at" labelPosition="top">
                    <RadioList value={source} onChange={(_e: unknown, { value }: { value: unknown }) => setSource(value as 'schedule' | 'step')}>
                        <RadioList.Option value="schedule" disabled={!hasSchedule} description={hasSchedule ? undefined : 'This job has no schedule.'}>
                            The job&apos;s schedule
                        </RadioList.Option>
                        <RadioList.Option value="step">Every …</RadioList.Option>
                    </RadioList>
                </ControlGroup>
                {source === 'step' && (
                    <DurationField
                        id="backfill-step"
                        label="Every"
                        value={step}
                        inherited={DAY}
                        inheritedFrom="Every"
                        placeholder="1"
                        help="From the start of the range."
                        onChange={setStep}
                    />
                )}
                <ControlGroup
                    label="Runs in the queue at once"
                    labelFor="backfill-concurrency"
                    labelPosition="top"
                    help="Runs of one job never overlap; more here only keeps more of them waiting."
                >
                    <Select
                        inputId="backfill-concurrency"
                        value={concurrency}
                        onChange={(_e: unknown, { value }: { value: unknown }) => setConcurrency(Number(value))}
                    >
                        {Array.from({ length: MAX_CONCURRENCY }, (_v, i) => (
                            <Select.Option key={i + 1} label={String(i + 1)} value={i + 1} />
                        ))}
                    </Select>
                </ControlGroup>
                <ParamFields params={params} values={values} errors={errors} idPrefix="backfill-param" onChange={setValue} />
                <div aria-live="polite">
                    {summary.kind === 'ok' && <p>{summary.text}</p>}
                    {summary.kind === 'error' && (
                        <Message type="error" appearance="default">
                            {summary.text}
                        </Message>
                    )}
                </div>
            </Modal.Body>
            <Modal.Footer>
                {reason && (
                    <span id="backfill-start-reason" style={{ color: theme.contentColorMuted, marginRight: '8px' }}>
                        {reason}
                    </span>
                )}
                <Button appearance="secondary" label="Cancel" onClick={onClose} />
                <Button
                    appearance="primary"
                    label="Start backfill"
                    disabled={!ready}
                    aria-describedby={reason ? 'backfill-start-reason' : undefined}
                    onClick={submit}
                />
            </Modal.Footer>
        </Modal>
    );
}
