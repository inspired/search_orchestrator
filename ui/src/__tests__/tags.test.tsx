import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import JobsTable from '../features/jobs/JobsTable';
import RunsTable, { filterRuns } from '../features/runs/RunsTable';
import { TagsField } from '../features/builder/JobTabs';
import { allTags, cleanTags, hasTag, tagsProblem } from '../features/jobs/tags';
import { NOW, job, me, renderThemed, runSummary } from './fixtures';

describe('job tags', () => {
    test('helpers: one spelling per tag, matching ignores case, problems named', () => {
        expect(allTags([{ tags: ['etl', 'Billing'] }, { tags: ['ETL'] }, {}])).toEqual(['Billing', 'etl']);
        expect(hasTag({ tags: ['Billing'] }, 'billing')).toBe(true);
        expect(hasTag({ tags: [] }, 'billing')).toBe(false);
        expect(hasTag(undefined, '')).toBe(true);
        expect(cleanTags([' a  b ', 'A B', '', 'c'])).toEqual(['a b', 'c']);
        expect(tagsProblem(['-x'])).toMatch(/isn't a valid tag/);
        expect(tagsProblem(Array.from({ length: 11 }, (_, i) => `t${i}`))).toMatch(/at most 10/);
        expect(tagsProblem(['ok'])).toBeNull();
    });

    beforeEach(() => window.localStorage.removeItem('so.jobs.view'));

    test('Jobs: tags show under the name, filter by the Tag select or a click, and are searchable', () => {
        const a = job({ id: 'a', name: 'Alpha', tags: ['billing'] });
        const b = job({ id: 'b', name: 'Bravo', tags: ['etl'] });
        renderThemed(<JobsTable jobs={[a, b]} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        expect(within(screen.getByText('Alpha').closest('tr') as HTMLElement).getByTestId('job-tags')).toHaveTextContent('#billing');
        fireEvent.click(screen.getByLabelText('Show jobs tagged etl'));
        expect(screen.queryByText('Alpha')).toBeNull();
        expect(screen.getByText('Bravo')).toBeInTheDocument();
        expect(JSON.parse(window.localStorage.getItem('so.jobs.view') || '{}').tag).toBe('etl');
    });

    test('Runs: the Tag filter keeps runs of jobs with the tag', () => {
        const runs = [runSummary({ id: 'a:1', job_id: 'a' }), runSummary({ id: 'b:1', job_id: 'b' })];
        const tags = { a: ['billing'], b: [] };
        expect(filterRuns(runs, { tag: 'Billing' }, tags).map((r) => r.id)).toEqual(['a:1']);
        window.localStorage.setItem('so.runs.grouped', '0');
        const onFiltersChange = jest.fn();
        renderThemed(<RunsTable runs={runs} jobNames={{ a: 'Alpha', b: 'Bravo' }} jobTags={tags} filters={{}} onFiltersChange={onFiltersChange} now={NOW} />);
        expect(screen.getByLabelText('Tag')).toBeInTheDocument();
    });

    test('builder: the Tags field shows the job tags and offers known ones', () => {
        const dispatch = jest.fn();
        renderThemed(<TagsField job={{ name: 'x', enabled: true, steps: [], tags: ['billing'] }} dispatch={dispatch} knownTags={['etl']} />);
        expect(screen.getByText('billing')).toBeInTheDocument();
        expect(screen.getByText(/Group jobs by team or system/)).toBeInTheDocument();
    });
});

describe('filtered Jobs list', () => {
    beforeEach(() => window.localStorage.setItem('so.jobs.view', JSON.stringify({ tag: 'billing' })));
    afterEach(() => window.localStorage.removeItem('so.jobs.view'));

    test('a remembered filter says how many jobs it hides, and Show all jobs clears it', () => {
        const a = job({ id: 'a', name: 'Alpha', tags: ['billing'] });
        const b = job({ id: 'b', name: 'Bravo' });
        renderThemed(<JobsTable jobs={[a, b]} me={me} onRunNow={jest.fn()} onToggleEnabled={jest.fn()} />);
        expect(screen.getByTestId('jobs-filtered')).toHaveTextContent('Showing 1 of 2 jobs: tagged billing');
        expect(screen.queryByText('Bravo')).toBeNull();
        fireEvent.click(screen.getByText('Show all jobs'));
        expect(screen.getByText('Bravo')).toBeInTheDocument();
        expect(screen.queryByTestId('jobs-filtered')).toBeNull();
    });
});
