/* The errors that stopped a save, each with a button to the step, node or tab that fixes it. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import List from '@splunk/react-ui/List';
import Message from '@splunk/react-ui/Message';
import type { Issue } from '../../api/types';
import { tabLabel } from './JobTabs';
import type { BuilderView } from '../simple/useBuilderView';
import { tabForIssue } from './issueTabs';

export interface IssueSummaryProps {
    issues: Issue[];
    /** Display names of steps by id; an id is shown when a name is missing. */
    stepNames?: Record<string, string>;
    onGo: (issue: Issue) => void;
}

export default function IssueSummary({ issues, stepNames = {}, onGo, view = 'advanced' }: IssueSummaryProps & { view?: BuilderView }) {
    const title = issues.length === 1 ? 'Fix 1 problem before saving' : `Fix ${issues.length} problems before saving`;
    return (
        <Message type="error" appearance="default">
            <Message.Title>{title}</Message.Title>
            <List>
                {issues.map((issue, n) => {
                    const target = issue.step ? stepNames[issue.step] || issue.step : tabLabel(tabForIssue(issue, view));
                    return (
                        <List.Item key={`${issue.code}-${issue.step || ''}-${n}`}>
                            <span>{issue.message} </span>
                            <Button appearance="subtle" label={`Go to ${target}`} aria-label={`Go to ${target}: ${issue.message}`} onClick={() => onGo(issue)} />
                        </List.Item>
                    );
                })}
            </List>
        </Message>
    );
}
