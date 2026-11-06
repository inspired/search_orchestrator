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

export interface StatusTextProps {
    state: AnyState;
    delayed?: boolean;
    skipKind?: SkipKind | null;
}

export default function StatusText({ state, delayed = false, skipKind }: StatusTextProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const IconFor = delayed ? Clock : ICONS[state] || Circle;
    let color: string | undefined;
    if (delayed) {
        color = theme.statusColorMedium;
    } else if (state === 'failed') {
        color = theme.statusColorHigh;
    }
    const label = statusLabel(state, delayed, skipKind);
    const style: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '0.35em' };
    if (color) {
        style.color = color;
    }
    return (
        <span style={style} data-state={state} data-delayed={delayed ? 'true' : undefined}>
            <IconFor aria-hidden />
            <span>{label}</span>
            {delayed && <span style={{ position: 'absolute', left: '-10000px' }}>{`, ${LABELS[state] || state}`}</span>}
        </span>
    );
}
