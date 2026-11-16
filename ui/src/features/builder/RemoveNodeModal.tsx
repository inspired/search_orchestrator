/* Asks before a node is removed: "Remove <name>?", what goes with it, and that Undo brings it
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
    if (node.stepId) {
        const label = name(node.stepId);
        return {
            title: `Remove ${label}?`,
            body: `${label} and its connections are removed. Undo brings them back.`,
            button: 'Remove step',
            action: { type: 'removeStep', id: node.stepId },
        };
    }
    if (node.action) {
        return it(node.label, 'Remove action', { type: 'removeAction', scope: node.action.scope, index: node.action.index });
    }
    if (node.trigger !== undefined) {
        return it(node.label, 'Remove trigger', { type: 'removeTrigger', index: node.trigger });
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
