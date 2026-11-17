/* An approval step's own settings, inside its step panel: the message approvers see, who may
 * approve, how long to wait and what happens if nobody decides. Only fields that differ from
 * their defaults are written: an empty message, no roles, no time limit and Reject leave
 * `approval` as {}. */
import React from 'react';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Multiselect from '@splunk/react-ui/Multiselect';
import Select from '@splunk/react-ui/Select';
import type { StepDef } from '../../api/types';
import { CAP_APPROVE } from '../../appNames';
import { TokenInput } from './InsertToken';
import type { BuilderAction } from './reducer';
import { DurationField } from './StepPanel';
import type { TokenGroup } from './tokens';

type Approval = NonNullable<StepDef['approval']>;

export interface ApprovalPanelProps {
    step: StepDef;
    /** Roles to offer; others can be typed. */
    roles: string[];
    dispatch: (action: BuilderAction) => void;
    /** The tokens Insert value offers in the message. */
    tokenGroups?: TokenGroup[];
    /** Seconds after which the step gives up (its own or the job's default). */
    giveUpAfter?: number | null;
}

export const LONGER_THAN_GIVE_UP = "Wait at most is longer than this step's Give up after, so the run gives up first.";

export default function ApprovalPanel({ step, roles, dispatch, tokenGroups = [], giveUpAfter }: ApprovalPanelProps) {
    const approval: Approval = step.approval || {};
    const p = `approval-${step.id}`;
    const write = (changes: Partial<Approval>) => {
        const next: Record<string, unknown> = { ...approval, ...changes };
        Object.keys(next).forEach((k) => next[k] === undefined && delete next[k]);
        dispatch({ type: 'updateStep', id: step.id, changes: { approval: next as Approval } });
    };
    const chosen = approval.approver_roles || [];
    const options = Array.from(new Set([...roles, ...chosen])).sort();
    const limit = giveUpAfter === undefined || giveUpAfter === null ? step.give_up_after : giveUpAfter;
    const tooLong = Boolean(approval.timeout && limit && approval.timeout > limit);

    return (
        <>
            <ControlGroup label="Message" labelFor={`${p}-message`} labelPosition="top" help="Shown to approvers on the run page and in the Asks for approval actions.">
                <TokenInput
                    inputId={`${p}-message`}
                    fieldLabel="Message"
                    multiline
                    pipeNewline={false}
                    rowsMin={3}
                    value={approval.message || ''}
                    groups={tokenGroups}
                    onValue={(message) => write({ message: message || undefined })}
                />
            </ControlGroup>
            <ControlGroup
                label="Who may approve"
                labelFor={`${p}-roles`}
                labelPosition="top"
                help={chosen.length ? `Members of these roles who also hold ${CAP_APPROVE} can decide. Admins always can.` : 'Anyone who may approve runs of this job'}
            >
                <Multiselect
                    inputId={`${p}-roles`}
                    values={chosen}
                    allowNewValues
                    onChange={(_e: unknown, { values }: { values: (string | number | boolean)[] }) => {
                        const next = values.map(String).filter((r) => r.trim() !== '');
                        write({ approver_roles: next.length ? next : undefined });
                    }}
                >
                    {options.map((r) => (
                        <Multiselect.Option key={r} label={r} value={r} />
                    ))}
                </Multiselect>
            </ControlGroup>
            <DurationField
                id={`${p}-timeout`}
                label="Wait at most"
                value={approval.timeout}
                inherited={0}
                inheritedFrom=""
                placeholder="Until the step gives up"
                help="Between 5 minutes and 7 days. Empty waits until the step gives up."
                onChange={(seconds) => write({ timeout: seconds === null ? undefined : seconds })}
            />
            {tooLong && (
                <Message type="warning" appearance="default">
                    {LONGER_THAN_GIVE_UP}
                </Message>
            )}
            <ControlGroup label="If nobody decides" labelFor={`${p}-on-timeout`} labelPosition="top" help="What happens when Wait at most runs out.">
                <Select
                    inputId={`${p}-on-timeout`}
                    value={approval.on_timeout || 'reject'}
                    onChange={(_e: unknown, { value }: { value: unknown }) => write({ on_timeout: value === 'approve' ? 'approve' : undefined })}
                >
                    <Select.Option label="Reject" value="reject" />
                    <Select.Option label="Approve" value="approve" />
                </Select>
            </ControlGroup>
        </>
    );
}
