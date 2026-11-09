/* The builder's tabs: Steps (the canvas and side panel), Triggers, Parameters, job-level
 * Actions, Access (who may run) and Settings (description, step defaults, after give-up). */
import React, { useState } from 'react';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Message from '@splunk/react-ui/Message';
import Select from '@splunk/react-ui/Select';
import Switch from '@splunk/react-ui/Switch';
import TabBar from '@splunk/react-ui/TabBar';
import Text from '@splunk/react-ui/Text';
import TextArea from '@splunk/react-ui/TextArea';
import type { AlertAction, Defaults, Destination, Job, JobDefinition } from '../../api/types';
import AccessTab from './AccessTab';
import ActionsEditor from './ActionsEditor';
import ParamsTab from './ParamsTab';
import type { BuilderAction } from './reducer';
import { BUILTIN_DEFAULTS } from './previewLogic';
import { DurationField } from './StepPanel';
import TriggersTab from './TriggersTab';

export interface JobTabsProps {
    job: JobDefinition;
    dispatch: (action: BuilderAction) => void;
    owner: string;
    roles: string[];
    jobs: Pick<Job, 'id' | 'name'>[];
    destinations: Destination[];
    alertActions?: AlertAction[] | null;
    /** The Steps tab: canvas and side panel. */
    steps: React.ReactNode;
}

function SettingsTab({ job, dispatch }: Pick<JobTabsProps, 'job' | 'dispatch'>) {
    const defaults = job.defaults || {};
    const setDefault = (key: keyof Defaults, value: number | null) => {
        const next = { ...defaults };
        if (value === null) {
            delete next[key];
        } else {
            next[key] = value;
        }
        dispatch({ type: 'setJobField', field: 'defaults', value: next });
    };
    return (
        <div style={{ maxWidth: '640px' }}>
            <ControlGroup label="Description" labelFor="job-description" labelPosition="top">
                <TextArea
                    inputId="job-description"
                    value={job.description || ''}
                    onChange={(_e: unknown, { value }: { value: string }) => dispatch({ type: 'setJobField', field: 'description', value })}
                />
            </ControlGroup>
            <Switch
                appearance="toggle"
                selected={job.enabled !== false}
                onClick={() => dispatch({ type: 'setJobField', field: 'enabled', value: job.enabled === false })}
            >
                Enabled (schedules and completion triggers start runs)
            </Switch>
            <Heading level={3}>Step defaults</Heading>
            <p>Steps that leave these empty use them.</p>
            <DurationField
                id="job-default-delayed"
                label="Delayed after"
                value={defaults.delayed_after}
                inherited={BUILTIN_DEFAULTS.delayed_after}
                inheritedFrom="Default"
                onChange={(v) => setDefault('delayed_after', v)}
            />
            <DurationField
                id="job-default-giveup"
                label="Give up after"
                value={defaults.give_up_after}
                inherited={BUILTIN_DEFAULTS.give_up_after}
                inheritedFrom="Default"
                onChange={(v) => setDefault('give_up_after', v)}
            />
            <DurationField
                id="job-default-maxrt"
                label="Max runtime"
                value={defaults.max_runtime}
                inherited={BUILTIN_DEFAULTS.max_runtime}
                inheritedFrom="Default"
                onChange={(v) => setDefault('max_runtime', v)}
            />
            <ControlGroup label="Retries" labelFor="job-default-retries" labelPosition="top">
                <Text
                    inputId="job-default-retries"
                    value={defaults.retries === undefined ? '' : String(defaults.retries)}
                    placeholder="Default (0)"
                    onChange={(_e: unknown, { value }: { value: string }) => {
                        const digits = value.replace(/[^0-9]/g, '');
                        setDefault('retries', digits === '' ? null : parseInt(digits, 10));
                    }}
                />
            </ControlGroup>
            {(defaults.retries || 0) > 0 && (
                <Message type="warning" appearance="default">
                    A retry runs the search again, which can write duplicates to a summary index.
                </Message>
            )}
            <ControlGroup
                label="When a step gives up"
                labelFor="job-after-give-up"
                labelPosition="top"
                help="Hold keeps later runs of this job waiting until the run is re-run or dismissed."
            >
                <Select
                    inputId="job-after-give-up"
                    value={job.after_give_up || 'hold'}
                    onChange={(_e: unknown, { value }: { value: unknown }) => dispatch({ type: 'setJobField', field: 'after_give_up', value })}
                >
                    <Select.Option label="Hold later runs" value="hold" />
                    <Select.Option label="Continue with later runs" value="continue" />
                </Select>
            </ControlGroup>
        </div>
    );
}

export default function JobTabs({ job, dispatch, owner, roles, jobs, destinations, alertActions, steps }: JobTabsProps) {
    const [tab, setTab] = useState('steps');
    return (
        <div>
            <TabBar activeTabId={tab} onChange={(_e: unknown, { selectedTabId }: { selectedTabId?: string }) => setTab(selectedTabId || 'steps')}>
                <TabBar.Tab label="Steps" tabId="steps" />
                <TabBar.Tab label="Triggers" tabId="triggers" />
                <TabBar.Tab label="Parameters" tabId="params" />
                <TabBar.Tab label="Actions" tabId="actions" />
                <TabBar.Tab label="Access" tabId="access" />
                <TabBar.Tab label="Settings" tabId="settings" />
            </TabBar>
            <div style={{ paddingTop: '12px' }}>
                {tab === 'steps' && steps}
                {tab === 'triggers' && <TriggersTab job={job} jobs={jobs} dispatch={dispatch} />}
                {tab === 'params' && (
                    <ParamsTab params={job.params || []} onChange={(value) => dispatch({ type: 'setJobField', field: 'params', value })} />
                )}
                {tab === 'actions' && (
                    <div style={{ maxWidth: '640px' }}>
                        <p>Job actions fire for the whole run. Without an on-failure action, the fallback notification in Settings is used.</p>
                        <ActionsEditor
                            idPrefix="job-action"
                            actions={job.actions || []}
                            destinations={destinations}
                            alertActions={alertActions}
                            onChange={(value) => dispatch({ type: 'setJobField', field: 'actions', value })}
                        />
                    </div>
                )}
                {tab === 'access' && (
                    <AccessTab
                        runRoles={job.run_roles || []}
                        owner={owner}
                        roles={roles}
                        onChange={(value) => dispatch({ type: 'setJobField', field: 'run_roles', value })}
                    />
                )}
                {tab === 'settings' && <SettingsTab job={job} dispatch={dispatch} />}
            </div>
        </div>
    );
}
