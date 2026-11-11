import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
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
        fireEvent.click(screen.getByRole('button', { name: 'Go to Triggers: Bad cron' }));
        expect(screen.getByRole('tab', { name: /Triggers/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('selects the step for a step issue', async () => {
        await open();
        fireEvent.click(screen.getByRole('button', { name: /^Go to Weekly rollup: Step broke/ }));
        expect(screen.getByRole('tab', { name: /Steps/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: /^Step Weekly rollup/ })).toHaveAttribute('aria-pressed', 'true');
    });
});
