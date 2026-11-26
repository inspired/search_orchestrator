/* The side panel for a selected action node: when it fires (a step or the whole job, and
 * which of its outcomes), what it does (with its preset's options), how often it is retried
 * when sending fails, and removing it. */
import React from 'react';
import OutputViewer from '../output/OutputViewer';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import NumberInput from '@splunk/react-ui/Number';
import Select from '@splunk/react-ui/Select';
import Switch from '@splunk/react-ui/Switch';
import Text from '@splunk/react-ui/Text';
import type { Action, AlertAction, Issue, JobDefinition } from '../../api/types';
import { ActionFields } from './ActionsEditor';
import { stepLabel } from './GraphView';
import { IssueList } from './StepPanel';
import { ActionScope, HOOK_FOR_PORT, PortId, actionKey, nodeKindOfStep, outputPorts } from './nodeModel';
import { PORT_STYLE } from './nodeStyle';
import type { BuilderAction } from './reducer';
import type { TokenGroup } from './tokens';

export interface ActionPanelProps {
    job: JobDefinition;
    scope: ActionScope;
    index: number;
    alertActions?: AlertAction[] | null;
    tokenGroups?: TokenGroup[];
    /** Problems the check found with this action. */
    issues?: Issue[];
    dispatch: React.Dispatch<BuilderAction>;
    /** Called with the node key the action has after a move, so the page can keep it selected. */
    onMoved: (key: string) => void;
    /** The page confirms, then removes. */
    onRequestRemove: (key: string) => void;
}

export const DEFAULT_RETRIES = 3;
export const DEFAULT_RETRY_WAIT = 30;

