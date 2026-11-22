import type { JobDefinition } from '../api/types';
import { reducer } from '../features/builder/reducer';
import { buildGraph, canConnect } from '../features/builder/nodeModel';
import { rootSteps, setTriggerStep, startedBy, syncTriggerSteps } from '../features/builder/triggerSteps';

const job = (triggers: JobDefinition['triggers']): JobDefinition => ({
    name: 'j',
    enabled: true,
    steps: [
        { id: 'a', type: 'inline', spl: '| makeresults' },
        { id: 'b', type: 'inline', spl: '| makeresults' },
        { id: 'c', type: 'inline', spl: '| makeresults' },
    ],
    edges: [{ from: 'b', to: 'c', condition: 'on_success' }],
    triggers,
});

const triggerLines = (j: JobDefinition) =>
    buildGraph(j)
        .links.filter((l) => l.kind === 'trigger')
        .map((l) => `${l.from}->${l.to}`);

describe('trigger steps', () => {
    test('a trigger without a list starts every first step; with one, only those', () => {
        expect(rootSteps(job([]))).toEqual(['a', 'b']);
        expect(triggerLines(job([{ type: 'cron', cron: '0 6 * * *' }]))).toEqual(['trigger:0->step:a', 'trigger:0->step:b']);
        expect(triggerLines(job([{ type: 'cron', cron: '0 6 * * *', steps: ['b'] }]))).toEqual(['trigger:0->step:b']);
        expect(triggerLines(job([{ type: 'cron', cron: '0 6 * * *', steps: [] }]))).toEqual([]);
    });

    test('connecting adds the step; removing the line writes the list without it', () => {
        const j = job([{ type: 'cron', cron: '0 6 * * *', steps: [] }]);
        expect(canConnect(j, 'trigger:0', 'then', 'step:a').ok).toBe(true);
        expect(canConnect(j, 'trigger:0', 'then', 'step:c').ok).toBe(false); // c has a line into it
        const s1 = reducer({ job: j, past: [], future: [] } as never, { type: 'connectPort', from: 'trigger:0', port: 'then', to: 'step:a' });
        expect(s1.job.triggers![0].steps).toEqual(['a']);
        const legacy = job([{ type: 'cron', cron: '0 6 * * *' }]);
        const s2 = reducer({ job: legacy, past: [], future: [] } as never, { type: 'disconnectTrigger', index: 0, step: 'a' });
        expect(s2.job.triggers![0].steps).toEqual(['b']);
        expect(setTriggerStep(legacy, 0, 'a', true)).toBeNull(); // already started
    });

    test('lists drop steps that are removed or get a line into them', () => {
        const j = job([{ type: 'cron', cron: '0 6 * * *', steps: ['a', 'b', 'gone'] }]);
        expect(syncTriggerSteps(j).triggers![0].steps).toEqual(['a', 'b']);
        const linked = { ...j, edges: [...(j.edges || []), { from: 'a', to: 'b', condition: 'on_success' as const }] };
        expect(startedBy(linked, linked.triggers![0])).toEqual(['a']);
        expect(syncTriggerSteps(linked).triggers![0].steps).toEqual(['a']);
    });

    test('adding a step from a trigger connects it', () => {
        const j = job([{ type: 'cron', cron: '0 6 * * *', steps: [] }]);
        const s1 = reducer({ job: j, past: [], future: [] } as never, { type: 'addNode', kind: 'search', from: { key: 'trigger:0', port: 'then' } });
        const added = s1.job.steps![s1.job.steps!.length - 1].id;
        expect(s1.job.triggers![0].steps).toEqual([added]);
    });
});
