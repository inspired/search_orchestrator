import React from 'react';
import { render } from '@testing-library/react';
import SplunkThemeProvider from '@splunk/themes/SplunkThemeProvider';
import type { Job, Me, RunDetail, RunSummary } from '../api/types';

export const NOW = 1764550800; // 2025-12-01 01:00 UTC

export function renderThemed(ui: React.ReactElement) {
    return render(
        <SplunkThemeProvider family="enterprise" colorScheme="light" density="comfortable">
            {ui}
        </SplunkThemeProvider>
    );
}

export const me: Me = {
    user: 'alice',
    roles: ['builder'],
    capabilities: ['orchestrator_build', 'orchestrator_run'],
    can_admin: false,
    can_build: true,
    can_run: true,
};

export function job(over: Partial<Job> = {}): Job {
    return {
        id: 'daily',
        name: 'Daily summary',
        owner: 'alice',
        enabled: true,
        steps: [{ id: 'a', type: 'inline', spl: '| makeresults' }],
        params: [],
        permissions: { can_edit: true, can_run: true },
        next_run: NOW + 3600,
        last_run: null,
        ...over,
    };
}

export function runSummary(over: Partial<RunSummary> = {}): RunSummary {
    return {
        id: 'daily:1764547200',
        job_id: 'daily',
        owner: 'alice',
        trigger: 'cron',
        upstream: null,
        scheduled_time: NOW - 3600,
        params: {},
        state: 'succeeded',
        catchup: false,
        created_at: NOW - 3600,
        queued_at: NOW - 3600,
        started_at: NOW - 3600,
        ended_at: NOW - 3000,
        delay_base: NOW - 3600,
        giveup_base: NOW - 3600,
        paused_seconds: 0,
        paused_at: null,
        delay_alerted: false,
        held: false,
        gave_up: false,
        rerun_count: 0,
        chain_depth: 0,
        steps: {},
        ...over,
    };
}

/** daily -> weekly -> monthly, with a 60 minute delay threshold on the job. */
export function rollupRun(over: Partial<RunDetail> = {}): RunDetail {
    return {
        ...runSummary({ id: 'rollup:1', job_id: 'rollup', state: 'running', ended_at: null }),
        definition: {
            id: 'rollup',
            name: 'Nightly rollup',
            enabled: true,
            defaults: { delayed_after: 3600 },
            steps: [
                { id: 'daily', name: 'Daily summary', type: 'inline', spl: '| makeresults' },
                { id: 'weekly', name: 'Weekly rollup', type: 'inline', spl: '| makeresults' },
                { id: 'monthly', name: 'Monthly rollup', type: 'inline', spl: '| makeresults' },
            ],
            edges: [
                { from: 'daily', to: 'weekly', condition: 'on_success' },
                { from: 'weekly', to: 'monthly', condition: 'on_success' },
            ],
        },
        definition_changed: false,
        rerun_latest: {},
        permissions: { can_run: true },
        ...over,
    };
}
