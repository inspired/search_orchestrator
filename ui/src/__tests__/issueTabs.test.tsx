import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { issueCounts, issuesForAction, nodeForIssue, tabForIssue } from '../features/builder/issueTabs';
import IssueSummary from '../features/builder/IssueSummary';
import BuilderPage from '../features/builder/BuilderPage';
import { fakeApi, rollupJob } from './builderFixtures';
import { renderThemed } from './fixtures';
import type { Issue, JobDefinition } from '../api/types';

const mk = (code: string, step: string | null = null, level: 'error' | 'warning' = 'error'): Issue => ({ level, code, message: `m-${code}`, step });

describe('tabForIssue', () => {
    it.each([
        ['bad_cron', null, 'triggers'],
        ['bad_trigger', null, 'triggers'],
        ['job_chain_cycle', null, 'triggers'],
        ['bad_timezone', null, 'settings'],
        ['bad_deadline', null, 'settings'],
        ['timezone_fallback', null, 'settings'],
        ['bad_param', null, 'params'],
        ['bad_action', null, 'actions'],
        ['unknown_destination', null, 'actions'],
        ['no_failure_notification', null, 'actions'],
        ['missing_target_job', null, 'actions'],
        ['whatever', null, 'steps'],
        ['bad_cron', 'a', 'triggers'],
        ['bad_action', 'a', 'steps'],
    ])('%s (step %s) goes to %s', (code, step, tab) => {
        expect(tabForIssue(mk(code, step))).toBe(tab);
    });
});

