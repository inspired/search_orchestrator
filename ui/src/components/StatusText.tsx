/* Run and step status as plain text with an icon. Colour only for failed and delayed;
 * never a filled pill or badge (owner's call). */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import ArrowClockwise from '@splunk/react-icons/ArrowClockwise';
import CheckCircle from '@splunk/react-icons/CheckCircle';
import Circle from '@splunk/react-icons/Circle';
import CircleDashed from '@splunk/react-icons/CircleDashed';
import CircleSlashed from '@splunk/react-icons/CircleSlashed';
import Clock from '@splunk/react-icons/Clock';
import ControlFastForward from '@splunk/react-icons/ControlFastForward';
import ControlPause from '@splunk/react-icons/ControlPause';
import ControlPlay from '@splunk/react-icons/ControlPlay';
import CrossCircle from '@splunk/react-icons/CrossCircle';
import ExclamationTriangle from '@splunk/react-icons/ExclamationTriangle';
import Hourglass from '@splunk/react-icons/Hourglass';
import MinusCircle from '@splunk/react-icons/MinusCircle';
import type { AnyState, LastRun, RunSummary, SkipKind, StepStatus } from '../api/types';

const LABELS: Record<AnyState, string> = {
    queued: 'Queued',
    running: 'Running',
    blocked: 'Blocked',
    paused: 'Paused',
    succeeded: 'Succeeded',
    failed: 'Failed',
    cancelled: 'Cancelled',
    waiting: 'Waiting',
    ready: 'Ready',
    starting: 'Starting',
    retrying: 'Retrying',
    skipped: 'Skipped',
    abandoned: 'Abandoned',
};

type Icon = React.ComponentType<React.SVGProps<SVGSVGElement> & { 'aria-hidden'?: boolean }>;

const ICONS: Record<AnyState, Icon> = {
    queued: Hourglass,
    running: ControlPlay,
    blocked: ExclamationTriangle,
    paused: ControlPause,
    succeeded: CheckCircle,
    failed: CrossCircle,
    cancelled: CircleSlashed,
    waiting: Circle,
    ready: CircleDashed,
    starting: ControlPlay,
    retrying: ArrowClockwise,
    skipped: ControlFastForward,
    abandoned: MinusCircle,
};

/** Visually hidden but read by screen readers. Use inside a positioned element. */
export const srOnly: React.CSSProperties = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
};

const RUN_DELAYABLE = ['queued', 'running'];
const STEP_UNFINISHED = ['waiting', 'ready', 'starting', 'running', 'retrying'];

/** A run is delayed while it is still working and its delay alert has fired. */
export function isRunDelayed(run: Pick<RunSummary, 'state' | 'delay_alerted'> | LastRun): boolean {
    return Boolean(run.delay_alerted) && RUN_DELAYABLE.includes(run.state);
}

/** A step is delayed while unfinished and past its delayed_after. */
export function isStepDelayed(step: StepStatus): boolean {
    return Boolean(step.delay_alerted) && STEP_UNFINISHED.includes(step.state);
}

export function statusLabel(state: AnyState, delayed = false, skipKind?: SkipKind | null): string {
    if (delayed) {
        return 'Delayed';
    }
    if (state === 'skipped' && skipKind) {
        return skipKind === 'run_when' ? 'Skipped (run when)' : 'Skipped (not taken)';
    }
    return LABELS[state] || state;
}

/** The icon StatusText shows for a state; also drawn on the step graph. */
export function statusIcon(state: AnyState, delayed = false): Icon {
    return delayed ? Clock : ICONS[state] || Circle;
}

export interface StatusTextProps {
    state: AnyState;
    delayed?: boolean;
    skipKind?: SkipKind | null;
}

export default function StatusText({ state, delayed = false, skipKind }: StatusTextProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const IconFor = statusIcon(state, delayed);
    let color: string | undefined;
    if (delayed) {
        color = theme.statusColorMedium;
    } else if (state === 'failed') {
        color = theme.statusColorHigh;
    }
    const label = statusLabel(state, delayed, skipKind);
    const style: React.CSSProperties = {
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35em',
    };
    if (color) {
        style.color = color;
    }
    return (
        <span style={style} data-state={state} data-delayed={delayed ? 'true' : undefined}>
            <IconFor aria-hidden />
            <span>{label}</span>
            {delayed && <span style={srOnly}>{`, ${LABELS[state] || state}`}</span>}
        </span>
    );
}
