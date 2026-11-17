/* The calendar grid: one column per day (seven in the week view, one wide one in the day
 * view) by 24 hour rows. Items are buttons at their time, in time order for Tab; more than
 * three in a half hour collapse to "+N more", which opens a list. ArrowLeft/ArrowRight on a
 * day heading move to the neighbouring day. */
import React, { useEffect, useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Modal from '@splunk/react-ui/Modal';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { CalendarItem } from '../../api/calendar';
import CalendarItemButton, { clockTime } from './CalendarItemButton';
import { MIN_HEIGHT, dayBounds, itemTime, layoutDay } from './calendarLayout';
import type { Overflow, Placed } from './calendarLayout';

export const PX_PER_HOUR = 72;
const GUTTER = 56;
const FIRST_HOUR_SHOWN = 7;

export interface CalendarViewProps {
    days: Date[];
    items: CalendarItem[];
    /** Epoch seconds; running runs are drawn to here and today gets a line at it. */
    now: number;
    onOpen: (href: string) => void;
    /** Day view: an arrow key on the heading moves the shown day by this many days. */
    onShiftDay: (days: number) => void;
}

function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

type Entry = { kind: 'item'; placed: Placed } | { kind: 'more'; overflow: Overflow };

export default function CalendarView({ days, items, now, onOpen, onShiftDay }: CalendarViewProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const headings = useRef<Array<HTMLHeadingElement | null>>([]);
    const scroller = useRef<HTMLDivElement>(null);
    const [more, setMore] = useState<Overflow | null>(null);
    const opener = useRef<HTMLElement | null>(null);
    const today = new Date(now * 1000);

    useEffect(() => {
        if (scroller.current) {
            scroller.current.scrollTop = FIRST_HOUR_SHOWN * PX_PER_HOUR;
        }
    }, []);

    const onHeadingKey = (index: number) => (e: React.KeyboardEvent) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) {
            return;
        }
        e.preventDefault();
        if (days.length === 1) {
            onShiftDay(step);
            return;
        }
        const next = headings.current[index + step];
        if (next) {
            next.focus();
        }
    };

    const line = `1px solid ${theme.borderColorWeak || theme.borderColor}`;
    const hours = Array.from({ length: 24 }, (_, h) => h);

    return (
        <div role="region" aria-label="Calendar" style={{ border: line }}>
            <div style={{ display: 'flex', borderBottom: line }}>
                <div style={{ width: `${GUTTER}px`, flex: 'none' }} />
                {days.map((d, i) => {
                    const isToday = sameDay(d, today);
                    return (
                        <h3
                            key={d.getTime()}
                            ref={(el) => {
                                headings.current[i] = el;
                            }}
                            tabIndex={0}
                            aria-current={isToday ? 'date' : undefined}
                            onKeyDown={onHeadingKey(i)}
                            style={{
                                flex: '1 1 0',
                                minWidth: 0,
                                margin: 0,
                                padding: '6px 8px',
                                fontSize: '14px',
                                fontWeight: isToday ? 700 : 400,
                                color: isToday ? theme.contentColorActive || theme.contentColorDefault : theme.contentColorDefault,
                                borderLeft: line,
                            }}
                        >
                            {d.toLocaleDateString(undefined, { weekday: days.length === 1 ? 'long' : 'short', day: 'numeric', month: 'short' })}
                        </h3>
                    );
                })}
            </div>
            <div ref={scroller} style={{ display: 'flex', maxHeight: '70vh', overflowY: 'auto' }}>
                <div aria-hidden style={{ width: `${GUTTER}px`, flex: 'none' }}>
                    {hours.map((h) => (
                        <div
                            key={h}
                            style={{ height: `${PX_PER_HOUR}px`, boxSizing: 'border-box', padding: '0 6px', fontSize: '12px', color: theme.contentColorMuted }}
                        >
                            {clockTime(new Date(2000, 0, 1, h).getTime() / 1000)}
                        </div>
                    ))}
                </div>
                {days.map((d) => {
                    const bounds = dayBounds(d);
                    const hoursInDay = Math.round((bounds.end - bounds.start) / 3600);
                    const { placed, overflow } = layoutDay(items, bounds, PX_PER_HOUR, now);
                    const entries: Entry[] = [
                        ...placed.map((p) => ({ kind: 'item' as const, placed: p })),
                        ...overflow.map((o) => ({ kind: 'more' as const, overflow: o })),
                    ].sort((a, b) => (a.kind === 'item' ? a.placed.top : a.overflow.top + 0.5) - (b.kind === 'item' ? b.placed.top : b.overflow.top + 0.5));
                    return (
                        <div
                            key={d.getTime()}
                            role="group"
                            aria-label={d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                            style={{ position: 'relative', flex: '1 1 0', minWidth: 0, height: `${hoursInDay * PX_PER_HOUR}px`, borderLeft: line }}
                        >
                            {Array.from({ length: hoursInDay }, (_, h) => (
                                <div
                                    key={h}
                                    aria-hidden
                                    style={{ position: 'absolute', top: `${h * PX_PER_HOUR}px`, left: 0, right: 0, borderTop: h ? line : undefined }}
                                />
                            ))}
                            {now >= bounds.start && now < bounds.end && (
                                <div
                                    aria-hidden
                                    style={{
                                        position: 'absolute',
                                        top: `${((now - bounds.start) / 3600) * PX_PER_HOUR}px`,
                                        left: 0,
                                        right: 0,
                                        borderTop: `2px solid ${theme.focusColor}`,
                                        zIndex: 1,
                                    }}
                                />
                            )}
                            {entries.map((e) =>
                                e.kind === 'item' ? (
                                    <CalendarItemButton
                                        key={`${e.placed.item.kind}:${e.placed.item.kind === 'run' ? e.placed.item.run_id : e.placed.item.job_id}:${e.placed.top}`}
                                        item={e.placed.item}
                                        onOpen={onOpen}
                                        style={{
                                            position: 'absolute',
                                            top: `${e.placed.top}px`,
                                            height: `${e.placed.height}px`,
                                            left: `calc(${e.placed.lane} * 100% / 3 + 2px)`,
                                            width: 'calc(100% / 3 - 4px)',
                                        }}
                                    />
                                ) : (
                                    <button
                                        key={`more:${e.overflow.top}`}
                                        type="button"
                                        aria-label={`${e.overflow.items.length} more at ${clockTime(itemTime(e.overflow.items[0]))}`}
                                        onClick={(ev) => {
                                            opener.current = ev.currentTarget;
                                            setMore(e.overflow);
                                        }}
                                        style={{
                                            position: 'absolute',
                                            top: `${e.overflow.top + MIN_HEIGHT}px`,
                                            left: '2px',
                                            height: `${MIN_HEIGHT}px`,
                                            padding: '0 4px',
                                            font: 'inherit',
                                            fontSize: '12px',
                                            cursor: 'pointer',
                                            background: 'none',
                                            border: 'none',
                                            textDecoration: 'underline',
                                            color: theme.contentColorDefault,
                                        }}
                                    >
                                        {`+${e.overflow.items.length} more`}
                                    </button>
                                )
                            )}
                        </div>
                    );
                })}
            </div>
            {more && (
                <Modal
                    open
                    onRequestClose={() => setMore(null)}
                    returnFocus={() => opener.current && opener.current.isConnected && opener.current.focus()}
                    style={{ width: '440px' }}
                >
                    <Modal.Header title={`More at ${clockTime(itemTime(more.items[0]))}`} />
                    <Modal.Body>
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                            {more.items.map((item, i) => (
                                <li key={i} style={{ marginBottom: '4px' }}>
                                    <CalendarItemButton item={item} onOpen={onOpen} style={{ width: '100%' }} />
                                </li>
                            ))}
                        </ul>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button appearance="secondary" label="Close" onClick={() => setMore(null)} />
                    </Modal.Footer>
                </Modal>
            )}
        </div>
    );
}