describe('nodeForIssue', () => {
    const job = (edgeExpr: string | null, triggers = true): JobDefinition => ({
        name: 'j',
        enabled: true,
        steps: [
            { id: 'a', type: 'inline', spl: '| makeresults' },
            { id: 'c', type: 'inline', spl: '| makeresults' },
        ],
        edges: edgeExpr === null ? [{ from: 'a', to: 'c', condition: 'on_success' }] : [{ from: 'a', to: 'c', condition: 'expression', expression: edgeExpr }],
        triggers: triggers ? [{ type: 'cron', cron: '0 1 * * *' }] : [],
    });
    const at = (code: string, step: string | null, message: string): Issue => ({ level: 'error', code, step, message });

    it('a step issue selects the step', () => {
        expect(nodeForIssue(job(null), mk('bad_step', 'a'))).toBe('step:a');
    });
    it('an empty condition selects the condition node', () => {
        expect(nodeForIssue(job(''), at('bad_expression', 'c', 'dependency a->c: empty expression'))).toBe('cond:a>c');
    });
    it('an invalid condition, named in the message, selects the condition node', () => {
        expect(nodeForIssue(job('$zz$ > 1'), at('unknown_token', 'c', "dependency a->c: $zz$ isn't a token this job has; pick one with Insert value"))).toBe('cond:a>c');
        expect(nodeForIssue(job('> >'), at('bad_expression', 'c', 'dependency a->c: unexpected >'))).toBe('cond:a>c');
    });
    it('a token issue in the step itself selects the step', () => {
        expect(nodeForIssue(job('1 = 1'), at('unknown_token', 'c', "$zz.sid$ isn't a token this job has; pick one with Insert value or fix the spelling"))).toBe('step:c');
        expect(nodeForIssue(job(null), at('bad_expression', 'c', 'run when: unexpected end'))).toBe('step:c');
    });
    it.each(['bad_cron', 'bad_trigger', 'job_chain_cycle'])('%s selects the first trigger, or nothing without one', (code) => {
        expect(nodeForIssue(job(null), mk(code))).toBe('trigger:0');
        expect(nodeForIssue(job(null, false), mk(code))).toBeNull();
    });
    it.each(['bad_action', 'unknown_destination', 'no_failure_notification'])('%s of the whole job selects no node (it opens the Job actions tab)', (code) => {
        expect(nodeForIssue(job(null), mk(code))).toBeNull();
    });
    it('a trigger issue naming a followed job selects that trigger', () => {
        const j = {
            ...job(null),
            triggers: [
                { type: 'cron' as const, cron: '0 1 * * *' },
                { type: 'completion' as const, job: 'nightly_load', on: 'success' as const },
            ],
        };
        expect(nodeForIssue(j, at('bad_trigger', null, "job 'nightly_load' doesn't exist; pick another in Job"))).toBe('trigger:1');
        expect(nodeForIssue(j, at('bad_cron', null, "cron '0 1 * * *' has no next time"))).toBe('trigger:0');
        expect(nodeForIssue(j, at('bad_trigger', null, 'something else'))).toBe('trigger:0');
    });
    it('a completion trigger with no job is chosen for the "needs a job" issue', () => {
        const j = {
            ...job(null),
            triggers: [
                { type: 'cron' as const, cron: '0 1 * * *' },
                { type: 'completion' as const, job: '', on: 'success' as const },
            ],
        };
        expect(nodeForIssue(j, at('bad_trigger', null, 'a completion trigger needs a job to follow; pick one in Job'))).toBe('trigger:1');
    });
    it("a step's own token error selects the step even with an empty condition into it", () => {
        expect(nodeForIssue(job(''), at('unknown_token', 'c', "$zz.sid$ isn't a token this job has; pick one with Insert value"))).toBe('step:c');
    });

    describe('action issues', () => {
        const acts = (): JobDefinition => ({
            ...job(null),
            steps: [
                {
                    id: 'a',
                    type: 'inline',
                    spl: '| makeresults',
                    actions: [
                        { hook: 'on_failure', type: 'email', to: 'ops@x.com' },
                        { hook: 'on_success', type: 'event', index: '' },
                        { hook: 'on_failure', type: 'email', to: '' },
                    ],
                },
                { id: 'c', type: 'inline', spl: '| makeresults' },
            ],
            actions: [
                { hook: 'on_failure', type: 'email', to: 'ops@x.com' },
                { hook: 'on_failure', type: 'webhook', destination: 'slack-ops' },
                { hook: 'on_success', type: 'webhook', destination: 'gone' },
            ],
        });
        it('a step-level missing field selects the action of that kind with the field empty', () => {
            expect(nodeForIssue(acts(), at('bad_action', 'a', 'the email action needs to; fill it in'))).toBe('action:a:2');
            expect(nodeForIssue(acts(), at('bad_action', 'a', 'the event action needs index; fill it in'))).toBe('action:a:1');
        });
        it('a step-level issue with nothing to match selects the first action with an empty required field', () => {
            expect(nodeForIssue(acts(), at('bad_action', 'a', "unknown action time 'x'; choose one in When"))).toBe('action:a:1');
        });
        it('a job-level unknown destination is on the Job actions tab, not a node', () => {
            const issue = at('unknown_destination', null, "webhook destination 'gone' doesn't exist; pick another, or ask an admin to add it in Settings");
            expect(nodeForIssue(acts(), issue)).toBeNull();
            expect(tabForIssue(issue)).toBe('actions');
        });
        it('a step with no actions keeps selecting the step', () => {
            expect(nodeForIssue(acts(), at('bad_action', 'c', 'the email action needs to; fill it in'))).toBe('step:c');
        });
        it('issuesForAction lists only the issues that lead to that action', () => {
            const issues = [
                at('bad_action', 'a', 'the email action needs to; fill it in'),
                at('bad_action', 'a', 'the event action needs index; fill it in'),
                at('unknown_destination', null, "webhook destination 'gone' doesn't exist; pick another"),
                at('bad_step', 'a', 'other'),
            ];
            expect(issuesForAction(acts(), issues, 'a', 2)).toEqual([issues[0]]);
            expect(issuesForAction(acts(), issues, 'a', 1)).toEqual([issues[1]]);
            expect(issuesForAction(acts(), issues, 'job', 2)).toEqual([issues[2]]);
            expect(issuesForAction(acts(), issues, 'job', 0)).toEqual([]);
        });
    });
    it.each(['bad_param', 'bad_timezone', 'timezone_fallback', 'whatever'])('%s selects no node', (code) => {
        expect(nodeForIssue(job(null), mk(code))).toBeNull();
    });
});

describe('issueCounts', () => {
    it('counts errors only, per tab', () => {
        expect(issueCounts([mk('bad_cron'), mk('bad_timezone'), mk('bad_param'), mk('x', 'a'), mk('bad_action', null, 'warning')])).toEqual({
            triggers: 1,
            steps: 1,
            settings: 1,
            params: 1,
        });
    });
});

