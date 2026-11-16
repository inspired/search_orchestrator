/* The side panel for a selected action node: when it fires (a step or the whole job, and
 * which of its outcomes), what it does, and removing it. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Select from '@splunk/react-ui/Select';
import type { Action, AlertAction, Destination, Issue, JobDefinition } from '../../api/types';
import { ActionFields } from './ActionsEditor';
import { stepLabel } from './GraphView';
import { IssueList } from './StepPanel';
import { ActionScope, HOOK_FOR_PORT, PortId, actionKey } from './nodeModel';
import { PORT_STYLE } from './nodeStyle';
import type { BuilderAction } from './reducer';
import type { TokenGroup } from './tokens';

export interface ActionPanelProps {
    job: JobDefinition;
    scope: ActionScope;
    index: number;
    destinations: Destination[];
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

const WHEN_PORTS: PortId[] = ['success', 'failure', 'always', 'start', 'delayed'];
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

export default function ActionPanel({ job, scope, index, destinations, alertActions, tokenGroups, issues = [], dispatch, onMoved, onRequestRemove }: ActionPanelProps) {
    const steps = job.steps || [];
    const list = (s: ActionScope): Action[] => (s === 'job' ? job.actions : steps.find((x) => x.id === s)?.actions) || [];
    const action = list(scope)[index];
    if (!action) {
        return null;
    }
    const sources = [...steps.map((s) => ({ scope: s.id as ActionScope, label: stepLabel(s) })), { scope: 'job' as ActionScope, label: 'Whole job' }];
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
                        WHEN_PORTS.map((port) => {
                            const hook = HOOK_FOR_PORT[port] as Action['hook'];
                            return <Select.Option key={encode(src.scope, hook)} label={`${src.label} · ${PORT_STYLE[port].label}`} value={encode(src.scope, hook)} />;
                        })
                    )}
                </Select>
            </ControlGroup>
            <ActionFields
                action={action}
                idPrefix={`action-${scope}-${index}`}
                destinations={destinations}
                alertActions={alertActions}
                tokenGroups={tokenGroups}
                onChange={(next) => dispatch({ type: 'updateAction', scope, index, changes: diff(action, next) })}
            />
            <div style={{ marginTop: '12px' }}>
                <Button appearance="destructive" label="Remove action" onClick={() => onRequestRemove(key)} />
            </div>
        </section>
    );
}
