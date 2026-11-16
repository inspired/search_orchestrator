import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { issueCounts, nodeForIssue, tabForIssue } from '../features/builder/issueTabs';
import IssueSummary from '../features/builder/IssueSummary';
import BuilderPage from '../features/builder/BuilderPage';
import { fakeApi, rollupJob } from './builderFixtures';
import { renderThemed } from './fixtures';
import type { Issue, JobDefinition } from '../api/types';

const mk = (code: string, step: string | null = null, level: 'error' | 'warning' = 'error'): Issue => ({ level, code, message: `m-${code}`, step });

describe('tabForIssue', () => {
    it.each([
        ['bad_cron', null, 'steps'],
        ['bad_trigger', null, 'steps'],
        ['job_chain_cycle', null, 'steps'],
        ['bad_timezone', null, 'settings'],
        ['timezone_fallback', null, 'settings'],
        ['bad_param', null, 'params'],
        ['bad_action', null, 'steps'],
        ['unknown_destination', null, 'steps'],
        ['no_failure_notification', null, 'steps'],
        ['whatever', null, 'steps'],
        ['bad_cron', 'a', 'steps'],
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
    it.each(['bad_action', 'unknown_destination', 'no_failure_notification'])('%s selects the whole job', (code) => {
        expect(nodeForIssue(job(null), mk(code))).toBe('job');
    });
    it.each(['bad_param', 'bad_timezone', 'timezone_fallback', 'whatever'])('%s selects no node', (code) => {
        expect(nodeForIssue(job(null), mk(code))).toBeNull();
    });
});

describe('issueCounts', () => {
    it('counts errors only, per tab', () => {
        expect(issueCounts([mk('bad_cron'), mk('bad_timezone'), mk('bad_param'), mk('x', 'a'), mk('bad_action', null, 'warning')])).toEqual({
            steps: 2,
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
        expect(screen.getByRole('button', { name: 'Go to Flow: m-bad_cron' })).toHaveTextContent('Go to Flow');
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

    it('counts trigger errors on Flow and selects the schedule node', async () => {
        await open();
        expect(screen.getByRole('tab', { name: /Flow/ })).toHaveTextContent('2');
        fireEvent.click(screen.getByRole('tab', { name: /Settings/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Go to Flow: Bad cron' }));
        expect(screen.getByRole('tab', { name: /Flow/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('node-trigger:0')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('region', { name: 'Trigger' })).toBeInTheDocument();
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
        expect(screen.getByRole('tab', { name: /Flow/ })).toHaveTextContent('1');
        await waitFor(() => expect(screen.queryByText(/before saving/)).not.toBeInTheDocument(), { timeout: 3000 });
        expect(validateJob).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed' }));
        expect(screen.getByRole('tab', { name: /Flow/ })).not.toHaveTextContent(/\d/);
    });

    it('selects the step for a step issue', async () => {
        await open();
        fireEvent.click(screen.getByRole('button', { name: /^Go to Weekly rollup: Step broke/ }));
        expect(screen.getByRole('tab', { name: /Flow/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: /^Search Weekly rollup/ })).toHaveAttribute('aria-pressed', 'true');
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
