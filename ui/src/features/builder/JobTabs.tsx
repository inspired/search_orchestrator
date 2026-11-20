/* The builder's tabs: Flow (the node editor and its side panel), Parameters, Access (who may
 * run), Settings (description, tags, time zone, missed runs, step defaults, after give-up) Source
 * (the job as JSON text) and History (saved versions).
 * Triggers and actions are nodes in Flow. */
import React from 'react';
import ComboBox from '@splunk/react-ui/ComboBox';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Heading from '@splunk/react-ui/Heading';
import Message from '@splunk/react-ui/Message';
import Multiselect from '@splunk/react-ui/Multiselect';
import Select from '@splunk/react-ui/Select';
import Switch from '@splunk/react-ui/Switch';
import TabBar from '@splunk/react-ui/TabBar';
import Text from '@splunk/react-ui/Text';
import TextArea from '@splunk/react-ui/TextArea';
import type { AlertAction, Destination, Issue, Defaults, JobDefinition } from '../../api/types';
import JobActionsTab from './JobActionsTab';
import DeadlineFields from './DeadlineFields';
import AccessTab from './AccessTab';
import ParamsTab from './ParamsTab';
import HistoryTab from './HistoryTab';
import type { HistoryProps } from './HistoryTab';
import SourceTab from './SourceTab';
import type { BuilderAction } from './reducer';
import { BUILTIN_DEFAULTS } from './previewLogic';
import { DurationField } from './StepPanel';
import LearnMore from '../../components/LearnMore';
import { issueCounts } from './issueTabs';
import { timeZoneOptions } from './schedule';
import { cleanTags, tagsProblem } from '../jobs/tags';

export type TabId = 'steps' | 'actions' | 'params' | 'access' | 'settings' | 'source' | 'history';

export const TAB_LABELS: Record<TabId, string> = {
    steps: 'Flow',
    actions: 'Job actions',
    params: 'Parameters',
    access: 'Access',
    settings: 'Settings',
    source: 'Source',
    history: 'History',
};

export interface JobTabsProps {
    activeTab: TabId;
    onTabChange: (tab: TabId) => void;
    job: JobDefinition;
    dispatch: (action: BuilderAction) => void;
    owner: string;
    roles: string[];
    /** The Flow tab: canvas and side panel. */
    steps: React.ReactNode;
    /** Every current issue; each tab shows how many errors it holds. */
    issues?: Issue[];
    /** False for a viewer: the Source tab is read only. */
    canEdit?: boolean;
    /** The History tab; without it the tab shows the unsaved-job note. */
    history?: HistoryProps;
    /** Tags other jobs use, offered in the Tags field. */
    knownTags?: string[];
    /** For the Job actions tab. */
    destinations?: Destination[];
    alertActions?: AlertAction[] | null;
}

export function TagsField({ job, dispatch, knownTags = [] }: Pick<JobTabsProps, 'job' | 'dispatch' | 'knownTags'>) {
    const tags = job.tags || [];
    const problem = tagsProblem(tags);
    const options = cleanTags([...tags, ...knownTags]);
    return (
        <ControlGroup
            label="Tags"
            labelFor="job-tags"
            labelPosition="top"
            help={problem || 'Group jobs by team or system; the Jobs, Runs and Calendar pages filter by tag. Type a new tag and press Enter.'}
            error={Boolean(problem)}
        >
            <Multiselect
                inputId="job-tags"
                allowNewValues
                values={tags}
                placeholder="No tags"
                onChange={(_e: unknown, { values }: { values: unknown[] }) => {
                    const next = cleanTags(values.map(String));
                    dispatch({ type: 'setJobField', field: 'tags', value: next.length ? next : undefined });
                }}
            >
                {options.map((t) => (
                    <Multiselect.Option key={t} label={t} value={t} />
                ))}
            </Multiselect>
        </ControlGroup>
    );
}

