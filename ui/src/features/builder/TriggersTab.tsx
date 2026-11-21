/* The Standard view's Triggers tab: one card per trigger (the same panel the Advanced view
 * opens for a trigger node: schedule with next runs and busy times, or after another job),
 * each with the first steps it starts, and buttons to add a schedule or an after-job
 * trigger. Starts writes the trigger's `steps` through setTriggerStep, which is what the
 * Advanced view's trigger lines do. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Switch from '@splunk/react-ui/Switch';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { Job, JobDefinition } from '../../api/types';
import { stepLabel } from './GraphView';
import { activeCatalog } from './nodeCatalog';
import { triggerKey } from './nodeModel';
import type { BuilderAction } from './reducer';
import TriggerPanel, { TriggerPanelProps } from './TriggerPanel';
import { rootSteps, setTriggerStep, startedBy } from './triggerSteps';

export interface TriggersTabProps {
    job: JobDefinition;
    jobs: Pick<Job, 'id' | 'name'>[];
    dispatch: React.Dispatch<BuilderAction>;
    nextSlots?: TriggerPanelProps['nextSlots'];
    schedulePreview?: TriggerPanelProps['schedulePreview'];
    savedJobId?: string | null;
    onOpenSettings: () => void;
    /** The page confirms, then removes (by the trigger's node key). */
    onRequestRemove?: (key: string) => void;
}

export default function TriggersTab({ job, jobs, dispatch, nextSlots, schedulePreview, savedJobId, onOpenSettings, onRequestRemove }: TriggersTabProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const triggers = job.triggers || [];
    const roots = rootSteps(job);
    const names = Object.fromEntries((job.steps || []).map((s) => [s.id, stepLabel(s)]));
    const kinds = new Set(activeCatalog().map((e) => e.kind));
    const remove = (i: number) => (onRequestRemove ? onRequestRemove(triggerKey(i)) : dispatch({ type: 'removeTrigger', index: i }));
    return (
        <div>
            {!triggers.length && <p style={{ color: theme.contentColorMuted }}>No triggers: the job runs only when started by hand, from a search, an alert or the REST API.</p>}
            {triggers.map((t, i) => {
                const starts = startedBy(job, t);
                return (
                    <section
                        key={`${i}-${t.type}`}
                        aria-label={`Trigger ${i + 1}`}
                        style={{ border: `1px solid ${theme.borderColor}`, borderRadius: '8px', padding: '12px 16px', marginBottom: '12px', maxWidth: '760px' }}
                    >
                        <TriggerPanel
                            job={job}
                            index={i}
                            jobs={jobs}
                            nextSlots={nextSlots}
                            schedulePreview={schedulePreview}
                            savedJobId={savedJobId}
                            dispatch={dispatch}
                            onRequestRemove={() => remove(i)}
                            onOpenSettings={onOpenSettings}
                        />
                        <ControlGroup label="Starts" labelPosition="top" help="The first steps this trigger starts (steps with no line into them).">
                            <div data-testid={`trigger-${i}-starts`} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                                {roots.length ? (
                                    roots.map((id) => (
                                        <Switch
                                            key={id}
                                            appearance="checkbox"
                                            selected={starts.includes(id)}
                                            onClick={() => {
                                                const next = setTriggerStep(job, i, id, !starts.includes(id));
                                                if (next) {
                                                    dispatch({ type: 'setJob', job: next });
                                                }
                                            }}
                                        >
                                            {names[id] || id}
                                        </Switch>
                                    ))
                                ) : (
                                    <span style={{ color: theme.contentColorMuted }}>No steps yet.</span>
                                )}
                            </div>
                        </ControlGroup>
                    </section>
                );
            })}
            <div style={{ display: 'flex', gap: '8px' }}>
                {kinds.has('trigger_cron') && <Button appearance="secondary" label="Add schedule" onClick={() => dispatch({ type: 'addNode', kind: 'trigger_cron' })} />}
                {kinds.has('trigger_completion') && <Button appearance="secondary" label="Add after another job" onClick={() => dispatch({ type: 'addNode', kind: 'trigger_completion' })} />}
            </div>
        </div>
    );
}
