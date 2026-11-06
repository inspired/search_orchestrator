/* The run's timeline: a label, a bar (solid while running, hatched while waiting, none
 * when skipped) and plain status text per step. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { RunDetail } from '../../api/types';
import StatusText from '../../components/StatusText';
import { Bar, bars } from './bars';

export interface TimelineProps {
    run: RunDetail;
    now: number;
    selected?: string | null;
    onSelect: (stepId: string) => void;
}

export default function Timeline({ run, now, selected, onSelect }: TimelineProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const rows = bars(run, now);

    const fill = (bar: Bar): React.CSSProperties => {
        if (bar.kind === 'waiting') {
            return {
                backgroundImage: `repeating-linear-gradient(135deg, ${theme.borderColorStrong} 0 5px, ${theme.backgroundColorSection} 5px 10px)`,
            };
        }
        if (bar.kind === 'failed') {
            return { backgroundColor: theme.statusColorHigh };
        }
        if (bar.delayed) {
            return { backgroundColor: theme.statusColorMedium };
        }
        if (bar.kind === 'done') {
            return { backgroundColor: theme.contentColorMuted };
        }
        return { backgroundColor: theme.contentColorDefault };
    };

    const status = run.steps || {};
    return (
        <div role="list" aria-label="Step timeline" style={{ padding: '8px 0 12px' }}>
            {rows.map((bar) => {
                const st = status[bar.stepId];
                return (
                    <div
                        role="listitem"
                        key={bar.stepId}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '150px 1fr 170px',
                            gap: '10px',
                            alignItems: 'center',
                            padding: '6px 14px',
                            background: selected === bar.stepId ? theme.backgroundColorHover : undefined,
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => onSelect(bar.stepId)}
                            style={{
                                background: 'none',
                                border: 0,
                                padding: 0,
                                textAlign: 'left',
                                cursor: 'pointer',
                                color: theme.contentColorLink,
                                font: 'inherit',
                            }}
                        >
                            {bar.label}
                        </button>
                        <div
                            style={{
                                position: 'relative',
                                height: '18px',
                                background: theme.backgroundColorSection,
                                borderRadius: '3px',
                            }}
                        >
                            {bar.kind !== 'skipped' && (
                                <div
                                    data-testid={`bar-${bar.stepId}`}
                                    data-kind={bar.kind}
                                    data-pattern={bar.kind === 'waiting' ? 'hatched' : 'solid'}
                                    style={{
                                        position: 'absolute',
                                        top: '2px',
                                        bottom: '2px',
                                        borderRadius: '2px',
                                        left: `${bar.startPct}%`,
                                        width: `${bar.widthPct}%`,
                                        ...fill(bar),
                                    }}
                                />
                            )}
                        </div>
                        <StatusText
                            state={st ? st.state : 'waiting'}
                            delayed={bar.delayed}
                            skipKind={st ? st.skip_kind : undefined}
                        />
                    </div>
                );
            })}
        </div>
    );
}
