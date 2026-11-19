/* Calendar: scheduled times, runs and planned backfill slots of the jobs the viewer can see,
 * by day, week or month, in the browser's time zone. Refreshes every 60 seconds while the range
 * contains now. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import DateInput from '@splunk/react-ui/Date';
import Message from '@splunk/react-ui/Message';
import RadioBar from '@splunk/react-ui/RadioBar';
import Select from '@splunk/react-ui/Select';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import { getCalendar, getCalendarRange } from '../../api/calendar';
import { listJobs } from '../../api/client';
import PageShell, { renderPage } from '../../components/PageShell';
import CalendarView from '../../features/calendar/CalendarView';
import MonthView from '../../features/calendar/MonthView';
import { addMonths, monthDays } from '../../features/calendar/monthLayout';
import { addDays, dayBounds, weekStart } from '../../features/calendar/calendarLayout';
import usePoll from '../../hooks/usePoll';
import { allTags, hasTag } from '../../features/jobs/tags';
import type { CalendarItem } from '../../api/calendar';

type View = 'day' | 'week' | 'month';
const ALL = '';

function timeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
    } catch (err) {
        return 'unknown';
    }
}

function rangeTitle(days: Date[]): string {
    const first = days[0];
    const last = days[days.length - 1];
    if (days.length === 1) {
        return first.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    return `${first.toLocaleDateString(undefined, opts)} – ${last.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
}

function CalendarPage() {
    const [view, setView] = useState<View>('week');
    const [anchor, setAnchor] = useState<Date>(() => new Date());
    const [jobId, setJobId] = useState<string>(ALL);
    const [jobNames, setJobNames] = useState<Array<[string, string]>>([]);
    const [jobTags, setJobTags] = useState<Record<string, string[]>>({});
    const [tag, setTag] = useState<string>(ALL);

    const days = useMemo(() => {
        if (view === 'month') {
            return monthDays(anchor);
        }
        if (view === 'day') {
            return [new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())];
        }
        const monday = weekStart(anchor);
        return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    }, [view, anchor]);
    const from = dayBounds(days[0]).start;
    const to = dayBounds(days[days.length - 1]).end;
    const nowSec = Math.floor(Date.now() / 1000);
    const live = nowSec >= from && nowSec < to;

    const calendar = usePoll(() => (view === 'month' ? getCalendarRange : getCalendar)(from, to, jobId || undefined), 60000, live);
    const [now, setNow] = useState(nowSec);
    useEffect(() => setNow(Math.floor(Date.now() / 1000)), [calendar.data]);

    // A new range or job fetches at once; the first render is skipped, usePoll loads on mount.
    const first = useRef(true);
    useEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        calendar.refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [from, to, jobId]);

    useEffect(() => {
        listJobs()
            .then((jobs) => {
                setJobNames(jobs.map((j) => [j.id, j.name] as [string, string]).sort((a, b) => a[1].localeCompare(b[1])));
                const byId: Record<string, string[]> = {};
                jobs.forEach((j) => {
                    byId[j.id] = j.tags || [];
                });
                setJobTags(byId);
            })
            .catch(() => undefined);
    }, []);

    const tags = allTags(Object.values(jobTags).map((t) => ({ tags: t })));
    const items: CalendarItem[] = ((calendar.data && calendar.data.items) || []).filter((i) => !tag || hasTag({ tags: jobTags[i.job_id] }, tag));
    const step = view === 'week' ? 7 : 1;
    const shift = (n: number) => setAnchor((a) => addDays(a, n));
    const move = (dir: number) => (view === 'month' ? setAnchor((a) => addMonths(a, dir)) : shift(dir * step));
    const title = view === 'month' ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : rangeTitle(days);
    const unit = view === 'month' ? 'month' : view;
    const pad = (n: number) => String(n).padStart(2, '0');
    const isoDay = `${anchor.getFullYear()}-${pad(anchor.getMonth() + 1)}-${pad(anchor.getDate())}`;
    const moveRef = useRef(move);
    moveRef.current = move;

    // ← and → move a day, week or month, T goes to today, when no field or control has focus.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = document.activeElement;
            if (e.altKey || e.ctrlKey || e.metaKey || (el && el !== document.body)) {
                return;
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                moveRef.current(e.key === 'ArrowLeft' ? -1 : 1);
            } else if (e.key === 't' || e.key === 'T') {
                setAnchor(new Date());
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return (
        <PageShell title="Calendar">
            <p style={{ marginTop: 0 }}>{`Times are in your browser's time zone (${timeZone()}).`}</p>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '12px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} role="group" aria-label="Move through the calendar">
                    <Button appearance="secondary" label={`‹ Previous ${unit}`} aria-label={`Previous ${unit}`} title="Previous (←)" onClick={() => move(-1)} />
                    <Button appearance="secondary" label="Today" title="Today (T)" onClick={() => setAnchor(new Date())} />
                    <Button appearance="secondary" label={`Next ${unit} ›`} aria-label={`Next ${unit}`} title="Next (→)" onClick={() => move(1)} />
                    <strong data-testid="calendar-title" style={{ fontSize: '16px', minWidth: '180px', marginLeft: '8px' }} aria-live="polite">
                        {title}
                    </strong>
                </div>
                <ControlGroup label="Go to date" labelFor="calendar-go-to" labelPosition="top">
                    <DateInput
                        inputId="calendar-go-to"
                        value={isoDay}
                        onChange={(_e: unknown, { value }: { value: string }) => {
                            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
                            if (m) {
                                setAnchor(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
                            }
                        }}
                    />
                </ControlGroup>
                <RadioBar aria-label="Show" value={view} onChange={(_e: unknown, { value }: { value: unknown }) => setView(value as View)}>
                    <RadioBar.Option label="Day" value="day" />
                    <RadioBar.Option label="Week" value="week" />
                    <RadioBar.Option label="Month" value="month" />
                </RadioBar>
                <ControlGroup label="Job" labelFor="calendar-job" labelPosition="top">
                    <Select inputId="calendar-job" value={jobId} onChange={(_e: unknown, { value }: { value: unknown }) => setJobId(value ? String(value) : ALL)}>
                        <Select.Option label="All jobs" value={ALL} />
                        {jobNames.map(([id, name]) => (
                            <Select.Option key={id} label={name} value={id} />
                        ))}
                    </Select>
                </ControlGroup>
                {tags.length > 0 && (
                    <ControlGroup label="Tag" labelFor="calendar-tag" labelPosition="top">
                        <Select inputId="calendar-tag" value={tag} onChange={(_e: unknown, { value }: { value: unknown }) => setTag(value ? String(value) : ALL)}>
                            <Select.Option label="All tags" value={ALL} />
                            {tags.map((t) => (
                                <Select.Option key={t} label={t} value={t} />
                            ))}
                        </Select>
                    </ControlGroup>
                )}
            </div>
            {calendar.error && (
                <Message type="error" appearance="default">
                    {`The calendar could not be loaded: ${calendar.error.message}`}
                </Message>
            )}
            {calendar.data && calendar.data.truncated && (
                <Message type="warning" appearance="default">
                    {view === 'month' ? 'Some items are left out (at most 2,000 a week); pick one job to see all.' : 'Showing the first 2,000 items; pick one job to see all.'}
                </Message>
            )}
            {calendar.loading && !calendar.data ? (
                <WaitSpinner size="medium" />
            ) : view === 'month' ? (
                <MonthView
                    month={anchor}
                    items={items}
                    now={now}
                    onOpenDay={(d) => {
                        setAnchor(d);
                        setView('day');
                    }}
                />
            ) : (
                <CalendarView
                    days={days}
                    items={items}
                    now={now}
                    onOpen={(href) => window.location.assign(href)}
                    onShiftDay={shift}
                />
            )}
        </PageShell>
    );
}

renderPage(<CalendarPage />, 'Calendar');
