/* One illustration for each ## and ### heading of the user guide, by the heading's anchor
 * (HelpPage's slugify). The help page draws it right under its heading. */
import React from 'react';
import { Bars, Chips, Code, Figure, Flow, MiniCalendar, MiniTable, Notes, Panel } from './illustrationKit';

const n = (id: string, f: Parameters<typeof Flow>[0]['nodes'][number]['f'], label: string, x: number, y: number, extra: Partial<Parameters<typeof Flow>[0]['nodes'][number]> = {}) => ({
    id,
    f,
    label,
    x,
    y,
    ...extra,
});

export const ILLUSTRATIONS: Record<string, () => React.ReactElement> = {
    'words-used': () => (
        <Figure caption="A job is a flow of steps; a run is one time it ran; each step runs one search.">
            <Flow
                label="A job with a trigger and two steps, and a run of it"
                width={560}
                height={110}
                nodes={[n('t', 'trigger', 'Trigger', 0, 50, { w: 100 }), n('a', 'search', 'Step 1', 150, 50), n('b', 'transform', 'Step 2', 320, 50)]}
                lines={[
                    { from: 't', to: 'a' },
                    { from: 'a', to: 'b' },
                ]}
            />
            <Notes items={['Job: the whole flow, saved', 'Step: one search (a node)', 'Run: one time the job ran', 'Trigger: what starts a run']} />
        </Figure>
    ),
    'example-jobs': () => (
        <Figure caption="Browse examples on the Jobs page: eleven jobs from simple to advanced, all turned off.">
            <Chips
                items={[
                    { text: 'Hourly splunkd errors · Simple', tone: 'ok' },
                    { text: 'Top sourcetypes to a lookup · Simple', tone: 'ok' },
                    { text: 'Daily, weekly and monthly rollup · Intermediate', tone: 'info' },
                    { text: 'Two branches, one report · Intermediate', tone: 'info' },
                    { text: 'Retries, recovery and clean-up · Advanced', tone: 'warn' },
                    { text: 'Platform health pipeline · Advanced', tone: 'warn' },
                ]}
            />
        </Figure>
    ),
    'build-a-job': () => (
        <Figure caption="Create job opens the builder: the canvas on the left, the selected node's settings on the right.">
            <Flow
                label="The builder canvas with a trigger, a search and a lookup"
                width={460}
                height={110}
                nodes={[n('t', 'trigger', 'Every day 06:00', 0, 40, { w: 120 }), n('a', 'search', 'Count errors', 160, 40), n('w', 'write', 'Save to lookup', 320, 40)]}
                lines={[
                    { from: 't', to: 'a' },
                    { from: 'a', to: 'w' },
                ]}
            />
            <Panel title="Count errors" rows={[['Name', 'Count errors'], ['Search', 'index=_internal log_level=ERROR'], ['Time range', 'Last 24 hours'], ['', '[Preview step]']]} />
        </Figure>
    ),
    'simple-and-flow': () => (
        <Figure caption="Simple: searches top to bottom, each with what happens to its results. Flow: the same job as nodes.">
            <Panel title="1  Count errors" rows={[['', '→ Save to summary index · summary'], ['', '→ Email · ops@example.com · only if it found results']]} width={300} />
            <Panel title="2  Top components" rows={[['', '→ Save to lookup · top_components.csv'], ['', '[+ Then…]']]} width={260} />
        </Figure>
    ),
    'the-flow-editor': () => (
        <Figure caption="Point at a node to show +; click it and pick what happens next, or drag it onto another node.">
            <Flow
                label="A node with its plus handle and the When choices"
                width={460}
                height={130}
                nodes={[n('a', 'search', 'Count errors', 0, 45), n('b', 'notify', 'Email ops', 300, 0), n('c', 'transform', 'Report', 300, 90)]}
                lines={[
                    { from: 'a', to: 'b', port: 'failure', label: '✗ Fails' },
                    { from: 'a', to: 'c', port: 'success', label: '✓ Succeeds' },
                ]}
            />
            <Panel title="When this node…" rows={[['', '✓ Succeeds'], ['', '✗ Fails'], ['', '∞ Finishes either way'], ['', '◇ If…']]} width={180} />
        </Figure>
    ),
    'write-results-to-an-index-or-a-lookup': () => (
        <Figure caption="Summary index and Lookup nodes write what the steps before them found; View output shows what they wrote.">
            <Flow
                label="A search feeding a summary index and a lookup"
                width={460}
                height={120}
                nodes={[n('a', 'search', 'Errors by host', 0, 40), n('s', 'write', 'Summary index', 300, 0), n('l', 'write', 'Lookup', 300, 80)]}
                lines={[
                    { from: 'a', to: 's' },
                    { from: 'a', to: 'l' },
                ]}
            />
            <Code spl={'| collect index=summary source="daily" marker="so_run=$run.id$"\n| outputlookup append=true hosts.csv'} />
        </Figure>
    ),
    slack: () => (
        <Figure caption="A Webhook node with the Slack preset posts a message when its hook fires.">
            <Panel title="Webhook" rows={[['Destination', 'slack-ops'], ['Preset', 'Slack'], ['When', '✗ Job fails']]} />
            <Panel title="#ops" rows={[['Search Orchestrator', 'Daily summary failed: step export_stats'], ['', '[Open run]']]} />
        </Figure>
    ),
    'microsoft-teams-pagerduty-and-servicenow': () => (
        <Figure caption="Presets fill the right body for each service; PagerDuty takes a severity, ServiceNow an urgency and impact.">
            <Chips
                items={[
                    { text: 'Microsoft Teams · its own message format', tone: 'info' },
                    { text: 'PagerDuty · severity critical/error/warning/info', tone: 'bad' },
                    { text: 'ServiceNow · urgency 1–3, impact 1–3', tone: 'warn' },
                ]}
            />
        </Figure>
    ),
    'approval-steps': () => (
        <Figure caption="The run waits at an Approval step until someone with the right role approves or rejects, or the timeout decides.">
            <Flow
                label="Score, an approval step, then escalate when approved or note the rejection"
                width={560}
                height={120}
                nodes={[n('s', 'transform', 'Score', 0, 40), n('a', 'approval', 'Approve?', 170, 40, { state: 'waiting' }), n('e', 'notify', 'Escalate', 360, 0), n('r', 'transform', 'Note rejection', 360, 80)]}
                lines={[
                    { from: 's', to: 'a' },
                    { from: 'a', to: 'e', port: 'success', label: 'Approve' },
                    { from: 'a', to: 'r', port: 'failure', label: 'Reject' },
                ]}
            />
            <Panel title="Waiting for approval" rows={[['Message', 'Score is 62 in production. Open an incident?'], ['Comment', 'Checked with on-call'], ['', '[Approve]'], ['', '[Reject]']]} width={220} />
        </Figure>
    ),
    steps: () => (
        <Figure caption="Three kinds of step: a search you write, a saved search, or a search over the results of earlier steps.">
            <Flow
                label="A search step and a saved search step feeding a results-of-earlier-steps step"
                width={460}
                height={120}
                nodes={[n('a', 'search', 'Search', 0, 0), n('b', 'search', 'Saved search', 0, 80), n('c', 'transform', 'Earlier results', 300, 40)]}
                lines={[
                    { from: 'a', to: 'c' },
                    { from: 'b', to: 'c' },
                ]}
            />
        </Figure>
    ),
    conditions: () => (
        <Figure caption="An If… line runs the next step only when its condition holds: a simple comparison, an SPL expression or a search that returns rows.">
            <Flow
                label="A count step, a condition diamond, and an investigate step"
                width={460}
                height={90}
                nodes={[n('a', 'search', 'Count errors', 0, 25), n('c', 'condition', 'errors > 50', 170, 25, { w: 110 }), n('b', 'search', 'Investigate', 330, 25)]}
                lines={[
                    { from: 'a', to: 'c', port: 'if' },
                    { from: 'c', to: 'b', port: 'success' },
                ]}
            />
            <Code spl={'$count.resultCount$ > 50\ntonumber($count.first.errors$) > 50 AND now() > relative_time(now(), "@d+6h")\nindex=_internal log_level=ERROR | where count > 5'} />
        </Figure>
    ),
    'results-of-earlier-steps': () => (
        <Figure caption="A Results of earlier steps step starts with | and works on the rows of the steps it depends on, appended in order.">
            <Flow
                label="Two steps feeding one merge step"
                width={460}
                height={120}
                nodes={[n('a', 'search', 'Errors', 0, 0), n('b', 'search', 'Warnings', 0, 80), n('c', 'transform', '| stats sum(count)', 300, 40, { w: 140 })]}
                lines={[
                    { from: 'a', to: 'c' },
                    { from: 'b', to: 'c' },
                ]}
            />
        </Figure>
    ),
    'writing-the-search': () => (
        <Figure caption="The search editor colours commands, functions, strings and tokens, and puts each | on a new line as you type it.">
            <Code spl={'index=_internal sourcetype=splunkd log_level=ERROR\n| stats count AS errors BY component\n| where errors > $run.param.threshold$\n| sort - errors'} />
        </Figure>
    ),
    tokens: () => (
        <Figure caption="Tokens put values from the run and from earlier steps into a search, filled in when the step starts.">
            <MiniTable
                head={['Token', 'Becomes']}
                rows={[
                    ['$run.scheduled_time$', '1795161600'],
                    ['$run.param.env$', '"production"'],
                    ['$count.resultCount$', '1204'],
                    ['$count.first.host$', '"idx01"'],
                    ['$count.first.host|none$', 'none, when count was skipped'],
                ]}
            />
        </Figure>
    ),
    parameters: () => (
        <Figure caption="Parameters are asked for on Run now; scheduled runs use their defaults.">
            <Panel title="Run now" rows={[['Environment', 'production ▾'], ['Error threshold', '50'], ['Host filter', 'idx*'], ['', '[Run]']]} />
            <Code spl={'index=_internal host=$run.param.host_filter$\n| where errors >= tonumber($run.param.error_threshold$)'} />
        </Figure>
    ),
    triggers: () => (
        <Figure caption="A job starts on a schedule, after another job finishes, or by hand, from an alert or from | orchestrate.">
            <Flow
                label="Two triggers starting the same job"
                width={460}
                height={120}
                nodes={[n('c', 'trigger', 'Cron 0 6 * * 1-5', 0, 0, { w: 140 }), n('d', 'trigger', 'After rollup succeeds', 0, 80, { w: 140 }), n('j', 'search', 'First step', 300, 40)]}
                lines={[
                    { from: 'c', to: 'j' },
                    { from: 'd', to: 'j' },
                ]}
            />
        </Figure>
    ),
    actions: () => (
        <Figure caption="Actions fire on a hook (start, success, failure, delayed, late, approval requested) for a step or the whole job.">
            <Flow
                label="A step with an email on failure and a webhook when delayed"
                width={460}
                height={120}
                nodes={[n('a', 'search', 'Export', 0, 40), n('e', 'notify', 'Email ops', 300, 0), n('w', 'notify', 'Webhook', 300, 80)]}
                lines={[
                    { from: 'a', to: 'e', port: 'failure', label: '✗ Fails' },
                    { from: 'a', to: 'w', port: 'delayed', label: '⏱ Delayed' },
                ]}
            />
        </Figure>
    ),
    deadline: () => (
        <Figure caption="A run not finished by its deadline is late: the on_late actions fire once and the run says Late.">
            <Bars
                label="Two runs: one ends before the 07:30 deadline, one ends after it"
                rows={[
                    { name: 'Monday', start: 0, end: 50, tone: 'ok', note: 'on time' },
                    { name: 'Tuesday', start: 0, end: 95, tone: 'warn', note: 'late' },
                    { name: 'Deadline 07:30', start: 74, end: 76, tone: 'bad' },
                ]}
            />
        </Figure>
    ),
    'who-may-run': () => (
        <Figure caption="On the Access tab, roles you list may start the job too; their runs search as the owner, with only the saved SPL.">
            <Chips
                items={[
                    { text: 'Owner · edit and run', tone: 'ok' },
                    { text: 'Admin · edit and run', tone: 'ok' },
                    { text: 'Listed roles (ops) · start', tone: 'info' },
                    { text: 'Others · view only', tone: 'muted', hollow: true },
                ]}
            />
        </Figure>
    ),
    'when-a-step-gives-up': () => (
        <Figure caption="A step retries up to its Retries; after the last attempt fails, its Fails lines and failure actions take over.">
            <Bars
                label="Three attempts of a step: two fail, then a Fails line runs recovery"
                rows={[
                    { name: 'Attempt 1', start: 0, end: 20, tone: 'bad' },
                    { name: 'Attempt 2', start: 30, end: 50, tone: 'bad' },
                    { name: 'Attempt 3', start: 60, end: 80, tone: 'bad', note: 'gives up' },
                    { name: 'Recovery', start: 82, end: 100, tone: 'ok' },
                ]}
            />
        </Figure>
    ),
    'job-source': () => (
        <Figure caption="The Source tab shows the whole job as JSON, coloured; copy it, edit it or paste a job in.">
            <Code spl={'{\n  "id": "daily",\n  "steps": [{ "id": "count", "type": "inline", "spl": "index=_internal | stats count" }],\n  "edges": []\n}'} />
        </Figure>
    ),
    history: () => (
        <Figure caption="Every save is a version: compare any two and restore an older one.">
            <MiniTable
                head={['Version', 'When', 'Who', 'What changed']}
                rows={[
                    ['12', 'Today 09:14', 'alice', 'Changed the search of Count errors'],
                    ['11', 'Yesterday', 'bob', 'Added step Report'],
                    ['10', 'Mon', 'alice', 'Moved 3 nodes'],
                ]}
            />
        </Figure>
    ),
    'previewing-steps': () => (
        <Figure caption="Preview step runs the search now, as you, and shows the first rows; nothing is written.">
            <Panel title="Preview" rows={[['', '1 204 rows · 3.2 s'], ['', '[Preview step]']]} width={200} />
            <MiniTable
                head={['component', 'errors']}
                rows={[
                    ['TailReader', '412'],
                    ['ExecProcessor', '96'],
                ]}
            />
        </Figure>
    ),
    'follow-runs': () => (
        <Figure caption="The run page shows each step's state, live; click a step for its details, output and search.">
            <Flow
                label="A run in progress: one step done, one running, one waiting"
                width={460}
                height={80}
                nodes={[n('a', 'search', 'Count', 0, 25, { state: 'succeeded' }), n('b', 'transform', 'Score', 160, 25, { state: 'running' }), n('c', 'write', 'Save', 320, 25)]}
                lines={[
                    { from: 'a', to: 'b' },
                    { from: 'b', to: 'c' },
                ]}
            />
        </Figure>
    ),
    performance: () => (
        <Figure caption="The Performance tab: runtime, events scanned and results per step.">
            <Bars
                label="Runtime of four steps"
                rows={[
                    { name: 'splunkd errors', start: 0, end: 42, tone: 'info', note: '42 s' },
                    { name: 'license usage', start: 0, end: 18, tone: 'info', note: '18 s' },
                    { name: 'merge', start: 42, end: 45, tone: 'info', note: '3 s' },
                    { name: 'score', start: 45, end: 47, tone: 'info', note: '2 s' },
                ]}
            />
        </Figure>
    ),
    'run-health-dashboard': () => (
        <Figure caption="Run health: runs, failures and late runs over time, from the audit index and _internal.">
            <Chips
                items={[
                    { text: '1 204 runs', tone: 'info' },
                    { text: '12 failed', tone: 'bad' },
                    { text: '3 late', tone: 'warn' },
                    { text: '98.9 % succeeded', tone: 'ok' },
                ]}
            />
        </Figure>
    ),
    'the-run-graph': () => (
        <Figure caption="The run graph: running steps pulse and data lines flow; skipped branches fade.">
            <Flow
                label="A run graph with a succeeded step, a failed step, a skipped branch and a running step"
                width={560}
                height={120}
                nodes={[
                    n('a', 'search', 'Count', 0, 40, { state: 'succeeded' }),
                    n('b', 'condition', 'errors > 50', 160, 40, { state: 'succeeded', w: 110 }),
                    n('c', 'approval', 'Approve', 320, 0, { state: 'skipped' }),
                    n('d', 'write', 'Save', 320, 80, { state: 'running' }),
                ]}
                lines={[
                    { from: 'a', to: 'b', port: 'if' },
                    { from: 'b', to: 'c' },
                    { from: 'a', to: 'd', port: 'always' },
                ]}
            />
        </Figure>
    ),
    dependencies: () => (
        <Figure caption="Dependencies: which jobs start which, through completion triggers and start-job actions.">
            <Flow
                label="Three jobs chained: rollup starts health check, which starts hourly errors"
                width={560}
                height={70}
                nodes={[n('a', 'job', 'Rollup', 0, 15), n('b', 'job', 'Health check', 200, 15), n('c', 'job', 'Hourly errors', 400, 15)]}
                lines={[
                    { from: 'a', to: 'b', label: 'after success' },
                    { from: 'b', to: 'c', label: 'start job' },
                ]}
            />
        </Figure>
    ),
    calendar: () => (
        <Figure caption="Calendar by day, week or month: hollow dots are scheduled, filled dots are runs in their state.">
            <MiniCalendar
                label="A week with scheduled times and runs"
                days={[
                    { day: 'Mon', items: [{ tone: 'ok' }, { tone: 'ok' }, { tone: 'bad' }] },
                    { day: 'Tue', items: [{ tone: 'ok' }, { tone: 'warn' }] },
                    { day: 'Wed', items: [{ tone: 'info' }, { tone: 'muted', hollow: true }] },
                    { day: 'Thu', items: [{ tone: 'muted', hollow: true }, { tone: 'muted', hollow: true }] },
                    { day: 'Fri', items: [{ tone: 'muted', hollow: true }] },
                ]}
            />
        </Figure>
    ),
    backfill: () => (
        <Figure caption="Backfill runs a job once for each schedule slot in a past range, oldest first.">
            <Bars
                label="Five backfill runs, one per day, one after another"
                rows={[
                    { name: '1 Nov', start: 0, end: 18, tone: 'ok' },
                    { name: '2 Nov', start: 20, end: 38, tone: 'ok' },
                    { name: '3 Nov', start: 40, end: 58, tone: 'ok' },
                    { name: '4 Nov', start: 60, end: 78, tone: 'info', note: 'running' },
                    { name: '5 Nov', start: 80, end: 98, tone: 'muted', note: 'queued' },
                ]}
            />
        </Figure>
    ),
    're-run-from-a-step': () => (
        <Figure caption="Re-run from a step keeps what succeeded before it and runs that step and everything after it again.">
            <Flow
                label="A re-run that keeps the first step and runs the failed step and the one after again"
                width={460}
                height={80}
                nodes={[n('a', 'search', 'Count · kept', 0, 25, { state: 'succeeded' }), n('b', 'transform', 'Score · again', 160, 25, { state: 'running' }), n('c', 'write', 'Save · again', 320, 25)]}
                lines={[
                    { from: 'a', to: 'b' },
                    { from: 'b', to: 'c' },
                ]}
            />
        </Figure>
    ),
    'make-steps-safe-to-re-run': () => (
        <Figure caption="A step that writes should write the same thing twice without harm: replace instead of append, or mark rows with the run id.">
            <Code spl={'| outputlookup daily_counts.csv          ← replace: safe\n| collect index=summary marker="so_run=$run.id$"   ← marked: removable'} />
        </Figure>
    ),
    'the--orchestrate-command': () => (
        <Figure caption="| orchestrate starts, checks and tests jobs from a search.">
            <Code spl={'| orchestrate start job=daily param.env=staging\n| orchestrate status run=daily:42\n| orchestrate backfill job=daily from=-7d@d to=@d\n| orchestrate jobs'} />
        </Figure>
    ),
    'audit-events': () => (
        <Figure caption="Everything is written to index=orchestrator, one event per change.">
            <MiniTable
                head={['_time', 'type', 'job_id', 'user']}
                rows={[
                    ['09:14:02', 'job_saved', 'daily', 'alice'],
                    ['09:15:30', 'run_started', 'daily', 'alice'],
                    ['09:16:11', 'approval_decided', 'daily', 'bob'],
                ]}
            />
        </Figure>
    ),
    'help-in-the-app': () => (
        <Figure caption="Learn more links beside fields open the matching section of this page.">
            <Panel title="Conditions" rows={[['Check', 'SPL expression ▾'], ['', '[Learn more about conditions]']]} />
        </Figure>
    ),
};
