import type { JobDefinition } from '../api/types';
import { toDefinition } from '../api/client';
import { buildGraph } from '../features/builder/nodeModel';
import type { Positions } from '../features/builder/graphLogic';
import { tidyJob, withNodes } from '../features/builder/flowEdits';
import { layoutFlow } from '../features/builder/flowLayout';
import { GROUP_COLORS, Group, collapsedEnd, groupAround, hiddenMembers, membersOf, nextGroupId, readGroups } from '../features/builder/groups';
import { initialState, reducer } from '../features/builder/reducer';
import { copySelection } from '../features/builder/clipboard';

const job: JobDefinition = {
    name: 'g',
    enabled: true,
    steps: [
        { id: 'a', type: 'inline', spl: 'search a' },
        { id: 'b', type: 'inline', spl: 'search b' },
        { id: 'c', type: 'inline', spl: 'search c' },
    ],
    edges: [
        { from: 'a', to: 'b', condition: 'on_success' },
        { from: 'b', to: 'c', condition: 'on_success' },
    ],
};
const graph = buildGraph(job);
// Search steps are 200 × 76.
const pos: Positions = { job: { x: 0, y: 400 }, 'step:a': { x: 100, y: 100 }, 'step:b': { x: 400, y: 100 }, 'step:c': { x: 700, y: 100 } };
const group = (over: Partial<Group> = {}): Group => ({ id: 'g1', title: 'Group', color: 'categoricalA2', x: 50, y: 50, w: 600, h: 200, ...over });
const withLayout = (groups: unknown, nodes: Positions = pos): JobDefinition => ({ ...job, layout: { nodes, groups } as JobDefinition['layout'] });

describe('groups: pure helpers', () => {
    test('seven named colours, categoricalA1 to A7', () => {
        expect(GROUP_COLORS.map((c) => c.label)).toEqual(['Purple', 'Blue', 'Teal', 'Amber', 'Pink', 'Slate', 'Orange']);
        expect(GROUP_COLORS.map((c) => c.token)).toEqual(['categoricalA1', 'categoricalA2', 'categoricalA3', 'categoricalA4', 'categoricalA5', 'categoricalA6', 'categoricalA7']);
    });

    test('membersOf: nodes whose boxes are fully inside the frame', () => {
        expect(membersOf(group(), graph, pos)).toEqual(['step:a', 'step:b']);
        // b sticks out on the right by 10 px.
        expect(membersOf(group({ w: 540 }), graph, pos)).toEqual(['step:a']);
        expect(membersOf(group({ x: 2000 }), graph, pos)).toEqual([]);
    });

    test('groupAround pads 24 px and leaves a 28 px title bar', () => {
        expect(groupAround(['step:a', 'step:b'], pos, graph)).toEqual({ x: 76, y: 48, w: 548, h: 76 + 48 + 28 });
        expect(groupAround(['step:a'], pos, graph, 10)).toEqual({ x: 90, y: 62, w: 220, h: 76 + 20 + 28 });
    });

    test('nextGroupId takes the first free gN', () => {
        expect(nextGroupId([])).toBe('g1');
        expect(nextGroupId([group({ id: 'g1' }), group({ id: 'g3' })])).toBe('g2');
    });

    test('readGroups keeps only well-formed groups from a hand-edited layout (never throws)', () => {
        const bad = [
            null,
            5,
            'x',
            { id: 'g2' },
            group({ id: 'g3', x: Number.NaN }),
            group({ id: 'g4', w: -1 }),
            group({ id: 'g5', color: 'red' as Group['color'] }),
            { ...group({ id: 'g6' }), title: 7 },
            group({ id: 'g7', x: 5e6 }),
            group({ id: 'ok' }),
        ];
        expect(readGroups(withLayout(bad)).map((g) => g.id)).toEqual(['ok']);
        expect(readGroups(withLayout('nope'))).toEqual([]);
        expect(readGroups(job)).toEqual([]);
        expect(readGroups({ ...job, layout: 'x' as unknown as JobDefinition['layout'] })).toEqual([]);
    });

    test('hiddenMembers: members of collapsed groups only, unless every group is drawn expanded', () => {
        const groups = [group({ collapsed: true }), group({ id: 'g2', x: 650, w: 300 })];
        expect(hiddenMembers(groups, graph, pos)).toEqual({ 'step:a': 'g1', 'step:b': 'g1' });
        expect(hiddenMembers(groups, graph, pos, true)).toEqual({});
    });

    test('collapsedEnd: lines leave the block on its right and enter on its left, at the middle', () => {
        const g = group();
        expect(collapsedEnd(g, 'from')).toEqual({ x: 250, y: 78 });
        expect(collapsedEnd(g, 'to')).toEqual({ x: 50, y: 78 });
    });
});

