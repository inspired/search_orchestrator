import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { issueCounts, tabForIssue } from '../features/builder/issueTabs';
import IssueSummary from '../features/builder/IssueSummary';
import BuilderPage from '../features/builder/BuilderPage';
import { fakeApi, rollupJob } from './builderFixtures';
import { renderThemed } from './fixtures';
import type { Issue } from '../api/types';

const mk = (code: string, step: string | null = null, level: 'error' | 'warning' = 'error'): Issue => ({ level, code, message: `m-${code}`, step });

describe('tabForIssue', () => {
    it.each([
        ['bad_cron', null, 'triggers'],
        ['bad_trigger', null, 'triggers'],
        ['bad_timezone', null, 'triggers'],
        ['timezone_fallback', null, 'triggers'],
        ['job_chain_cycle', null, 'triggers'],
        ['bad_param', null, 'params'],
        ['bad_action', null, 'actions'],
        ['unknown_destination', null, 'actions'],
        ['no_failure_notification', null, 'actions'],
        ['whatever', null, 'steps'],
        ['bad_cron', 'a', 'steps'],
        ['bad_action', 'a', 'steps'],
    ])('%s (step %s) goes to %s', (code, step, tab) => {
        expect(tabForIssue(mk(code, step))).toBe(tab);
    });
});

describe('issueCounts', () => {
    it('counts errors only, per tab', () => {
        expect(issueCounts([mk('bad_cron'), mk('bad_cron'), mk('bad_param'), mk('x', 'a'), mk('bad_action', null, 'warning')])).toEqual({
            triggers: 2,
            params: 1,
            steps: 1,
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
    const open = async () => {
        const api = fakeApi({
            validateJob: jest.fn().mockResolvedValue({ valid: false, issues: errs, owner_will_change: false, owner: 'alice' }),
        });
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Step Weekly rollup/ });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText('Fix 2 problems before saving');
        return api;
    };

    it('shows counts on tabs and jumps to the tab', async () => {
        await open();
        expect(screen.getByRole('tab', { name: /Triggers/ })).toHaveTextContent('1');
        expect(screen.getByRole('tab', { name: /Steps/ })).toHaveTextContent('1');
        fireEvent.click(screen.getByRole('button', { name: 'Go to Triggers: Bad cron' }));
        expect(screen.getByRole('tab', { name: /Triggers/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('omits the count on a tab with no errors', async () => {
        const api = fakeApi({
            validateJob: jest.fn().mockResolvedValue({ valid: false, issues: [errs[0]], owner_will_change: false, owner: 'alice' }),
        });
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Step Weekly rollup/ });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText('Fix 1 problem before saving');
        expect(screen.getByRole('tab', { name: /Triggers/ })).toHaveTextContent('1');
        expect(screen.getByRole('tab', { name: /Steps/ })).not.toHaveTextContent(/\d/);
    });

    it('keeps a server-only error while editing until a fresh check clears it', async () => {
        const badCron: Issue = { level: 'error', code: 'bad_cron', message: 'Bad cron', step: null };
        const validateJob = jest.fn().mockImplementation((job: { name: string }) =>
            Promise.resolve({ valid: job.name !== 'Renamed', issues: job.name === 'Renamed' ? [] : [badCron], owner_will_change: false, owner: 'alice' })
        );
        const api = fakeApi({ validateJob });
        renderThemed(<BuilderPage jobId="rollups" api={api} />);
        await screen.findByRole('button', { name: /^Step Weekly rollup/ });
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
        expect(screen.getByRole('tab', { name: /Steps/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: /^Step Weekly rollup/ })).toHaveAttribute('aria-pressed', 'true');
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
        await screen.findByRole('button', { name: /^Step Daily summary/ });
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
