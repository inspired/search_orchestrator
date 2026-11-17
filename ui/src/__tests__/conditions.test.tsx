/* SPL conditions on lines (1.17.0): the Check with choice, labels, issues, run-graph line states. */
import React, { useReducer } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import type { Edge, JobDefinition, RunDetail, StepStatus } from '../api/types';
import EdgePanel from '../features/builder/EdgePanel';
import { conditionLabel } from '../features/builder/GraphView';
import { findIssues } from '../features/builder/graphLogic';
import { buildGraph, condKey } from '../features/builder/nodeModel';
import { flowLinkLabel } from '../features/builder/outcomes';
import { BuilderState, initialState, reducer } from '../features/builder/reducer';
import { availableTokens } from '../features/builder/tokens';
import { lineStates } from '../features/run/runFlow';
import StepDrawer from '../features/run/StepDrawer';
import { renderThemed } from './fixtures';

const job = (edge: Partial<Edge>): JobDefinition => ({
    name: 'j',
    enabled: true,
    steps: [
        { id: 'a', type: 'inline', spl: '| makeresults' },
        { id: 'b', type: 'inline', spl: '| makeresults' },
    ],
    edges: [{ from: 'a', to: 'b', condition: 'expression', expression: '', ...edge }],
});

describe('condition labels', () => {
    test('SPL conditions show where … and search …; simple ones their expression', () => {
        expect(conditionLabel({ from: 'a', to: 'b', condition: 'expression', expression: 'x > 1' })).toBe('if x > 1');
        expect(conditionLabel({ from: 'a', to: 'b', condition: 'expression', expression_kind: 'eval', expression: 'now() > 1' })).toBe('◇ where now() > 1');
        expect(conditionLabel({ from: 'a', to: 'b', condition: 'expression', expression_kind: 'search', expression: 'index=main' })).toBe('◇ search index=main');
    });
    test('the line out of the condition node is labelled with the short form', () => {
        const g = buildGraph(job({ expression_kind: 'search', expression: 'index=main error | stats count by host' }));
        const then = g.links.find((l) => l.port === 'then')!;
        expect(flowLinkLabel(g, then)).toMatch(/^◇ search index=main error/);
        const node = g.nodes.find((n) => n.key === condKey('a', 'b'))!;
        expect(node.detail).toMatch(/^search index=main/);
        const simple = buildGraph(job({ expression: '$a.resultCount$ > 0' }));
        expect(flowLinkLabel(simple, simple.links.find((l) => l.port === 'then')!)).toBe('$a.resultCount$ > 0');
    });
});

describe('findIssues for SPL conditions', () => {
    const codes = (j: JobDefinition) => findIssues(j).map((i) => i.code);
    test('empty text', () => {
        expect(codes(job({ expression_kind: 'eval', expression: ' ' }))).toContain('bad_expression');
        expect(codes(job({ expression_kind: 'search' }))).toContain('bad_expression');
    });
    test('writing commands and | orchestrate', () => {
        const found = findIssues(job({ expression_kind: 'search', expression: 'index=a | collect index=b' }));
        expect(found.map((i) => i.code)).toEqual(['condition_writes']);
        expect(found[0].message).toBe("dependency a->b: a condition only reads, so it can't use collect; move collect into a step and check that step's results here");
        expect(found[0].step).toBe('b');
        expect(codes(job({ expression_kind: 'search', expression: '| orchestrate start job=x' }))).toContain('condition_writes');
    });
    test('an SPL expression has no pipes', () => {
        expect(codes(job({ expression_kind: 'eval', expression: '1=1 | collect index=x' }))).toEqual(['bad_expression']);
        expect(codes(job({ expression_kind: 'eval', expression: 'x="a|b" OR 1=1' }))).toEqual([]);
    });
    test('valid conditions have no issues', () => {
        expect(codes(job({ expression_kind: 'eval', expression: 'now() > $run.now$' }))).toEqual([]);
    });
});