describe('groups: layout is kept when it holds groups', () => {
    test('withNodes with no nodes keeps layout.groups and drops only nodes', () => {
        const j = withNodes(withLayout([group()]), {});
        expect(j.layout).toEqual({ groups: [group()] });
        expect(withNodes(withLayout(undefined, pos), {}).layout).toBeUndefined();
    });

    test('Tidy up (all) forgets positions but keeps groups', () => {
        const j = tidyJob(withLayout([group()]));
        expect(j && j.layout).toEqual({ groups: [group()] });
    });
});

describe('groups: reducer', () => {
    const start = () => initialState(withLayout(undefined));

    test('addGroup, then removeGroup: back to a layout without groups; each one undo step', () => {
        let s = reducer(start(), { type: 'addGroup', group: group() });
        expect(s.job.layout && s.job.layout.groups).toEqual([group()]);
        s = reducer(s, { type: 'removeGroup', id: 'g1' });
        expect(s.job.layout).toEqual({ nodes: pos });
        s = reducer(s, { type: 'undo' });
        expect(s.job.layout && s.job.layout.groups).toEqual([group()]);
    });

    test('addGroup on a job without layout, then removing it: no layout at all', () => {
        let s = initialState(job);
        s = reducer(s, { type: 'addGroup', group: group() });
        expect(s.job.layout).toEqual({ groups: [group()] });
        expect(toDefinition(s.job).layout).toEqual({ groups: [group()] });
        s = reducer(s, { type: 'removeGroup', id: 'g1' });
        expect('layout' in s.job).toBe(false);
    });

    test('moveGroup moves the frame and its members as one undo step', () => {
        let s = reducer(start(), { type: 'addGroup', group: group() });
        s = reducer(s, { type: 'moveGroup', id: 'g1', dx: 30, dy: -20, members: ['step:a', 'step:b'] });
        const l = s.job.layout!;
        expect(l.groups![0]).toMatchObject({ x: 80, y: 30, w: 600, h: 200 });
        expect(l.nodes!['step:a']).toEqual({ x: 130, y: 80 });
        expect(l.nodes!['step:b']).toEqual({ x: 430, y: 80 });
        expect(l.nodes!['step:c']).toEqual({ x: 700, y: 100 });
        s = reducer(s, { type: 'undo' });
        expect(s.job.layout!.groups![0]).toMatchObject({ x: 50, y: 50 });
        expect(s.job.layout!.nodes!['step:a']).toEqual({ x: 100, y: 100 });
    });

    test('updateGroup: title, colour, size and collapse; typing the title is one undo step', () => {
        let s = reducer(start(), { type: 'addGroup', group: group() });
        s = reducer(s, { type: 'updateGroup', id: 'g1', changes: { title: 'Da' } });
        s = reducer(s, { type: 'updateGroup', id: 'g1', changes: { title: 'Daily' } });
        expect(s.job.layout!.groups![0].title).toBe('Daily');
        s = reducer(s, { type: 'undo' });
        expect(s.job.layout!.groups![0].title).toBe('Group');
        s = reducer(s, { type: 'updateGroup', id: 'g1', changes: { color: 'categoricalA5', w: 300, h: 150 } });
        expect(s.job.layout!.groups![0]).toMatchObject({ color: 'categoricalA5', w: 300, h: 150 });
        s = reducer(s, { type: 'updateGroup', id: 'g1', changes: { collapsed: true } });
        expect(s.job.layout!.groups![0].collapsed).toBe(true);
        s = reducer(s, { type: 'updateGroup', id: 'g1', changes: { collapsed: false } });
        expect('collapsed' in s.job.layout!.groups![0]).toBe(false);
        // A bad colour or a size below the minimum is not stored.
        s = reducer(s, { type: 'updateGroup', id: 'g1', changes: { color: 'red' as Group['color'], w: -5 } });
        expect(s.job.layout!.groups![0]).toMatchObject({ color: 'categoricalA5', w: 300 });
    });

    test('two resizes are two undo steps; collapse then expand undoes back to collapsed', () => {
        let s = reducer(start(), { type: 'addGroup', group: group() });
        s = reducer(s, { type: 'updateGroup', id: 'g1', changes: { w: 400, h: 150 } });
        s = reducer(s, { type: 'updateGroup', id: 'g1', changes: { w: 300, h: 120 } });
        s = reducer(s, { type: 'undo' });
        expect(s.job.layout!.groups![0]).toMatchObject({ w: 400, h: 150 });
        s = reducer(s, { type: 'undo' });
        expect(s.job.layout!.groups![0]).toMatchObject({ w: 600, h: 200 });
        s = reducer(s, { type: 'updateGroup', id: 'g1', changes: { collapsed: true } });
        s = reducer(s, { type: 'updateGroup', id: 'g1', changes: { collapsed: false } });
        expect(s.job.layout!.groups![0].collapsed).toBeUndefined();
        s = reducer(s, { type: 'undo' });
        expect(s.job.layout!.groups![0].collapsed).toBe(true);
    });

    test('a move that would take the frame past ±1 000 000 moves nothing', () => {
        const s0 = reducer(start(), { type: 'addGroup', group: group({ x: 999_990 }) });
        const s1 = reducer(s0, { type: 'moveGroup', id: 'g1', dx: 20, dy: 0, members: ['step:a'] });
        expect(s1).toBe(s0);
    });

    test('removing every member leaves the group, harmless and with no members', () => {
        let s = reducer(start(), { type: 'addGroup', group: group() });
        s = reducer(s, { type: 'removeNodes', keys: ['step:a', 'step:b'] });
        expect(s.job.layout!.groups).toEqual([group()]);
        expect(membersOf(group(), buildGraph(s.job), { job: { x: 0, y: 400 }, 'step:c': { x: 700, y: 100 } })).toEqual([]);
    });

    test('removing the last positioned node keeps a layout that holds groups', () => {
        let s = initialState(withLayout([group()], { 'step:a': { x: 100, y: 100 } }));
        s = reducer(s, { type: 'removeNodes', keys: ['step:a'] });
        expect(s.job.layout).toEqual({ groups: [group()] });
    });

    test('a job with only groups in its layout loads and edits without errors', () => {
        let s = initialState({ ...job, layout: { groups: [group()] } });
        s = reducer(s, { type: 'moveAction', scope: 'job', index: 0, toScope: 'a', hook: 'on_success' });
        s = reducer(s, { type: 'moveNodes', positions: { 'step:a': { x: 1, y: 2 } } });
        expect(s.job.layout).toEqual({ groups: [group()], nodes: { 'step:a': { x: 1, y: 2 } } });
    });
});

