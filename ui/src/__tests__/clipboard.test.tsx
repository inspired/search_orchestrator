import type { JobDefinition } from '../api/types';
import type React from 'react';
import { copySelection, parseClip, pasteResult, readClip, writeClip, clipboardShortcut } from '../features/builder/clipboard';
import type { Clip } from '../features/builder/clipboard';
import { buildGraph } from '../features/builder/nodeModel';
import { layoutFlow } from '../features/builder/flowLayout';
import { blankJob, initialState, reducer } from '../features/builder/reducer';

const source: JobDefinition = {
    ...blankJob(),
    name: 'src',
    triggers: [{ type: 'cron', cron: '0 2 * * *', enabled: true }],
    actions: [{ hook: 'on_failure', type: 'email', to: 'job@x' }],
    steps: [
        {
            id: 'load',
            name: 'Load',
            type: 'inline',
            spl: 'index=a',
            actions: [{ hook: 'on_success', type: 'email', to: 'x@y', subject: 'rows $load.resultCount$' }],
        },
        { id: 'fold', name: 'Fold', type: 'previous', spl: '| stats count by $load.first.host$' },
        { id: 'out', name: 'Out', type: 'previous', spl: '| outputlookup keep.csv', output: { kind: 'lookup', name: 'keep.csv' } },
        { id: 'other', type: 'inline', spl: 'index=z' },
    ],
    edges: [
        { from: 'load', to: 'fold', condition: 'expression', expression: '$load.resultCount$ > 0' },
        { from: 'fold', to: 'out', condition: 'on_success' },
        { from: 'other', to: 'out', condition: 'on_success' },
    ],
    layout: {
        nodes: {
            'step:load': { x: 300, y: 200 },
            'step:fold': { x: 600, y: 200 },
            'step:out': { x: 900, y: 260 },
            'action:load:0': { x: 300, y: 400 },
            'cond:load>fold': { x: 450, y: 200 },
            'trigger:0': { x: 0, y: 200 },
            'action:job:0': { x: 50, y: 500 },
            job: { x: 0, y: 600 },
        },
    },
};
const shown = layoutFlow(buildGraph(source), source.layout?.nodes);

describe('copySelection', () => {
    it('copies steps with their actions and only the edges between copied steps', () => {
        const clip = copySelection(source, ['step:load', 'step:fold'], shown);
        expect(clip.so_clipboard).toBe(1);
        expect(clip.steps.map((s) => s.id)).toEqual(['load', 'fold']);
        expect(clip.steps[0].actions).toHaveLength(1);
        expect(clip.edges).toEqual([source.edges![0]]);
        expect(clip.job_actions).toEqual([]);
        expect(clip.triggers).toEqual([]);
        expect(clip.positions['step:load']).toEqual({ x: 300, y: 200 });
    });
    it('copies job actions only when the Whole job node is selected, and triggers only when selected', () => {
        expect(copySelection(source, ['step:other', 'action:job:0'], shown).job_actions).toEqual([]);
        const clip = copySelection(source, ['job', 'trigger:0'], shown);
        expect(clip.job_actions).toEqual(source.actions);
        expect(clip.triggers).toEqual(source.triggers);
        expect(clip.steps).toEqual([]);
    });
});

describe('trigger positions', () => {
    const many: JobDefinition = {
        ...blankJob(),
        triggers: [{ type: 'cron', cron: '1 * * * *' }, { type: 'cron', cron: '2 * * * *' }, { type: 'cron', cron: '3 * * * *' }],
    };
    const at3 = { 'trigger:0': { x: 10, y: 10 }, 'trigger:1': { x: 100, y: 200 }, 'trigger:2': { x: 160, y: 260 } };
    const into: JobDefinition = { ...blankJob(), triggers: [{ type: 'cron', cron: '9 * * * *' }] };
    it('a lone later trigger lands at `at`', () => {
        const clip = copySelection(many, ['trigger:1'], at3);
        expect(clip.positions).toEqual({ 'trigger:0': { x: 100, y: 200 } });
        const r = pasteResult(into, clip, { x: 5, y: 6 });
        expect(r.job.layout!.nodes['trigger:1']).toEqual({ x: 5, y: 6 });
    });
    it('two later triggers keep their relative layout', () => {
        const r = pasteResult(into, copySelection(many, ['trigger:1', 'trigger:2'], at3), { x: 0, y: 0 });
        expect(r.job.layout!.nodes['trigger:1']).toEqual({ x: 0, y: 0 });
        expect(r.job.layout!.nodes['trigger:2']).toEqual({ x: 60, y: 60 });
    });
});

