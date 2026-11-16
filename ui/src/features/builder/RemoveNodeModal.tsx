/* Asks before a node is removed: "Remove <name>?" (a step's name, or an action's or trigger's
 * kind and detail, e.g. "Remove email (ops@example.com)?"), what goes with it, and that Undo brings it
 * back. `removeAction` is the reducer action that removes the node. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import Modal from '@splunk/react-ui/Modal';
import type { JobDefinition } from '../../api/types';
import { stepLabel } from './GraphView';
import { buildGraph } from './nodeModel';
import type { BuilderAction } from './reducer';

interface Removal {
    title: string;
    body: string;
    button: string;
    action: BuilderAction;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** Kind labels that are names keep their capital in a sentence. */
const PROPER = new Set(['Slack']);
const lower = (text: string) => (PROPER.has(text) ? text : text.charAt(0).toLowerCase() + text.slice(1));

/** What removing the node with `key` means; null for a node that cannot be removed. */
export function removal(job: JobDefinition, key: string): Removal | null {
    const node = buildGraph(job).nodes.find((n) => n.key === key);
    if (!node) {
        return null;
    }
    const name = (id: string) => {
        const s = (job.steps || []).find((x) => x.id === id);
        return s ? stepLabel(s) : id;
    };
    const it = (label: string, button: string, action: BuilderAction): Removal => ({
        title: `Remove ${label}?`,
        body: `${capital(label)} is removed. Undo brings it back.`,
        button,
        action,
    });
    // An action or trigger is named by its kind and, when set, what it is about.
    const kindAndDetail = () => {
        // "Pick a job" on a completion trigger with no job is a prompt, not a detail.
        const placeholder = node.kind === 'trigger_completion' && !(job.triggers || [])[node.trigger as number]?.job;
        const kind = lower(node.label);
        return node.detail && !placeholder ? `${kind} (${node.detail})` : kind;
    };
    if (node.stepId) {
        const label = name(node.stepId);
        const step = (job.steps || []).find((x) => x.id === node.stepId);
        const what = step && (step.actions || []).length ? `${label}, its actions and its connections` : `${label} and its connections`;
        return {
            title: `Remove ${label}?`,
            body: `${what} are removed. Undo brings them back.`,
            button: 'Remove step',
            action: { type: 'removeStep', id: node.stepId },
        };
    }
    if (node.action) {
        return it(kindAndDetail(), 'Remove action', { type: 'removeAction', scope: node.action.scope, index: node.action.index });
    }
    if (node.trigger !== undefined) {
        return it(kindAndDetail(), 'Remove trigger', { type: 'removeTrigger', index: node.trigger });
    }
    if (node.edge) {
        const { from, to } = node.edge;
        return it(`the condition from ${name(from)} to ${name(to)}`, 'Remove condition', { type: 'disconnect', from, to });
    }
    return null;
}

export interface RemoveNodeModalProps {
    job: JobDefinition;
    nodeKey: string;
    returnFocus: React.MutableRefObject<HTMLElement | null>;
    onCancel: () => void;
    onConfirm: (action: BuilderAction) => void;
}

export default function RemoveNodeModal({ job, nodeKey, returnFocus, onCancel, onConfirm }: RemoveNodeModalProps) {
    const r = removal(job, nodeKey);
    if (!r) {
        return null;
    }
    return (
        <Modal open onRequestClose={onCancel} returnFocus={returnFocus} style={{ width: '480px' }}>
            <Modal.Header title={r.title} />
            <Modal.Body>
                <p>{r.body}</p>
            </Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Cancel" onClick={onCancel} />
                <Button appearance="destructive" label={r.button} onClick={() => onConfirm(r.action)} />
            </Modal.Footer>
        </Modal>
    );
}