test('Insert value lists $run.now$', () => {
    const run = availableTokens(job({}), 'b', {})[0].options.map((o) => o.token);
    expect(run).toContain('$run.now$');
});

test('switching a line to on success drops the condition fields', () => {
    const start = initialState(job({ expression_kind: 'search', expression: 'index=a', earliest: '-1h', latest: 'now' }));
    const next = reducer(start, { type: 'updateEdge', from: 'a', to: 'b', changes: { condition: 'on_success' } });
    expect(next.job.edges).toEqual([{ from: 'a', to: 'b', condition: 'on_success' }]);
});

describe('EdgePanel Check with', () => {
    function Harness({ initial, onState }: { initial: JobDefinition; onState: (s: BuilderState) => void }) {
        const [state, dispatch] = useReducer(reducer, initial, initialState);
        onState(state);
        return (
            <EdgePanel
                job={state.job}
                from="a"
                to="b"
                issues={[]}
                dispatch={dispatch}
                scheduledTime={1762390800}
                resolveTimeRange={jest.fn().mockResolvedValue({ earliest: 1762300800, latest: 1762387200 })}
            />
        );
    }
    const renderPanel = (j: JobDefinition) => {
        let latest: BuilderState | null = null;
        renderThemed(<Harness initial={j} onState={(s) => (latest = s)} />);
        return () => (latest as unknown as BuilderState).job.edges![0];
    };
    beforeEach(() => window.localStorage.clear());

    test('a saved job without a kind shows Simple comparison and a plain field', () => {
        renderPanel(job({ expression: '$a.resultCount$ > 0' }));
        expect(screen.getByTestId('condition-kind')).toHaveTextContent('Simple comparison');
        expect(screen.queryByTestId('spl-highlight')).not.toBeInTheDocument();
    });

    test('SPL expression uses the SPL editor without pipe-newline', () => {
        const edge = renderPanel(job({ expression: '' }));
        fireEvent.click(screen.getByTestId('condition-kind'));
        fireEvent.click(screen.getByRole('option', { name: 'SPL expression' }));
        expect(edge().expression_kind).toBe('eval');
        expect(screen.getByTestId('spl-highlight')).toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: 'Put each | on a new line' })).not.toBeInTheDocument();
        const area = screen.getByRole('textbox', { name: 'SPL expression' }) as HTMLTextAreaElement;
        fireEvent.change(area, { target: { value: 'a' } });
        area.setSelectionRange(1, 1);
        fireEvent.keyDown(area, { key: '|' });
        expect(edge().expression).toBe('a');
        expect(screen.queryByRole('combobox', { name: 'Time range' })).not.toBeInTheDocument();
    });

    test('Search returns results has a time range defaulting to the 24 hours before, and pipe-newline', () => {
        const edge = renderPanel(job({ expression: '' }));
        fireEvent.click(screen.getByTestId('condition-kind'));
        fireEvent.click(screen.getByRole('option', { name: 'Search returns results' }));
        expect(edge()).toMatchObject({ expression_kind: 'search', earliest: '-24h', latest: 'now' });
        expect(screen.getByRole('combobox', { name: 'Time range' })).toHaveTextContent('The 24 hours before');
        expect(screen.getByRole('checkbox', { name: 'Put each | on a new line' })).toBeInTheDocument();
    });

    test('back to Simple comparison drops the time range', () => {
        const edge = renderPanel(job({ expression_kind: 'search', expression: 'index=a', earliest: '-24h', latest: 'now' }));
        fireEvent.click(screen.getByTestId('condition-kind'));
        fireEvent.click(screen.getByRole('option', { name: 'Simple comparison' }));
        expect(edge()).toEqual({ from: 'a', to: 'b', condition: 'expression', expression: 'index=a' });
    });
});

