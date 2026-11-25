import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import SettingsForm from '../features/settings/SettingsForm';
import ExamplesDialog from '../features/jobs/ExamplesDialog';
import JobsTable from '../features/jobs/JobsTable';
import { exportFileName } from '../features/jobs/jobsFile';
import { activeCatalog, isTurnedOff, kindsOfJob, searchCatalog, setTurnedOff, targetKinds, turnedOffIn } from '../features/builder/nodeCatalog';
import type { JobDefinition, Settings } from '../api/types';
import { job, me, renderThemed } from './fixtures';

const SETTINGS: Settings = {
    max_searches: 10,
    max_searches_per_job: 4,
    queue_cap: 20,
    result_retention: 86400,
    run_retention_days: 90,
    fallback: null,
    base_url: null,
    turned_off: [],
};

afterEach(() => setTurnedOff([]));

describe('Building blocks', () => {
    test('a turned-off kind leaves the builder menus; Search and Schedule stay on', () => {
        setTurnedOff(['approval', 'slack', 'search', 'trigger_cron']);
        expect(isTurnedOff('approval')).toBe(true);
        expect(isTurnedOff('search')).toBe(false);
        expect(activeCatalog().map((e) => e.kind)).not.toContain('approval');
        expect(targetKinds('success', 'search')).not.toContain('approval');
        expect(targetKinds('success', 'search')).not.toContain('slack');
        expect(targetKinds('success', 'search')).toContain('email');
        expect(searchCatalog('approve').map((e) => e.kind)).toEqual([]);
        expect(targetKinds(null, null)).toContain('trigger_cron');
    });

    test('the kinds a job uses, and which of them are off', () => {
        const def = {
            name: 'x',
            enabled: true,
            triggers: [{ type: 'completion', job: 'y' }],
            steps: [
                { id: 'a', type: 'inline', spl: 'x' },
                { id: 'b', type: 'approval', actions: [{ hook: 'on_success', type: 'webhook', preset: 'slack', destination: 'd' }] },
            ],
        } as unknown as JobDefinition;
        expect([...kindsOfJob(def)].sort()).toEqual(['approval', 'search', 'slack', 'trigger_completion']);
        expect(turnedOffIn(def, ['slack', 'approval', 'lookup'])).toEqual(['Approval', 'Slack']);
    });

    test('Settings lists the blocks by group and saves only what changed', async () => {
        const onSave = jest.fn(() => Promise.resolve());
        renderThemed(<SettingsForm settings={SETTINGS} destinations={[]} onSave={onSave} />);
        expect(screen.getByRole('heading', { name: 'Building blocks' })).toBeInTheDocument();
        expect(within(screen.getByRole('group', { name: 'Steps' })).getByText('Approval')).toBeInTheDocument();
        expect(screen.queryByTestId('block-search')).toBeNull();
        expect(screen.queryByTestId('block-trigger_cron')).toBeNull();
        fireEvent.click(within(screen.getByTestId('block-approval')).getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
        await waitFor(() => expect(onSave).toHaveBeenCalledWith({ turned_off: ['approval'] }));
    });

    test('an example that uses a turned-off block can be looked at but not added', () => {
        renderThemed(<ExamplesDialog onClose={jest.fn()} returnFocus={{ current: null }} canAdd existingIds={[]} createJob={jest.fn()} turnedOff={['approval']} />);
        const card = screen.getByTestId('example-example_platform_health');
        expect(within(card).getByTestId('example-blocked')).toHaveTextContent('Uses Approval, which an admin turned off');
        expect(within(card).getByTestId('example-blocked')).toHaveTextContent('Add all examples skips it');
        expect(within(card).getByRole('button', { name: /Open .* in builder/ }).getAttribute('aria-disabled')).not.toBe('true');
    });

    test('one job can be exported from its ⋯ menu', () => {
        const onExport = jest.fn();
        renderThemed(<JobsTable jobs={[job({ id: 'a', name: 'Alpha' }), job({ id: 'b', name: 'Bravo' })]} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} onExport={onExport} />);
        fireEvent.click(screen.getByRole('button', { name: 'More actions for Bravo' }));
        fireEvent.click(screen.getByText('Export'));
        expect(onExport.mock.calls[0][0].map((j: { id: string }) => j.id)).toEqual(['b']);
        expect(exportFileName(new Date('2026-11-20T10:00:00Z'), 'daily logins')).toBe('search_orchestrator_job_daily_logins_2026-11-20.json');
        expect(exportFileName(new Date('2026-11-20T10:00:00Z'))).toBe('search_orchestrator_jobs_2026-11-20.json');
    });

    test('blocks still in development are tagged Beta in Settings', () => {
        renderThemed(<SettingsForm settings={SETTINGS} destinations={[]} onSave={jest.fn()} />);
        ['approval', 'webhook'].forEach((k) => expect(within(screen.getByTestId(`block-${k}`)).getByTestId('beta-tag')).toBeInTheDocument());
        // Retired: replaced by an Alert action, so not a building block any more.
        ['slack', 'teams', 'pagerduty', 'servicenow'].forEach((k) => expect(screen.queryByTestId(`block-${k}`)).toBeNull());
        expect(within(screen.getByTestId('block-email')).queryByTestId('beta-tag')).toBeNull();
        expect(screen.getByTestId('blocks-intro')).toHaveTextContent('Beta are still in development');
    });
});