function SettingsTab({ job, dispatch, knownTags }: Pick<JobTabsProps, 'job' | 'dispatch' | 'knownTags'>) {
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
            <TagsField job={job} dispatch={dispatch} knownTags={knownTags} />
            <Switch
                appearance="toggle"
                selected={job.enabled !== false}
                onClick={() => dispatch({ type: 'setJobField', field: 'enabled', value: job.enabled === false })}
            >
                Enabled (schedules and completion triggers start runs)
            </Switch>
            <ControlGroup label="Time zone" labelFor="job-timezone" labelPosition="top" help="Used by every schedule and Run when in this job.">
                <ComboBox
                    inputId="job-timezone"
                    value={job.timezone || ''}
                    placeholder="Server time zone"
                    onChange={(_e: unknown, { value }: { value: unknown }) => dispatch({ type: 'setJobField', field: 'timezone', value: String(value) || undefined })}
                >
                    {timeZoneOptions(job.timezone).map((z) => (
                        <ComboBox.Option key={z} value={z} />
                    ))}
                </ComboBox>
            </ControlGroup>
            <ControlGroup label="Missed runs" labelFor="job-catchup" labelPosition="top" help="What to do with scheduled times missed while Splunk or the engine was down.">
                <Select
                    inputId="job-catchup"
                    value={job.catchup || 'all'}
                    onChange={(_e: unknown, { value }: { value: unknown }) => dispatch({ type: 'setJobField', field: 'catchup', value })}
                >
                    <Select.Option label="Run each missed time (up to 7)" value="all" />
                    <Select.Option label="Run only the latest missed time" value="latest" />
                    <Select.Option label="Skip missed times" value="none" />
                </Select>
            </ControlGroup>
            <DeadlineFields job={job} dispatch={dispatch} />
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
                help="Waiting stops a rollup running over a missing day. Starting anyway keeps the schedule but can leave gaps."
            >
                <Select
                    inputId="job-after-give-up"
                    value={job.after_give_up || 'hold'}
                    onChange={(_e: unknown, { value }: { value: unknown }) => dispatch({ type: 'setJobField', field: 'after_give_up', value })}
                >
                    <Select.Option label="Wait for this run to be fixed" value="hold" />
                    <Select.Option label="Start later runs anyway" value="continue" />
                </Select>
            </ControlGroup>
            <LearnMore anchor="when-a-step-gives-up" topic="giving up" />
        </div>
    );
}

export default function JobTabs({ activeTab: tab, onTabChange, job, dispatch, owner, roles, steps, issues = [], canEdit = true, history, knownTags, destinations = [], alertActions = null }: JobTabsProps) {
    const counts = issueCounts(issues);
    return (
        <div>
            <TabBar activeTabId={tab} onChange={(_e: unknown, { selectedTabId }: { selectedTabId?: string }) => onTabChange((selectedTabId || 'steps') as TabId)}>
                {(Object.keys(TAB_LABELS) as TabId[]).map((id) => (
                    <TabBar.Tab key={id} label={TAB_LABELS[id]} tabId={id} count={counts[id] || undefined} />
                ))}
            </TabBar>
            <div style={{ paddingTop: '12px' }}>
                {tab === 'steps' && steps}
                {tab === 'params' && (
                    <ParamsTab params={job.params || []} onChange={(value) => dispatch({ type: 'setJobField', field: 'params', value })} />
                )}
                {tab === 'access' && (
                    <AccessTab
                        runRoles={job.run_roles || []}
                        owner={owner}
                        roles={roles}
                        onChange={(value) => dispatch({ type: 'setJobField', field: 'run_roles', value })}
                    />
                )}
                {tab === 'actions' && <JobActionsTab job={job} dispatch={dispatch} destinations={destinations} alertActions={alertActions} canEdit={canEdit} />}
                {tab === 'settings' && <SettingsTab job={job} dispatch={dispatch} knownTags={knownTags} />}
                {tab === 'source' && <SourceTab job={job} dispatch={dispatch} canEdit={canEdit} />}
                {tab === 'history' && <HistoryTab jobId={history ? history.jobId : null} dirty={!!history?.dirty} canEdit={history ? history.canEdit : false} onRestored={history ? history.onRestored : () => undefined} />}
            </div>
        </div>
    );
}
