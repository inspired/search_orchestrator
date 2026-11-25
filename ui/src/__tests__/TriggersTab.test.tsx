import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Issue, JobDefinition } from '../api/types';
import JobTabs from '../features/builder/JobTabs';
import TriggersTab from '../features/builder/TriggersTab';
import { issueCounts } from '../features/builder/issueTabs';
import { setTurnedOff } from '../features/builder/nodeCatalog';
import { renderThemed } from './fixtures';

afterEach(() => setTurnedOff([]));

const job = (over: Partial<JobDefinition> = {}): JobDefinition =>
    ({
        name: 'J',
        enabled: true,
        timezone: 'UTC',
        triggers: [
            { type: 'cron', cron: '0 6 * * *', enabled: true },
            { type: 'completion', job: 'other', on: 'success', enabled: true, steps: ['a'] },
        ],
        steps: [
            { id: 'a', name: 'Alpha', type: 'inline', spl: 'index=x' },
            { id: 'b', name: 'Beta step', type: 'inline', spl: 'index=y' },
        ],
        edges: [],
        ...over,
    }) as JobDefinition;

const props = (over: Record<string, unknown> = {}) => ({
    job: job(),
    jobs: [{ id: 'other', name: 'Other job' }],
    dispatch: jest.fn(),
    onOpenSettings: jest.fn(),
    ...over,
});

describe('Triggers tab', () => {
    test('one card per trigger with its schedule editor', () => {
        renderThemed(<TriggersTab {...props()} />);
        const cards = screen.getAllByRole('region', { name: /^Trigger \d/ });
        expect(cards).toHaveLength(2);
        expect(within(cards[0]).getByRole('heading', { name: 'Schedule' })).toBeInTheDocument();
        expect(within(cards[1]).getByRole('heading', { name: 'After another job' })).toBeInTheDocument();
    });

    test('Starts shows startedBy and toggles through setTriggerStep', async () => {
        const user = userEvent.setup();
        const p = props();
        renderThemed(<TriggersTab {...p} />);
        const cards = screen.getAllByRole('region', { name: /^Trigger \d/ });
        // No list: every first step. A list: only those.
        const box = (card: HTMLElement, name: string) => within(card).getByRole('checkbox', { name });
        expect(box(cards[0], 'Alpha')).toBeChecked();
        expect(box(cards[0], 'Beta step')).toBeChecked();
        expect(box(cards[1], 'Alpha')).toBeChecked();
        expect(box(cards[1], 'Beta step')).not.toBeChecked();
        await user.click(within(cards[1]).getByRole('checkbox', { name: 'Beta step' }));
        expect(p.dispatch).toHaveBeenCalledWith({ type: 'setJob', job: expect.objectContaining({ triggers: [expect.anything(), expect.objectContaining({ steps: ['a', 'b'] })] }) });
    });

    test('Add schedule adds a cron trigger', () => {
        const p = props();
        renderThemed(<TriggersTab {...p} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add schedule' }));
        expect(p.dispatch).toHaveBeenCalledWith({ type: 'addNode', kind: 'trigger_cron' });
    });

    test('Add after another job hidden when turned off', () => {
        setTurnedOff(['trigger_completion']);
        renderThemed(<TriggersTab {...props()} />);
        expect(screen.queryByRole('button', { name: 'Add after another job' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Add schedule' })).toBeInTheDocument();
    });

    test('Triggers tab in every view, after the first tab', () => {
        const base = { activeTab: 'steps' as const, onTabChange: jest.fn(), job: job(), dispatch: jest.fn(), owner: 'alice', roles: [], steps: <div /> };
        (['simple', 'standard', 'advanced'] as const).forEach((view) => {
            const { unmount } = renderThemed(<JobTabs {...base} view={view} triggers={<div />} />);
            expect(screen.getAllByRole('tab')[0]).toHaveTextContent('Flow');
            expect(screen.getAllByRole('tab')[1]).toHaveTextContent('Triggers');
            unmount();
        });
    });

    test('trigger issues count on the Triggers tab in every view', () => {
        const issues: Issue[] = [{ level: 'error', code: 'bad_cron', message: 'bad cron' } as Issue];
        expect(issueCounts(issues, 'standard')).toEqual({ triggers: 1 });
        expect(issueCounts(issues, 'advanced')).toEqual({ triggers: 1 });
        expect(issueCounts(issues, 'simple')).toEqual({ triggers: 1 });
    });
});