describe('parseClip', () => {
    it('rejects steps with malformed actions or edges with bad ends', () => {
        const base = { so_clipboard: 1, steps: [], edges: [], job_actions: [], triggers: [], positions: {} };
        expect(parseClip(JSON.stringify({ ...base, steps: [{ id: 'a', type: 'inline', actions: 'x' }] }))).toBeNull();
        expect(parseClip(JSON.stringify({ ...base, steps: [{ id: 'a', type: 'inline', actions: [1] }] }))).toBeNull();
        expect(parseClip(JSON.stringify({ ...base, steps: [{ id: 'a', actions: 'x' }] }))).toBeNull();
        expect(parseClip(JSON.stringify({ ...base, edges: [{ from: 'a', to: 1 }] }))).toBeNull();
        expect(parseClip(JSON.stringify({ ...base, triggers: ['x'] }))).toBeNull();
    });
    it('returns null for anything that is not a clip', () => {
        expect(parseClip('hello')).toBeNull();
        expect(parseClip('{"a":1}')).toBeNull();
        expect(parseClip('null')).toBeNull();
        expect(parseClip(JSON.stringify({ so_clipboard: 1, steps: 'x' }))).toBeNull();
    });
    it('round-trips a clip', () => {
        const clip = copySelection(source, ['step:load'], shown);
        expect(parseClip(JSON.stringify(clip))).toEqual(clip);
    });
});

describe('pasteResult', () => {
    const target: JobDefinition = {
        ...blankJob(),
        name: 'target',
        steps: [
            { id: 'load', type: 'inline', spl: 'index=other' },
            { id: 'step_3', type: 'inline', spl: 'x' },
        ],
        edges: [],
    };

    it('into another job renames taken ids, rewrites tokens, and connects nothing to existing nodes', () => {
        const clip = copySelection(source, ['step:load', 'step:fold'], shown);
        const r = pasteResult(target, clip, { x: 1000, y: 1000 });
        const ids = r.job.steps.map((s) => s.id);
        expect(ids.slice(0, 2)).toEqual(['load', 'step_3']);
        const [a, b] = ids.slice(2);
        expect(a).not.toBe('load');
        expect(new Set(ids).size).toBe(4);
        const pastedLoad = r.job.steps[2];
        const pastedFold = r.job.steps[3];
        expect(pastedLoad.actions![0].subject).toBe(`rows $${a}.resultCount$`);
        expect(pastedFold.spl).toBe(`| stats count by $${a}.first.host$`);
        expect(r.job.edges).toEqual([{ from: a, to: b, condition: 'expression', expression: `$${a}.resultCount$ > 0` }]);
        expect(r.job.steps[0]).toEqual(target.steps[0]);
        expect(r.job.edges!.every((e) => [a, b].includes(e.from) && [a, b].includes(e.to))).toBe(true);
        expect(r.keys).toEqual(expect.arrayContaining([`step:${a}`, `step:${b}`, `action:${a}:0`, `cond:${a}>${b}`]));
        expect(r.message).toBe('Pasted 4 nodes');
    });

    it('keeps ids that are free and does not let a renamed id take a later free one', () => {
        const t: JobDefinition = { ...blankJob(), steps: [{ id: 'load', type: 'inline', spl: 'x' }, { id: 'a', type: 'inline', spl: 'x' }] };
        const clip: Clip = {
            so_clipboard: 1,
            steps: [{ id: 'load', type: 'inline', spl: 'x' }, { id: 'step_3', type: 'inline', spl: '$load.sid$ $step_3.sid$' }],
            edges: [],
            job_actions: [],
            triggers: [],
            positions: {},
        };
        const r = pasteResult(t, clip, { x: 0, y: 0 });
        const ids = r.job.steps.map((s) => s.id);
        expect(new Set(ids).size).toBe(4);
        expect(ids).toContain('step_3');
        const renamed = ids[2];
        expect(renamed).not.toBe('load');
        expect(r.job.steps[3].spl).toBe(`$${renamed}.sid$ $step_3.sid$`);
    });

    it('lands the clip top-left at `at`, keeps relative layout and seeds shown positions', () => {
        const clip = copySelection(source, ['step:load', 'step:fold', 'trigger:0'], shown);
        const r = pasteResult(target, clip, { x: 100, y: 50 });
        const nodes = r.job.layout!.nodes;
        const [a, b] = r.job.steps.slice(2).map((s) => s.id);
        expect(nodes[`step:${a}`]).toEqual({ x: 400, y: 50 });
        expect(nodes[`step:${b}`]).toEqual({ x: 700, y: 50 });
        expect(nodes['trigger:0']).toEqual({ x: 100, y: 50 });
        // The nodes already there stay where they were shown.
        const before = layoutFlow(buildGraph(target));
        expect(nodes['step:load']).toEqual(before['step:load']);
        expect(nodes['step_3'] ?? nodes['step:step_3']).toEqual(before['step:step_3']);
    });

    it('re-indexes action and trigger layout keys into the target', () => {
        const t: JobDefinition = {
            ...target,
            triggers: [{ type: 'cron', cron: '1 1 * * *' }],
            actions: [{ hook: 'on_success', type: 'email', to: 'q' }, { hook: 'on_failure', type: 'email', to: 'r' }],
        };
        const clip = copySelection(source, ['job', 'trigger:0'], shown);
        const r = pasteResult(t, clip, { x: 0, y: 0 });
        expect(r.job.actions).toHaveLength(3);
        expect(r.job.triggers).toHaveLength(2);
        expect(r.keys.sort()).toEqual(['action:job:2', 'trigger:1']);
        expect(r.job.layout!.nodes['action:job:2']).toBeDefined();
        expect(r.job.layout!.nodes['trigger:1']).toBeDefined();
    });

    it('counts previous steps with no incoming pasted line', () => {
        const one = pasteResult(target, copySelection(source, ['step:fold'], shown), { x: 0, y: 0 });
        expect(one.message).toBe('Pasted 1 node; 1 needs a line into it');
        const two = pasteResult(target, copySelection(source, ['step:fold', 'step:out'], shown), { x: 0, y: 0 });
        expect(two.message).toBe('Pasted 2 nodes; 1 needs a line into it');
        const three = pasteResult(target, copySelection(source, ['step:fold', 'step:out', 'step:load', 'step:other'], shown), { x: 0, y: 0 });
        expect(three.message).not.toMatch(/need/);
        const lone: JobDefinition = { ...blankJob(), steps: [{ id: 'p', type: 'previous', spl: '| x' }, { id: 'q', type: 'previous', spl: '| y' }] };
        const both = pasteResult(target, copySelection(lone, ['step:p', 'step:q'], layoutFlow(buildGraph(lone))), { x: 0, y: 0 });
        expect(both.message).toBe('Pasted 2 nodes; 2 need a line into them');
    });

    it('pastes a lookup output step into a job whose step ids differ', () => {
        const clip = copySelection(source, ['step:out'], shown);
        const r = pasteResult(target, clip, { x: 0, y: 0 });
        const pasted = r.job.steps[2];
        expect(pasted.id).toBe('out');
        expect(pasted.output).toEqual({ kind: 'lookup', name: 'keep.csv' });
        expect(pasted.spl).toBe('| outputlookup keep.csv');
        expect(r.job.edges).toEqual([]);
    });
});