/** The retries line: "3 retries, after 30 s, 60 s and 120 s". */
export function retryText(retries: number, wait: number): string {
    if (retries === 0) {
        return 'No retries: a failed send fails the action at once.';
    }
    const waits = Array.from({ length: Math.min(retries, 4) }, (_, i) => Math.min(wait * 2 ** i, 3600));
    const fmt = (s: number) => (s >= 3600 ? '1 h' : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
    const shown = waits.map(fmt);
    const list = shown.length > 1 ? `${shown.slice(0, -1).join(', ')}${retries > 4 ? ', …' : ''} and ${shown[shown.length - 1]}` : shown[0];
    return `${retries} retr${retries === 1 ? 'y' : 'ies'}, waiting ${list}${retries > 4 ? ' (at most 1 h each)' : ''}. Errors that won't go away (such as a 404 or a missing destination) fail at once.`;
}

const WHEN_PORTS: PortId[] = ['success', 'failure', 'always', 'start', 'delayed', 'late', 'approval'];
const encode = (scope: ActionScope, hook: Action['hook']) => `${scope}:${hook}`;
const decode = (value: string): { scope: ActionScope; hook: Action['hook'] } => {
    const at = value.lastIndexOf(':');
    return { scope: value.slice(0, at), hook: value.slice(at + 1) as Action['hook'] };
};

/** The changes that turn `from` into `to`; a field `to` no longer has is cleared. */
function diff(from: Action, to: Action): Partial<Action> {
    const changes: Record<string, unknown> = {};
    Object.keys(to).forEach((k) => {
        if (JSON.stringify(to[k]) !== JSON.stringify(from[k])) {
            changes[k] = to[k];
        }
    });
    Object.keys(from).forEach((k) => {
        if (!(k in to)) {
            changes[k] = undefined;
        }
    });
    return changes as Partial<Action>;
}

export default function ActionPanel({ job, scope, index, alertActions, tokenGroups, issues = [], dispatch, onMoved, onRequestRemove }: ActionPanelProps) {
    const steps = job.steps || [];
    const list = (s: ActionScope): Action[] => (s === 'job' ? job.actions : steps.find((x) => x.id === s)?.actions) || [];
    const action = list(scope)[index];
    if (!action) {
        return null;
    }
    // Whole-job actions live on the Job actions tab; a step's action moves between steps only.
    const sources = steps.map((s) => ({ scope: s.id as ActionScope, label: stepLabel(s), ports: outputPorts(nodeKindOfStep(s)) }));
    const key = actionKey(scope, index);
    const current = encode(scope, action.hook);

    const onWhen = (value: string) => {
        if (value === current) {
            return;
        }
        const target = decode(value);
        dispatch({ type: 'moveAction', scope, index, toScope: target.scope, hook: target.hook });
        onMoved(target.scope === scope ? key : actionKey(target.scope, list(target.scope).length));
    };

    return (
        <section aria-label="Action">
            <Heading level={2}>Action</Heading>
            <IssueList issues={issues} />
            <ControlGroup label="When" labelFor="action-when" labelPosition="top">
                <Select inputId="action-when" value={current} onChange={(_e: unknown, { value }: { value: unknown }) => onWhen(String(value))}>
                    {sources.map((src) =>
                        WHEN_PORTS.filter((port) => src.ports.includes(port)).map((port) => {
                            const hook = HOOK_FOR_PORT[port] as Action['hook'];
                            return <Select.Option key={encode(src.scope, hook)} label={`${src.label} · ${PORT_STYLE[port].label}`} value={encode(src.scope, hook)} />;
                        })
                    )}
                </Select>
            </ControlGroup>
            <ActionFields
                action={action}
                idPrefix={`action-${scope}-${index}`}
                alertActions={alertActions}
                tokenGroups={tokenGroups}
                onChange={(next) => dispatch({ type: 'updateAction', scope, index, changes: diff(action, next) })}
            />
            {scope !== 'job' && action.hook === 'on_success' && action.type !== 'start_job' && (
                <Switch
                    appearance="checkbox"
                    selected={action.only_if_results === true}
                    onClick={() => dispatch({ type: 'updateAction', scope, index, changes: { only_if_results: action.only_if_results === true ? undefined : true } })}
                >
                    Only if the step found results
                </Switch>
            )}
            {scope !== 'job' && action.hook === 'on_success' && action.type !== 'start_job' && (
                <ControlGroup
                    label="Only when"
                    labelFor={`action-${scope}-${index}-condition`}
                    labelPosition="top"
                    help="Optional. A comparison, as on an If… line, such as $count.resultCount$ > 100; empty always sends."
                >
                    <Text
                        inputId={`action-${scope}-${index}-condition`}
                        value={typeof action.condition === 'string' ? action.condition : ''}
                        onChange={(_e: unknown, { value }: { value: string }) => dispatch({ type: 'updateAction', scope, index, changes: { condition: value || undefined } })}
                    />
                </ControlGroup>
            )}
            {(action.type === 'email' || action.type === 'event') && (
                <div style={{ marginTop: '12px' }}>
                    <OutputViewer
                        target={{ action: { scope, index } }}
                        name={action.type === 'email' ? `Email to ${action.to || ''}` : `Event to ${action.index || ''}`}
                        job={job}
                        label={action.type === 'email' ? 'View sent emails' : 'View output'}
                    />
                </div>
            )}
            {action.type !== 'start_job' && (
                <div data-testid="action-retries" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
                    <ControlGroup label="Retries" labelFor={`action-${scope}-${index}-retries`} labelPosition="top" help="0 to 10">
                        <NumberInput
                            inputId={`action-${scope}-${index}-retries`}
                            min={0}
                            max={10}
                            step={1}
                            roundTo={0}
                            value={typeof action.retries === 'number' ? action.retries : DEFAULT_RETRIES}
                            onChange={(_e: unknown, { value }: { value?: number }) => {
                                const v = value === undefined || Number.isNaN(value) ? undefined : Math.max(0, Math.min(10, Math.round(value)));
                                dispatch({ type: 'updateAction', scope, index, changes: { retries: v === DEFAULT_RETRIES ? undefined : v } });
                            }}
                        />
                    </ControlGroup>
                    <ControlGroup label="First wait (seconds)" labelFor={`action-${scope}-${index}-retry-wait`} labelPosition="top" help="10 to 3600; doubles each time">
                        <NumberInput
                            inputId={`action-${scope}-${index}-retry-wait`}
                            min={10}
                            max={3600}
                            step={10}
                            roundTo={0}
                            value={typeof action.retry_wait === 'number' ? action.retry_wait : DEFAULT_RETRY_WAIT}
                            onChange={(_e: unknown, { value }: { value?: number }) => {
                                const v = value === undefined || Number.isNaN(value) ? undefined : Math.max(10, Math.min(3600, Math.round(value)));
                                dispatch({ type: 'updateAction', scope, index, changes: { retry_wait: v === DEFAULT_RETRY_WAIT ? undefined : v } });
                            }}
                        />
                    </ControlGroup>
                    <p style={{ flex: '1 1 100%', margin: 0, fontSize: '12px' }}>
                        {retryText(typeof action.retries === 'number' ? action.retries : DEFAULT_RETRIES, typeof action.retry_wait === 'number' ? action.retry_wait : DEFAULT_RETRY_WAIT)}
                    </p>
                </div>
            )}
            <div style={{ marginTop: '12px' }}>
                <Button appearance="destructive" label="Remove action" onClick={() => onRequestRemove(key)} />
            </div>
        </section>
    );
}