describe('groups: final review fixes', () => {
    test('making a group saves the shown positions, so adding a node elsewhere keeps its members', () => {
        const shown = layoutFlow(graph, undefined);
        const frame = groupAround(['step:a', 'step:b'], shown, graph);
        let s = reducer(initialState(job), { type: 'addGroup', group: group(frame), shown });
        expect(s.job.layout!.nodes).toEqual(shown);
        expect(s.past.length).toBe(1);
        s = reducer(s, { type: 'addNode', kind: 'search', from: { key: 'step:c', port: 'success' } });
        const g2 = buildGraph(s.job);
        expect(membersOf(s.job.layout!.groups![0], g2, layoutFlow(g2, s.job.layout!.nodes))).toEqual(['step:a', 'step:b']);
        s = reducer(reducer(s, { type: 'undo' }), { type: 'undo' });
        expect('layout' in s.job).toBe(false);
    });

    test('membership always uses full node sizes, whatever the compact setting', () => {
        // A 200 × 76 search step at 100,100: a frame that only fits the 140 × 32 compact box.
        const tight = group({ x: 90, y: 90, w: 160, h: 50 });
        expect(membersOf(tight, graph, pos)).toEqual([]);
        expect(hiddenMembers([{ ...tight, collapsed: true }], graph, pos)).toEqual({});
        expect(groupAround(['step:a'], pos, graph)).toEqual({ x: 76, y: 48, w: 248, h: 76 + 48 + 28 });
    });

    test('a broken group in a hand-edited layout is dropped on the first layout write', () => {
        const bad = { id: 'bad', title: 7 };
        const s = reducer(initialState(withLayout([group(), bad])), { type: 'moveNodes', positions: { 'step:a': { x: 1, y: 2 } } });
        expect(s.job.layout!.groups).toEqual([group()]);
        const only = reducer(initialState(withLayout([bad])), { type: 'moveNodes', positions: { 'step:a': { x: 1, y: 2 } } });
        expect(only.job.layout).toEqual({ nodes: { ...pos, 'step:a': { x: 1, y: 2 } } });
        expect(withNodes(withLayout([bad]), {}).layout).toBeUndefined();
    });
});

