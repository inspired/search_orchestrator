/* The plain Message under a run's header that says why it needs attention: a delayed
 * step, or a failure that blocks the run. */
import React from 'react';
import Message from '@splunk/react-ui/Message';
import type { RunDetail, StepDef } from '../api/types';
import { formatSpan, formatSpanAdjective, joinNames } from '../format';
import { isStepDelayed } from './StatusText';

const DEFAULT_DELAYED_AFTER = 3600;

export interface BannerMessage {
    type: 'warning' | 'error';
    text: string;
}

function stepName(step: StepDef | undefined, id: string): string {
    return (step && step.name) || id;
}

function delayedAfter(run: RunDetail, step: StepDef | undefined): number {
    const own = step && step.delayed_after;
    if (own !== null && own !== undefined) {
        return own;
    }
    const job = run.definition.defaults && run.definition.defaults.delayed_after;
    return job !== null && job !== undefined ? job : DEFAULT_DELAYED_AFTER;
}

function successors(run: RunDetail, stepId: string): string[] {
    return (run.definition.edges || []).filter((e) => e.from === stepId).map((e) => e.to);
}

/** The banner sentences for a run, most urgent first. Empty when the run needs nothing. */
export function bannerMessages(run: RunDetail, now: number): BannerMessage[] {
    const steps = run.definition.steps || [];
    const byId: Record<string, StepDef> = {};
    steps.forEach((s) => {
        byId[s.id] = s;
    });
    const status = run.steps || {};
    const waitingNames = (ids: string[]) =>
        ids.filter((id) => status[id] && status[id].state === 'waiting').map((id) => stepName(byId[id], id));
    const out: BannerMessage[] = [];

    if (run.state === 'blocked') {
        const failed = steps.filter((s) => status[s.id] && status[s.id].state === 'failed');
        const parts = failed.map((s) => {
            const error = status[s.id].error;
            return error ? `${stepName(s, s.id)} failed (${error})` : `${stepName(s, s.id)} failed`;
        });
        let text = parts.length
            ? `This run is blocked: ${joinNames(parts)}.`
            : 'This run is blocked: a step failed.';
        const waiting = waitingNames(Array.from(new Set(failed.flatMap((s) => successors(run, s.id)))));
        if (waiting.length) {
            text += ` ${joinNames(waiting)} ${waiting.length === 1 ? 'is' : 'are'} waiting on ${
                failed.length === 1 ? 'it' : 'them'
            }.`;
        }
        text += ` Re-run from the failed step or cancel the run.`;
        out.push({ type: 'error', text });
    }

    if (run.state === 'queued' || run.state === 'running') {
        const late = steps.find((s) => status[s.id] && isStepDelayed(status[s.id]) && status[s.id].state !== 'waiting')
            || steps.find((s) => status[s.id] && isStepDelayed(status[s.id]));
        if (late && run.delay_base !== null && run.delay_base !== undefined) {
            const threshold = delayedAfter(run, late);
            const over = now - run.delay_base - threshold;
            let text = `${stepName(late, late.id)} is delayed. It passed its ${formatSpanAdjective(
                threshold
            )} threshold ${formatSpan(over)} ago.`;
            if (over < 60) {
                text = `${stepName(late, late.id)} is delayed. It just passed its ${formatSpanAdjective(
                    threshold
                )} threshold.`;
            }
            const next = waitingNames(successors(run, late.id));
            if (next.length) {
                text += ` ${joinNames(next)} will start when it finishes.`;
            }
            out.push({ type: 'warning', text });
        }
    }
    return out;
}

export interface RunBannerProps {
    run: RunDetail;
    /** Epoch seconds; defaults to the current time. */
    now?: number;
}

export default function RunBanner({ run, now }: RunBannerProps) {
    const messages = bannerMessages(run, now !== undefined ? now : Math.floor(Date.now() / 1000));
    if (!messages.length) {
        return null;
    }
    return (
        <>
            {messages.map((m) => (
                <Message key={m.type} type={m.type} appearance="default">
                    {m.text}
                </Message>
            ))}
        </>
    );
}
