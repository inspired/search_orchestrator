/* Who may run the job (run_roles). Runs always search with the owner's access, so the
 * tab says so plainly. Role names can be typed; the caller's own roles are offered. */
import React from 'react';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Multiselect from '@splunk/react-ui/Multiselect';

export interface AccessTabProps {
    runRoles: string[];
    owner: string;
    /** Roles to offer; others can be typed. */
    roles: string[];
    onChange: (roles: string[]) => void;
}

export default function AccessTab({ runRoles, owner, roles, onChange }: AccessTabProps) {
    const options = Array.from(new Set([...roles, ...runRoles])).sort();
    return (
        <div style={{ maxWidth: '640px' }}>
            <Message type="warning" appearance="default">
                {`Runs use the owner's access. Anyone who may run this job starts searches that run as ${owner}, with ${owner}'s permissions and data access.`}
            </Message>
            <ControlGroup
                label="Who may run"
                labelFor="access-run-roles"
                labelPosition="top"
                help="Members of these roles who also hold orchestrator_run can start runs. The owner and admins always can."
            >
                <Multiselect
                    inputId="access-run-roles"
                    values={runRoles}
                    allowNewValues
                    onChange={(_e: unknown, { values }: { values: (string | number | boolean)[] }) =>
                        onChange(values.map(String).filter((r) => r.trim() !== ''))
                    }
                >
                    {options.map((r) => (
                        <Multiselect.Option key={r} label={r} value={r} />
                    ))}
                </Multiselect>
            </ControlGroup>
        </div>
    );
}