describe('IssueSummary', () => {
    it('lists each error with a Go to link', () => {
        const onGo = jest.fn();
        const issues = [mk('x', 'a'), mk('bad_cron')];
        renderThemed(<IssueSummary issues={issues} stepNames={{ a: 'Alpha' }} onGo={onGo} />);
        expect(screen.getByText('Fix 2 problems before saving')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Go to Alpha: m-x' }));
        expect(onGo).toHaveBeenCalledWith(issues[0]);
        expect(screen.getByRole('button', { name: 'Go to Triggers: m-bad_cron' })).toHaveTextContent('Go to Triggers');
    });

    it('uses the singular title for one error', () => {
        renderThemed(<IssueSummary issues={[mk('x')]} onGo={jest.fn()} />);
        expect(screen.getByText('Fix 1 problem before saving')).toBeInTheDocument();
    });
});

describe('BuilderPage issue feedback', () => {
    const errs: Issue[] = [
        { level: 'error', code: 'bad_cron', message: 'Bad cron', step: null },
        { level: 'error', code: 'x', message: 'Step broke', step: 'weekly' },
    ];
    const open = async (issues: Issue[] = errs) => {
        const api = fakeApi({
            validateJob: jest.fn().mockResolvedValue({ valid: false, issues, owner_will_change: false, owner: 'alice' }),
        });
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText(issues.length === 1 ? 'Fix 1 problem before saving' : `Fix ${issues.length} problems before saving`);
        return api;
    };

    it('counts trigger errors on Triggers and opens that tab', async () => {
        await open();
        expect(screen.getByRole('tab', { name: /Triggers/ })).toHaveTextContent('1');
        expect(screen.getByRole('tab', { name: /Flow/ })).toHaveTextContent('1');
        fireEvent.click(screen.getByRole('tab', { name: /Settings/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Go to Triggers: Bad cron' }));
        expect(screen.getByRole('tab', { name: /Triggers/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('region', { name: 'Trigger 1' })).toBeInTheDocument();
    });

    it('omits the count on a tab with no errors', async () => {
        await open([{ level: 'error', code: 'bad_param', message: 'Bad param', step: null }]);
        expect(screen.getByRole('tab', { name: /Parameters/ })).toHaveTextContent('1');
        expect(screen.getByRole('tab', { name: /Flow/ })).not.toHaveTextContent(/\d/);
    });

    it('keeps a server-only error while editing until a fresh check clears it', async () => {
        const badCron: Issue = { level: 'error', code: 'bad_cron', message: 'Bad cron', step: null };
        const validateJob = jest.fn().mockImplementation((job: { name: string }) =>
            Promise.resolve({ valid: job.name !== 'Renamed', issues: job.name === 'Renamed' ? [] : [badCron], owner_will_change: false, owner: 'alice' })
        );
        const api = fakeApi({ validateJob });
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText('Fix 1 problem before saving');
        fireEvent.change(screen.getByLabelText('Job name'), { target: { value: 'Renamed' } });
        expect(screen.getByText('Fix 1 problem before saving')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Triggers/ })).toHaveTextContent('1');
        await waitFor(() => expect(screen.queryByText(/before saving/)).not.toBeInTheDocument(), { timeout: 3000 });
        expect(validateJob).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed' }));
        expect(screen.getByRole('tab', { name: /Triggers/ })).not.toHaveTextContent(/\d/);
    });

    it('selects the step for a step issue', async () => {
        await open();
        fireEvent.click(screen.getByRole('button', { name: /^Go to Weekly rollup: Step broke/ }));
        expect(screen.getByRole('tab', { name: /Flow/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: /^Search Weekly rollup/ })).toHaveAttribute('aria-pressed', 'true');
    });

    it('a step-level and a job-level action error select their action and show the message in its panel', async () => {
        const job = rollupJob({
            steps: rollupJob().steps.map((st) => (st.id === 'weekly' ? { ...st, actions: [{ hook: 'on_failure', type: 'email', to: '' }] } : st)),
            actions: [
                { hook: 'on_failure', type: 'email', to: 'ops@example.com' },
                { hook: 'on_success', type: 'webhook', destination: 'gone' },
            ],
        });
        const issues: Issue[] = [
            { level: 'error', code: 'bad_action', message: 'the email action needs to; fill it in', step: 'weekly' },
            { level: 'error', code: 'unknown_destination', message: "webhook destination 'gone' doesn't exist; pick another", step: null },
        ];
        const api = fakeApi({
            getJob: jest.fn().mockResolvedValue(job),
            validateJob: jest.fn().mockResolvedValue({ valid: false, issues, owner_will_change: false, owner: 'alice' }),
        });
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Weekly rollup/ });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText('Fix 2 problems before saving');
        fireEvent.click(screen.getByRole('button', { name: 'Go to Weekly rollup: the email action needs to; fill it in' }));
        expect(screen.getByTestId('node-action:weekly:0')).toHaveAttribute('aria-pressed', 'true');
        const panel = screen.getByRole('region', { name: 'Action' });
        expect(panel).toHaveTextContent('the email action needs to; fill it in');
        fireEvent.click(screen.getByRole('button', { name: /^Go to .*webhook destination 'gone'/ }));
        expect(screen.getByTestId('job-actions-tab')).toBeInTheDocument();
    });

    it('an empty condition in the save list selects the condition node and shows its panel', async () => {
        const job = rollupJob({
            steps: [
                { id: 'a', name: 'Load', type: 'inline', spl: '| makeresults' },
                { id: 'c', name: 'Report', type: 'inline', spl: '| makeresults' },
            ],
            edges: [{ from: 'a', to: 'c', condition: 'expression', expression: '' }],
        });
        renderThemed(<BuilderPage jobId="rollups" api={fakeApi({ getJob: jest.fn().mockResolvedValue(job) })} />);
        await screen.findByRole('button', { name: /^Search Report/ });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText('Fix 1 problem before saving');
        fireEvent.click(screen.getByRole('button', { name: 'Go to Report: dependency a->c: empty expression' }));
        expect(screen.getByTestId('node-cond:a>c')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('region', { name: 'Dependency Load to Report' })).toBeInTheDocument();
        expect(screen.getByLabelText('Expression')).toBeInTheDocument();
    });
});

describe('save problem list lifecycle', () => {
    // Two client-side errors: no job name and an empty search on the first step.
    const broken = () => {
        const j = rollupJob({ name: '' });
        j.steps = j.steps.map((st) => (st.id === 'daily' ? { ...st, spl: '' } : st));
        return j;
    };
    const open = async () => {
        const api = fakeApi({ getJob: jest.fn().mockResolvedValue(broken()) });
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Search Daily summary/ });
        return api;
    };
    const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const fixName = () => fireEvent.change(screen.getByLabelText('Job name'), { target: { value: 'Fixed' } });
    const fixSearch = () => {
        fireEvent.click(screen.getByRole('button', { name: 'Go to Daily summary: this step has no search; write one in Search' }));
        fireEvent.change(screen.getByLabelText('Search'), { target: { value: '| makeresults' } });
    };

    it('updates as errors are fixed, then disappears', async () => {
        await open();
        save();
        expect(await screen.findByText('Fix 2 problems before saving')).toBeInTheDocument();
        fixName();
        expect(await screen.findByText('Fix 1 problem before saving')).toBeInTheDocument();
        expect(screen.queryByText('the job needs a name; type one in Job name')).not.toBeInTheDocument();
        fixSearch();
        await waitFor(() => expect(screen.queryByText(/before saving/)).not.toBeInTheDocument());
    });

    it('a second save attempt shows only the current errors', async () => {
        const api = await open();
        save();
        await screen.findByText('Fix 2 problems before saving');
        fixName();
        await screen.findByText('Fix 1 problem before saving');
        save();
        expect(await screen.findByText('Fix 1 problem before saving')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /^Go to .*: this step has no search/ })).toHaveLength(1);
        expect(api.updateJob).not.toHaveBeenCalled();
    });

    it('is not shown before a save attempt', async () => {
        await open();
        expect(screen.queryByText(/before saving/)).not.toBeInTheDocument();
    });
});
