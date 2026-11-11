/* Starting points for a new job: the shapes people build most, with placeholder searches. */
import type { Edge, JobDefinition, StepDef } from '../../api/types';
import { runWhenPreset } from './graphLogic';
import { blankJob } from './reducer';
import { TIME_RANGE_PRESETS } from './timeRange';

export interface JobTemplate {
    key: 'rollup' | 'serial' | 'parallel' | 'blank';
    title: string;
    description: string;
    build: () => JobDefinition;
}

const PLACEHOLDER_SPL = '```Replace with your search```\n| makeresults';

const preset = (key: string) => {
    const found = TIME_RANGE_PRESETS.find((p) => p.key === key);
    return { earliest: found ? found.earliest : '', latest: found ? found.latest : '' };
};

const search = (id: string, name: string, range: { earliest: string; latest: string }, extra: Partial<StepDef> = {}): StepDef => ({
    id,
    name,
    type: 'inline',
    spl: PLACEHOLDER_SPL,
    ...range,
    ...extra,
});

const onSuccess = (from: string, to: string): Edge => ({ from, to, condition: 'on_success' });

const withCron = (cron: string, steps: StepDef[], edges: Edge[]): JobDefinition => ({
    ...blankJob(),
    triggers: [{ type: 'cron', cron }],
    steps,
    edges,
});

export const JOB_TEMPLATES: JobTemplate[] = [
    {
        key: 'rollup',
        title: 'Daily, weekly and monthly rollup',
        description: 'A daily summary, then a weekly rollup on Mondays and a monthly one on the 1st, each waiting for the one before.',
        build: () =>
            withCron(
                '0 1 * * *',
                [
                    search('daily', 'Daily summary', preset('previous_day')),
                    search('weekly', 'Weekly rollup', { earliest: '-7d@d', latest: '@d' }, { run_when: runWhenPreset('mondays') }),
                    search('monthly', 'Monthly rollup', preset('previous_month'), { run_when: runWhenPreset('first_of_month') }),
                ],
                [onSuccess('daily', 'weekly'), onSuccess('weekly', 'monthly')]
            ),
    },
    {
        key: 'serial',
        title: 'One search after another',
        description: 'Step 2 starts when step 1 succeeds.',
        build: () =>
            withCron(
                '0 2 * * *',
                [search('first', 'First search', preset('previous_day')), search('second', 'Second search', preset('previous_day'))],
                [onSuccess('first', 'second')]
            ),
    },
    {
        key: 'parallel',
        title: 'Run searches side by side, then combine',
        description: 'Two searches run at once; a third works on both their results.',
        build: () =>
            withCron(
                '0 2 * * *',
                [
                    search('left', 'Left search', preset('previous_day')),
                    search('right', 'Right search', preset('previous_day')),
                    { id: 'combined', name: 'Combine results', type: 'previous', spl: '| stats count' },
                ],
                [onSuccess('left', 'combined'), onSuccess('right', 'combined')]
            ),
    },
    { key: 'blank', title: 'Blank job', description: 'Start with an empty canvas.', build: blankJob },
];

export function templateByKey(key: string | null | undefined): JobTemplate | null {
    return JOB_TEMPLATES.find((t) => t.key === key) || null;
}
