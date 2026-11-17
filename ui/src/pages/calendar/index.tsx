/* Calendar: scheduled times, runs and planned backfill slots of the jobs the viewer can see,
 * by day or by week, in the browser's time zone. Refreshes every 60 seconds while the range
 * contains now. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import RadioBar from '@splunk/react-ui/RadioBar';
import Select from '@splunk/react-ui/Select';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import { getCalendar } from '../../api/calendar';
import { listJobs } from '../../api/client';
import PageShell, { renderPage } from '../../components/PageShell';
import CalendarView from '../../features/calendar/CalendarView';
import { addDays, dayBounds, weekStart } from '../../features/calendar/calendarLayout';
import usePoll from '../../hooks/usePoll';

type View = 'day' | 'week';
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

    const days = useMemo(() => {
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

    const calendar = usePoll(() => getCalendar(from, to, jobId || undefined), 60000, live);
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
            .then((jobs) => setJobNames(jobs.map((j) => [j.id, j.name] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]))))
            .catch(() => undefined);
    }, []);

    const step = view === 'week' ? 7 : 1;
    const shift = (n: number) => setAnchor((a) => addDays(a, n));

    return (
        <PageShell title="Calendar">
            <p style={{ marginTop: 0 }}>{`Times are in your browser's time zone (${timeZone()}).`}</p>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '12px' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                    <Button appearance="secondary" label="Previous" onClick={() => shift(-step)} />
                    <Button appearance="secondary" label="Today" onClick={() => setAnchor(new Date())} />
                    <Button appearance="secondary" label="Next" onClick={() => shift(step)} />
                </div>
                <RadioBar aria-label="Show" value={view} onChange={(_e: unknown, { value }: { value: unknown }) => setView(value as View)}>
                    <RadioBar.Option label="Day" value="day" />
                    <RadioBar.Option label="Week" value="week" />
                </RadioBar>
                <ControlGroup label="Job" labelFor="calendar-job" labelPosition="top">
                    <Select inputId="calendar-job" value={jobId} onChange={(_e: unknown, { value }: { value: unknown }) => setJobId(value ? String(value) : ALL)}>
                        <Select.Option label="All jobs" value={ALL} />
                        {jobNames.map(([id, name]) => (
                            <Select.Option key={id} label={name} value={id} />
                        ))}
                    </Select>
                </ControlGroup>
                <div style={{ paddingBottom: '6px' }}>{rangeTitle(days)}</div>
            </div>
            {calendar.error && (
                <Message type="error" appearance="default">
                    {`The calendar could not be loaded: ${calendar.error.message}`}
                </Message>
            )}
            {calendar.data && calendar.data.truncated && (
                <Message type="warning" appearance="default">
                    Showing the first 2,000 items; pick one job to see all.
                </Message>
            )}
            {calendar.loading && !calendar.data ? (
                <WaitSpinner size="medium" />
            ) : (
                <CalendarView
                    days={days}
                    items={(calendar.data && calendar.data.items) || []}
                    now={now}
                    onOpen={(href) => window.location.assign(href)}
                    onShiftDay={shift}
                />
            )}
        </PageShell>
    );
}

renderPage(<CalendarPage />, 'Calendar');
