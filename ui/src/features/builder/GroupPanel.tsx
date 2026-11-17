/* The side panel for a selected group: its title, its colour (seven named colours), collapse or
 * expand, and Remove group (which never removes its nodes); and the confirm before removing it. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Modal from '@splunk/react-ui/Modal';
import Select from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';
import { countText } from './GroupFrame';
import { GROUP_COLORS, Group, GroupColor } from './groups';

export const groupTitleId = (id: string) => `group-${id}-title`;

export interface GroupPanelProps {
    group: Group;
    /** How many nodes are inside the frame now. */
    members: number;
    onChange: (changes: Partial<Group>) => void;
    /** The page confirms, then removes the group. */
    onRequestRemove: () => void;
}

export default function GroupPanel({ group, members, onChange, onRequestRemove }: GroupPanelProps) {
    const titleId = groupTitleId(group.id);
    return (
        <section aria-label="Group">
            <Heading level={2}>Group</Heading>
            <p>{`${countText(members)} inside. Drag the title bar to move them together; nodes stay when the group is removed.`}</p>
            <ControlGroup label="Title" labelFor={titleId} labelPosition="top">
                <Text inputId={titleId} value={group.title} maxLength={80} onChange={(_e: unknown, { value }: { value: string }) => onChange({ title: value })} />
            </ControlGroup>
            <ControlGroup label="Colour" labelFor={`group-${group.id}-color`} labelPosition="top">
                <Select inputId={`group-${group.id}-color`} value={group.color} onChange={(_e: unknown, { value }: { value: unknown }) => onChange({ color: value as GroupColor })}>
                    {GROUP_COLORS.map((c) => (
                        <Select.Option key={c.token} label={c.label} value={c.token} />
                    ))}
                </Select>
            </ControlGroup>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <Button appearance="secondary" label={group.collapsed ? 'Expand' : 'Collapse'} onClick={() => onChange({ collapsed: !group.collapsed })} />
                <Button appearance="destructive" label="Remove group" onClick={onRequestRemove} />
            </div>
        </section>
    );
}

export interface RemoveGroupModalProps {
    group: Group;
    returnFocus: React.MutableRefObject<HTMLElement | null>;
    onCancel: () => void;
    onConfirm: () => void;
}

export function RemoveGroupModal({ group, returnFocus, onCancel, onConfirm }: RemoveGroupModalProps) {
    return (
        <Modal open onRequestClose={onCancel} returnFocus={returnFocus} style={{ width: '480px' }}>
            <Modal.Header title={`Remove group ${group.title || 'without a title'}?`} />
            <Modal.Body>The nodes in it stay.</Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Cancel" onClick={onCancel} />
                <Button appearance="destructive" label="Remove group" onClick={onConfirm} />
            </Modal.Footer>
        </Modal>
    );
}
