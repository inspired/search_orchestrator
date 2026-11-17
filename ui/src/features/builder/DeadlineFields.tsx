/* Settings tab: when a scheduled or chained run must be finished. Both fields empty means no
 * deadline, and then the `deadline` key is removed from the job, never written as {} or null. */
import React, { useState } from 'react';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Text from '@splunk/react-ui/Text';
import type { JobDefinition } from '../../api/types';
import type { BuilderAction } from './reducer';
import { DurationField } from './StepPanel';

const FINISH_BY = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface DeadlineFieldsProps {
    job: JobDefinition;
    dispatch: (action: BuilderAction) => void;
}

export default function DeadlineFields({ job, dispatch }: DeadlineFieldsProps) {
    const deadline = job.deadline || {};
    const [text, setText] = useState(deadline.finish_by || '');
    const invalid = text !== '' && !FINISH_BY.test(text);

    const write = (next: { finish_by?: string; within?: number }) => {
        const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
        dispatch({ type: 'setJobField', field: 'deadline', value: Object.keys(clean).length ? clean : undefined });
    };

    return (
        <>
            <ControlGroup
                label="Finish by"
                labelFor="job-finish-by"
                labelPosition="top"
                help={invalid ? 'Use HH:MM, for example 06:00' : "In the job's time zone"}
                error={invalid}
            >
                <Text
                    inputId="job-finish-by"
                    value={text}
                    placeholder="06:00"
                    error={invalid}
                    onChange={(_e: unknown, { value }: { value: string }) => {
                        setText(value);
                        if (value === '') {
                            write({ within: deadline.within });
                        } else if (FINISH_BY.test(value)) {
                            write({ finish_by: value, within: deadline.within });
                        }
                    }}
                />
            </ControlGroup>
            <DurationField
                id="job-finish-within"
                label="Finish within"
                value={deadline.within}
                inherited={0}
                inheritedFrom="No limit"
                placeholder="No limit"
                help="Only scheduled runs and runs started by another job have a deadline."
                onChange={(seconds) => write({ finish_by: deadline.finish_by, within: seconds === null ? undefined : seconds })}
            />
        </>
    );
}