describe('groups: a node placed inside a collapsed frame expands the group', () => {
    const collapsed = () => initialState(withLayout([group({ collapsed: true })]));
    const isCollapsed = (s: ReturnType<typeof collapsed>) => Boolean(s.job.layout!.groups![0].collapsed);

    test('dropping a node inside expands it in the same undo step', () => {
        const s = reducer(collapsed(), { type: 'moveNodes', positions: { ...pos, 'step:c': { x: 420, y: 160 } } });
        expect(isCollapsed(s)).toBe(false);
        expect(s.job.layout!.nodes!['step:c']).toEqual({ x: 420, y: 160 });
        const back = reducer(s, { type: 'undo' });
        expect(isCollapsed(back)).toBe(true);
        expect(back.job.layout!.nodes!['step:c']).toEqual({ x: 700, y: 100 });
    });

    test('saving where hidden members already are, or a drop outside, leaves it collapsed', () => {
        expect(isCollapsed(reducer(collapsed(), { type: 'moveNodes', positions: { ...pos, 'step:c': { x: 900, y: 100 } } }))).toBe(true);
    });

    test('adding a node at a point inside expands it', () => {
        const s = reducer(collapsed(), { type: 'addNode', kind: 'search', at: { x: 300, y: 150 }, shown: pos });
        expect(isCollapsed(s)).toBe(false);
        expect(s.past.length).toBe(1);
        expect(isCollapsed(reducer(collapsed(), { type: 'addNode', kind: 'search', at: { x: 1300, y: 150 }, shown: pos }))).toBe(true);
    });

    test('pasting (and so duplicating) inside expands it', () => {
        const clip = copySelection(job, ['step:c'], pos);
        const s = reducer(collapsed(), { type: 'paste', clip, at: { x: 300, y: 150 } });
        expect(isCollapsed(s)).toBe(false);
        expect(s.past.length).toBe(1);
    });
});
