import React from 'react';
import { screen } from '@testing-library/react';
import JobTabs from '../features/builder/JobTabs';
import type { JobDefinition } from '../api/types';
import { renderThemed } from './fixtures';

test('the Settings tab has the time zone field, keeping a stored zone the browser does not list', () => {
    const job = { name: 'j', enabled: true, timezone: 'Etc/Unknown', steps: [] } as JobDefinition;
    renderThemed(
        <JobTabs activeTab="settings" onTabChange={jest.fn()} job={job} dispatch={jest.fn()} owner="a" roles={[]} steps={null} />
    );
    expect(screen.getByLabelText('Time zone')).toHaveValue('Etc/Unknown');
    expect(screen.getByText('Used by every schedule and Run when in this job.')).toBeInTheDocument();
});
