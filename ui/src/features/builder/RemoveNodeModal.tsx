/* Asks before a node is removed: "Remove <name>?" (a step's name, or an action's or trigger's
 * kind and detail, e.g. "Remove email (ops@example.com)?"), what goes with it, and that Undo brings it
 * back. For several nodes: "Remove 4 nodes?" with their names (at most eight, then "and 3 more").
 * `action` is the reducer action that removes them. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import Modal from '@splunk/react-ui/Modal';
import type { JobDefinition } from '../../api/types';
import { stepLabel } from './GraphView';
import { JOB_KEY, buildGraph } from './nodeModel';
import type { FlowNode } from './nodeModel';
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

/** The most names the confirm for several nodes lists. */
const MAX_NAMES = 8;

/** What removing the node with `key` means; null for a node that cannot be removed. */
export function removal(job: JobDefinition, key: string): Removal | null {
    const node = buildGraph(job).nodes.find((n) => n.key === key);
    if (!node) {
        return null;
    }
    const label = nodeLabel(job, node);
    if (node.stepId) {
        const step = (job.steps || []).find((x) => x.id === node.stepId);
        const what = step && (step.actions || []).length ? `${label}, its actions and its connections` : `${label} and its connections`;
        return {
            title: `Remove ${label}?`,
            body: `${what} are removed. Undo brings them back.`,
            button: 'Remove step',
            action: { type: 'removeStep', id: node.stepId },
        };
    }
    const it = (button: string, action: BuilderAction): Removal => ({
        title: `Remove ${label}?`,
        body: `${capital(label)} is removed. Undo brings it back.`,
        button,
        action,
    });
    if (node.action) {
        return it('Remove action', { type: 'removeAction', scope: node.action.scope, index: node.action.index });
    }
    if (node.trigger !== undefined) {
        return it('Remove trigger', { type: 'removeTrigger', index: node.trigger });
    }
    if (node.edge) {
        return it('Remove condition', { type: 'disconnect', from: node.edge.from, to: node.edge.to });
    }
    return null;
}

export interface Removals extends Removal {
    /** Names of the first eight nodes, each starting with a capital. */
    names: string[];
    /** How many more nodes are removed than `names` lists. */
    more: number;
    note: string;
}

/** What removing the nodes `keys` means: one node as `removal`, several as one "Remove N nodes?"
 * (the whole job is left out; it cannot be removed). Null when none can be removed. */
export function removals(job: JobDefinition, keys: string[]): Removals | null {
    const nodes = buildGraph(job).nodes.filter((n) => n.key !== JOB_KEY && keys.includes(n.key));
    const ordered = keys.map((k) => nodes.find((n) => n.key === k)).filter((n): n is FlowNode => n !== undefined);
    if (ordered.length === 1) {
        const one = removal(job, ordered[0].key);
        return one && { ...one, names: [], more: 0, note: '' };
    }
    if (!ordered.length) {
        return null;
    }
    const names = ordered.map((n) => capital(nodeLabel(job, n)));
    return {
        title: `Remove ${ordered.length} nodes?`,
        body: '',
        button: 'Remove nodes',
        action: { type: 'removeNodes', keys: ordered.map((n) => n.key) },
        names: names.slice(0, MAX_NAMES),
        more: Math.max(0, names.length - MAX_NAMES),
        note: 'Undo brings them back.',
    };
}

/** How a removal names a node: a step's name, an action's or trigger's kind and detail, or
 * "the condition from A to B". */
function nodeLabel(job: JobDefinition, node: FlowNode): string {
    const name = (id: string) => {
        const s = (job.steps || []).find((x) => x.id === id);
        return s ? stepLabel(s) : id;
    };
    // An action or trigger is named by its kind and, when set, what it is about.
    const kindAndDetail = () => {
        // "Pick a job" on a completion trigger with no job is a prompt, not a detail.
        const placeholder = node.kind === 'trigger_completion' && !(job.triggers || [])[node.trigger as number]?.job;
        const kind = lower(node.label);
        return node.detail && !placeholder ? `${kind} (${node.detail})` : kind;
    };
    if (node.stepId) {
        return name(node.stepId);
    }
    if (node.edge) {
        return `the condition from ${name(node.edge.from)} to ${name(node.edge.to)}`;
    }
    return kindAndDetail();
}

export interface RemoveNodeModalProps {
    job: JobDefinition;
    /** One node, or several (one confirm for all of them). */
    nodeKey: string | string[];
    returnFocus: React.MutableRefObject<HTMLElement | null>;
    onCancel: () => void;
    onConfirm: (action: BuilderAction) => void;
}

export default function RemoveNodeModal({ job, nodeKey, returnFocus, onCancel, onConfirm }: RemoveNodeModalProps) {
    const r = removals(job, typeof nodeKey === 'string' ? [nodeKey] : nodeKey);
    if (!r) {
        return null;
    }
    return (
        <Modal open onRequestClose={onCancel} returnFocus={returnFocus} style={{ width: '480px' }}>
            <Modal.Header title={r.title} />
            <Modal.Body>
                {r.names.length ? (
                    <>
                        <ul>
                            {r.names.map((n, i) => (
                                // eslint-disable-next-line react/no-array-index-key
                                <li key={i}>{n}</li>
                            ))}
                            {r.more > 0 && <li>{`and ${r.more} more`}</li>}
                        </ul>
                        <p>{r.note}</p>
                    </>
                ) : (
                    <p>{r.body}</p>
                )}
            </Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Cancel" onClick={onCancel} />
                <Button appearance="destructive" label={r.button} onClick={() => onConfirm(r.action)} />
            </Modal.Footer>
        </Modal>
    );
}
