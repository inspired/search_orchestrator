/* A step's time range: a preset, all time or custom Earliest/Latest, with a readout of the
 * window a run scheduled at the preview time would search. */
import React, { useEffect, useState } from 'react';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Select from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';
import Typography from '@splunk/react-ui/Typography';
import type { BuilderApi } from './BuilderPage';
import { TIME_RANGE_PRESETS, formatMoment, timeRangeChoice } from './timeRange';

export interface TimeRangeFieldProps {
    idPrefix: string;
    earliest?: string;
    latest?: string;
    scheduledTime: number;
    /** The job's time zone; empty is the browser's. */
    timezone?: string;
    resolve: BuilderApi['resolveTimeRange'];
    onChange: (earliest: string, latest: string) => void;
}

const DEBOUNCE_MS = 400;

export default function TimeRangeField({ idPrefix, earliest, latest, scheduledTime, timezone, resolve, onChange }: TimeRangeFieldProps) {
    const e = earliest || '';
    const l = latest || '';
    const derived = timeRangeChoice(e, l);
    // "Custom" with both fields still empty would read as All time, so remember the pick.
    const [forceCustom, setForceCustom] = useState(false);
    const choice = forceCustom && derived === 'all_time' ? 'custom' : derived;
    const [window, setWindow] = useState<{ earliest: number | null; latest: number } | null>(null);
    const [error, setError] = useState<{ field: string; message: string } | null>(null);

    useEffect(() => {
        setError(null);
        setWindow(null);
        if (!e.trim() && !l.trim()) {
            return undefined;
        }
        let stale = false;
        const timer = setTimeout(() => {
            resolve(e, l, scheduledTime).then(
                (r) => {
                    if (!stale) {
                        setWindow(r);
                    }
                },
                (err: { code?: string; message?: string; extra?: { field?: string } }) => {
                    if (!stale && err && err.code === 'bad_time') {
                        setError({ field: err.extra?.field || 'latest', message: err.message || 'This time is not valid.' });
                    }
                }
            );
        }, DEBOUNCE_MS);
        return () => {
            stale = true;
            clearTimeout(timer);
        };
    }, [e, l, scheduledTime, resolve]);

    const onSelect = (_ev: unknown, { value }: { value: unknown }) => {
        const key = String(value);
        if (key === 'custom') {
            setForceCustom(true);
            return;
        }
        setForceCustom(false);
        if (key === 'all_time') {
            onChange('', '');
            return;
        }
        const preset = TIME_RANGE_PRESETS.find((p) => p.key === key);
        if (preset) {
            onChange(preset.earliest, preset.latest);
        }
    };

    const fieldError = (field: string) => (error && error.field === field ? error.message : undefined);
    const readout =
        window && window.earliest !== null
            ? `For a run scheduled ${formatMoment(scheduledTime, timezone)}, this searches ${formatMoment(window.earliest, timezone)} to ${formatMoment(window.latest, timezone)}`
            : null;

    return (
        <div>
            <ControlGroup label="Time range" labelFor={`${idPrefix}-time-range`} labelPosition="top" help="Relative to the run's scheduled time, not when the step starts.">
                <Select inputId={`${idPrefix}-time-range`} data-testid="time-range-select" value={choice} onChange={onSelect}>
                    {TIME_RANGE_PRESETS.map((p) => (
                        <Select.Option key={p.key} label={p.label} value={p.key} />
                    ))}
                    <Select.Option label="All time" value="all_time" />
                    <Select.Option label="Custom" value="custom" />
                </Select>
            </ControlGroup>
            {choice === 'custom' && (
                <>
                    <ControlGroup label="Earliest" labelFor={`${idPrefix}-earliest`} labelPosition="top" error={fieldError('earliest')} help="Splunk relative time, e.g. -1d@d.">
                        <Text inputId={`${idPrefix}-earliest`} value={e} error={!!fieldError('earliest')} onChange={(_ev: unknown, { value }: { value: string }) => onChange(value, l)} />
                    </ControlGroup>
                    <ControlGroup label="Latest" labelFor={`${idPrefix}-latest`} labelPosition="top" error={fieldError('latest')} help="e.g. @d, or now.">
                        <Text inputId={`${idPrefix}-latest`} value={l} error={!!fieldError('latest')} onChange={(_ev: unknown, { value }: { value: string }) => onChange(e, value)} />
                    </ControlGroup>
                </>
            )}
            {choice === 'all_time' && <Message type="warning">Searches all time. Pick a range unless the search sets its own.</Message>}
            {readout && <Typography as="p" variant="body">{readout}</Typography>}
            {/* TODO(Task 13): add a "Learn more about time ranges" Link to the Help page. */}
        </div>
    );
}