describe('run graph lines for SPL conditions', () => {
    const def = job({ expression_kind: 'eval', expression: '1=1' });
    const g = buildGraph(def);
    const ck = condKey('a', 'b');
    const ifKey = `step:a-if->${ck}`;
    const thenKey = `${ck}-then->step:b`;
    const st = (state: StepStatus['state'], more: Partial<StepStatus> = {}): StepStatus => ({ state, ...more });
    test('pending while the condition search runs', () => {
        const out = lineStates(def, { a: st('succeeded'), b: st('waiting') }, g, {}, { 'a>b': { state: 'running' } });
        expect(out[ifKey]).toBe('pending');
        expect(out[thenKey]).toBe('pending');
    });
    test('met fires (and flows into a running target)', () => {
        expect(lineStates(def, { a: st('succeeded'), b: st('ready') }, g, {}, { 'a>b': { state: 'met' } })[thenKey]).toBe('fired');
        expect(lineStates(def, { a: st('succeeded'), b: st('running') }, g, {}, { 'a>b': { state: 'met' } })[thenKey]).toBe('flowing');
    });
    test('not met and failed will not fire', () => {
        for (const state of ['not_met', 'failed'] as const) {
            const out = lineStates(def, { a: st('succeeded'), b: st('waiting') }, g, {}, { 'a>b': { state } });
            expect(out[thenKey]).toBe('wont');
        }
    });
});

test('the step drawer shows its conditions', () => {
    const def = { ...job({ expression_kind: 'search', expression: 'index=a' }), id: 'j' };
    const run = {
        id: 'r',
        definition: def,
        steps: { a: { state: 'succeeded' }, b: { state: 'skipped', skip_kind: 'not_taken' } },
        conditions: { 'a>b': { state: 'failed', error: 'condition search s1 failed: boom', sid: 's1' } },
    } as unknown as RunDetail;
    renderThemed(<StepDrawer run={run} stepId="b" now={0} onClose={() => undefined} />);
    expect(screen.getByText('Condition after a')).toBeInTheDocument();
    expect(screen.getByText(/Failed \(counts as not met\): condition search s1 failed: boom/)).toBeInTheDocument();
});

describe('review fixes', () => {
    test("a ' does not hide a pipe or a writing command", () => {
        const codes = (j: JobDefinition) => findIssues(j).map((i) => i.code);
        expect(codes(job({ expression_kind: 'eval', expression: "'a|b'=1" }))).toEqual(['bad_expression']);
        expect(codes(job({ expression_kind: 'search', expression: "index=main O'Brien | collect index=x" }))).toEqual(['condition_writes']);
    });
    test('a duplicate step pair with a condition is an error', () => {
        const j = job({ expression_kind: 'eval', expression: '1=1' });
        j.edges!.push({ from: 'a', to: 'b', condition: 'on_success' });
        const found = findIssues(j).filter((i) => i.code === 'duplicate_edge');
        expect(found).toHaveLength(1);
        expect(found[0].message).toBe('dependency a->b is listed more than once and has a condition; remove the extra line so only one connects these steps');
        expect(found[0].step).toBe('b');
        j.edges = [
            { from: 'a', to: 'b' },
            { from: 'a', to: 'b' },
        ];
        expect(findIssues(j).map((i) => i.code)).not.toContain('duplicate_edge');
    });
    test('an unchecked SPL condition will not fire once the run ended or the target was cancelled', () => {
        const def = job({ expression_kind: 'eval', expression: '1=1' });
        const g = buildGraph(def);
        const thenKey = `${condKey('a', 'b')}-then->step:b`;
        const a: StepStatus = { state: 'succeeded' };
        expect(lineStates(def, { a, b: { state: 'waiting' } }, g, {}, {})[thenKey]).toBe('pending');
        expect(lineStates(def, { a, b: { state: 'waiting' } }, g, {}, {}, true)[thenKey]).toBe('wont');
        expect(lineStates(def, { a, b: { state: 'cancelled' } }, g, {}, {})[thenKey]).toBe('wont');
        expect(lineStates(def, { a, b: { state: 'abandoned' } }, g, {}, { 'a>b': { state: 'running' } })[thenKey]).toBe('wont');
    });
});
