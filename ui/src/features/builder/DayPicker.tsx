/* Run-when "Days of week": one row of day buttons (Mon to Sun) that fits the step panel,
 * with shortcuts for weekdays, weekends and every day. At least one day stays on. All colour
 * comes from theme tokens. */
import React from 'react';
import styled from 'styled-components';
import Button from '@splunk/react-ui/Button';
import { variables } from '@splunk/themes';
import { WEEK } from './graphLogic';

// ControlGroup lays its children out in a flex row, so take the full width.
const Wrapper = styled.div`
    flex: 1 1 auto;
    min-width: 0;
`;

const Row = styled.div`
    display: flex;
    border: 1px solid ${variables.interactiveColorBorder};
    border-radius: ${variables.borderRadius};
    overflow: hidden;
`;

const Day = styled.button`
    flex: 1 1 0;
    min-width: 0;
    padding: 6px 0;
    border: 0;
    border-left: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.interactiveColorBackground};
    color: ${variables.contentColorDefault};
    font: inherit;
    cursor: pointer;
    &:first-child {
        border-left: 0;
    }
    &:hover {
        background: ${variables.backgroundColorHover};
    }
    &[aria-pressed='true'] {
        background: ${variables.interactiveColorPrimary};
        color: ${variables.contentColorInverted};
    }
    &[aria-disabled='true'] {
        cursor: not-allowed;
    }
    &:focus-visible {
        outline: none;
        box-shadow: ${variables.focusShadowInset};
    }
`;

const Shortcuts = styled.div`
    display: flex;
    gap: 4px;
    margin-top: 4px;
`;

const SHORTCUTS: { label: string; days: number[] }[] = [
    { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
    { label: 'Weekends', days: [0, 6] },
    { label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
];

export interface DayPickerProps {
    /** Cron day numbers that are on (0 is Sunday). */
    days: number[];
    onChange: (days: number[]) => void;
    labelledBy?: string;
}

export default function DayPicker({ days, onChange, labelledBy }: DayPickerProps) {
    const toggle = (day: number) => {
        const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
        if (next.length) {
            onChange(next);
        }
    };
    return (
        <Wrapper>
            <Row role="group" aria-labelledby={labelledBy}>
                {WEEK.map((w) => {
                    const on = days.includes(w.day);
                    // aria-disabled (not disabled) keeps the last day focusable and announced.
                    const last = on && days.length === 1;
                    return (
                        <Day
                            key={w.day}
                            type="button"
                            title={last ? `${w.name} (keep at least one day)` : w.name}
                            aria-label={w.name}
                            aria-pressed={on}
                            aria-disabled={last || undefined}
                            onClick={() => !last && toggle(w.day)}
                        >
                            {w.short}
                        </Day>
                    );
                })}
            </Row>
            <Shortcuts>
                {SHORTCUTS.map((s) => (
                    <Button key={s.label} appearance="subtle" label={s.label} onClick={() => onChange(s.days)} />
                ))}
            </Shortcuts>
        </Wrapper>
    );
}