describe('reducer paste', () => {
    it('is one undo step', () => {
        const s0 = initialState(source);
        const clip = copySelection(source, ['step:load', 'step:fold'], shown);
        const s1 = reducer(s0, { type: 'paste', clip, at: { x: 0, y: 0 } });
        expect(s1.job.steps).toHaveLength(6);
        expect(s1.past).toHaveLength(1);
        expect(reducer(s1, { type: 'undo' }).job).toEqual(s0.job);
    });
});

describe('system clipboard', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    afterEach(() => {
        if (original) {
            Object.defineProperty(navigator, 'clipboard', original);
        } else {
            delete (navigator as unknown as Record<string, unknown>).clipboard;
        }
    });
    const clip = copySelection(source, ['step:load'], shown);

    it('writes JSON text and reads it back', async () => {
        let text = '';
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async (t: string) => { text = t; }, readText: async () => text },
        });
        await writeClip(clip);
        expect(JSON.parse(text).so_clipboard).toBe(1);
        expect(await readClip()).toEqual(clip);
    });

    it('falls back to memory when the API throws or is missing', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async () => { throw new Error('denied'); }, readText: async () => { throw new Error('denied'); } },
        });
        await writeClip(clip);
        expect(await readClip()).toEqual(clip);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
        const other = copySelection(source, ['step:other'], shown);
        await writeClip(other);
        expect(await readClip()).toEqual(other);
    });

    it('uses the memory copy when the system clipboard holds something else', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async () => undefined, readText: async () => 'hello' },
        });
        await writeClip(clip);
        expect(await readClip()).toEqual(clip);
    });
});

describe('clipboardShortcut', () => {
    const ev = (key: string, target: Element, over: Partial<KeyboardEvent> = {}) =>
        ({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, target, ...over }) as unknown as React.KeyboardEvent;
    it('maps Ctrl/Cmd+C, V and D and ignores text fields', () => {
        const div = document.createElement('div');
        expect(clipboardShortcut(ev('c', div))).toBe('copy');
        expect(clipboardShortcut(ev('V', div, { ctrlKey: false, metaKey: true }))).toBe('paste');
        expect(clipboardShortcut(ev('d', div))).toBe('duplicate');
        expect(clipboardShortcut(ev('a', div))).toBeNull();
        expect(clipboardShortcut(ev('c', div, { altKey: true }))).toBeNull();
        expect(clipboardShortcut(ev('c', document.createElement('input')))).toBeNull();
        expect(clipboardShortcut(ev('v', document.createElement('textarea')))).toBeNull();
        const ce = document.createElement('div');
        ce.contentEditable = 'true';
        Object.defineProperty(ce, 'isContentEditable', { value: true });
        expect(clipboardShortcut(ev('d', ce))).toBeNull();
    });
});
