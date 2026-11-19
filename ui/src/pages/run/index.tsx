/* Run detail: header with controls, why-it-needs-attention banner, and tabs for the
 * timeline, graph (live while the run is active, under a progress strip), logs, actions and parameters. */
import React, { useEffect, useState } from 'react';
import Message from '@splunk/react-ui/Message';
import TabBar from '@splunk/react-ui/TabBar';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import {
    ApiError,
    cancelRun,
    dismissRun,
    getRun,
    me as getMe,
    pauseRun,
    resumeRun,
} from '../../api/client';
import type { Me } from '../../api/types';
import PageShell, { queryParam, renderPage } from '../../components/PageShell';
import RunBanner from '../../components/RunBanner';
import useNow from '../../hooks/useNow';
import usePoll from '../../hooks/usePoll';
import ActionsTab from '../../features/run/ActionsTab';
import DeadlineMessage from '../../features/run/DeadlineMessage';
import ErrorMessage from '../../features/run/ErrorMessage';
import LogsTab from '../../features/run/LogsTab';
import PerformanceTab from '../../features/run/PerformanceTab';
import ParamsTab from '../../features/run/ParamsTab';
import RerunDialog from '../../features/run/RerunDialog';
import RunGraph from '../../features/run/RunGraph';
import RunHeader from '../../features/run/RunHeader';
import { EngineBanner } from '../../components/WaitReason';
import RunProgress from '../../features/run/RunProgress';
import StepDrawer from '../../features/run/StepDrawer';
import Timeline from '../../features/run/Timeline';
import { formatDuration, formatTime } from '../../format';

const ACTIVE = ['queued', 'running', 'paused', 'blocked'];

function RunPage() {
    const runId = queryParam('run_id') || '';
    const [fast, setFast] = useState(true);
    const poll = usePoll(() => getRun(runId), fast ? 5000 : 30000, Boolean(runId));
    const [who, setWho] = useState<Me | null>(null);
    const canRun = Boolean(who && who.can_run);
    const [tab, setTab] = useState('timeline');
    // ?step= (from Review on the approval banner) opens that step's drawer.
    const [selected, setSelected] = useState<string | null>(() => queryParam('step'));
    const [rerunOpen, setRerunOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<Error | null>(null);

    useEffect(() => {
        getMe()
            .then(setWho)
            .catch(() => setWho(null));
    }, []);

    const detail = poll.data;
    const run = detail && detail.run;
    const active = Boolean(run && ACTIVE.includes(run.state));
    useEffect(() => setFast(active), [active]);
    // One client clock for every timer and countdown: ticks each second while the run is active.
    const now = useNow(active, detail);

    const control = async (fn: (id: string) => Promise<unknown>) => {
        setBusy(true);
        setActionError(null);
        try {
            await fn(runId);
            poll.refresh();
        } catch (err) {
            setActionError(err as ApiError);
        } finally {
            setBusy(false);
        }
    };

    if (!runId) {
        return (
            <PageShell title="Run">
                <Message type="error" appearance="default">
                    No run was chosen. Open a run from the Runs page.
                </Message>
            </PageShell>
        );
    }

    return (
        <PageShell title="Run">
            {poll.error && !run && <ErrorMessage error={poll.error} />}
            {!run && !poll.error && <WaitSpinner size="medium" />}
            {run && detail && (
                <>
                    {['queued', 'running', 'blocked', 'paused'].includes(run.state) && <EngineBanner engine={detail.engine} />}
                    <RunHeader
                        run={run}
                        canRun={canRun}
                        busy={busy}
                        onPause={() => control(pauseRun)}
                        onResume={() => control(resumeRun)}
                        onCancel={() => control(cancelRun)}
                        onDismiss={() => control(dismissRun)}
                        onRerun={() => setRerunOpen(true)}
                    />
                    {actionError && <ErrorMessage error={actionError} />}
                    {poll.error && <ErrorMessage error={poll.error} />}
                    <RunBanner run={run} now={now} />
                    <DeadlineMessage run={run} now={now} timezone={run.definition.timezone} />
                    <TabBar activeTabId={tab} onChange={(_e: unknown, { selectedTabId }: { selectedTabId?: string }) => setTab(selectedTabId || 'timeline')}>
                        <TabBar.Tab label="Timeline" tabId="timeline" />
                        <TabBar.Tab label="Graph" tabId="graph" />
                        <TabBar.Tab label="Logs" tabId="logs" />
                        <TabBar.Tab label="Actions" tabId="actions" />
                        <TabBar.Tab label="Performance" tabId="performance" />
                        <TabBar.Tab label="Parameters" tabId="params" />
                    </TabBar>
                    <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', padding: '10px 14px' }}>
                        <span>{`Trigger: ${run.trigger}`}</span>
                        <span>{`Owner: ${run.owner}`}</span>
                        {run.started_at && (
                            <span>{`Elapsed: ${formatDuration((run.ended_at ?? now) - run.started_at)}`}</span>
                        )}
                        <span>{`Scheduled: ${formatTime(run.scheduled_time)}`}</span>
                        {run.rerun_count > 0 && <span>{`Re-runs: ${run.rerun_count}`}</span>}
                    </div>
                    {tab === 'timeline' && (
                        <Timeline run={run} now={now} selected={selected} onSelect={setSelected} />
                    )}
                    {tab === 'graph' && (
                        <RunProgress run={run} definition={run.definition} steps={run.steps} now={now} active={active} />
                    )}
                    {tab === 'graph' && (
                        <RunGraph
                            definition={run.definition}
                            states={run.steps}
                            actions={detail.actions || []}
                            onSelect={setSelected}
                            selected={selected}
                            active={active}
                            now={now}
                            conditions={run.conditions}
                        />
                    )}
                    {tab === 'logs' && <LogsTab attempts={detail.attempts || []} />}
                    {tab === 'actions' && <ActionsTab actions={detail.actions || []} />}
                    {tab === 'performance' && <PerformanceTab run={run} now={now} />}
                    {tab === 'params' && <ParamsTab run={run} />}
                    {selected && (tab === 'timeline' || tab === 'graph') && (
                        <StepDrawer run={run} stepId={selected} now={now} onClose={() => setSelected(null)} me={who} onDecided={poll.refresh} />
                    )}
                    <RerunDialog
                        run={run}
                        open={rerunOpen}
                        onClose={() => setRerunOpen(false)}
                        onStarted={() => {
                            setRerunOpen(false);
                            poll.refresh();
                        }}
                    />
                </>
            )}
        </PageShell>
    );
}

renderPage(<RunPage />, 'Run');
