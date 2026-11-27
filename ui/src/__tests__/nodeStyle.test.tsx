import React from 'react';
import { render, screen } from '@testing-library/react';
import type { FlowNode, NodeKind, PortId } from '../features/builder/nodeModel';
import { FAMILY_OF, FAMILY_STYLE, PORT_STYLE, HANDLE_R, handleOffset, hasHandle, inputOffset, nodeSize, shapePath, tabOffset } from '../features/builder/nodeStyle';
import { tabBox } from '../features/builder/PlusHandle';
import { NodeShape } from '../features/builder/NodeShape';

const theme: Record<string, string> = {
    categoricalA5Strong: '#a5a5a5',
    backgroundColorSection: '#111111',
    contentColorDefault: '#eeeeee',
    contentColorMuted: '#999999',
    borderColorStrong: '#555555',
    focusColor: '#00aaff',
    statusColorNormal: '#00ff00',
    fontFamily: 'sans-serif',
};

describe('nodeStyle', () => {
    it('maps kinds to families', () => {
        expect(FAMILY_OF.search).toBe('search');
        expect(FAMILY_OF.saved_search).toBe('search');
        expect(FAMILY_OF.previous).toBe('transform');
        expect(FAMILY_OF.summary_index).toBe('write');
        expect(FAMILY_OF.lookup).toBe('write');
        expect(FAMILY_OF.event).toBe('write');
        expect(FAMILY_OF.email).toBe('notify');
        expect(FAMILY_OF.alert_action).toBe('notify');
        expect(FAMILY_OF.alert_action).toBe('notify');
        expect(FAMILY_OF.start_job).toBe('chain');
        expect(FAMILY_OF.trigger_cron).toBe('trigger');
        expect(FAMILY_OF.trigger_completion).toBe('trigger');
        expect(FAMILY_OF.condition).toBe('condition');
        expect(FAMILY_OF.job).toBe('job');
    });
    it('styles families', () => {
        const pick = (f: keyof typeof FAMILY_STYLE) => [FAMILY_STYLE[f].shape, FAMILY_STYLE[f].colorToken];
        expect(pick('trigger')).toEqual(['stadium', 'categoricalA1Strong']);
        expect(pick('search')).toEqual(['rounded', 'categoricalA2Strong']);
        expect(pick('transform')).toEqual(['cut', 'categoricalA3Strong']);
        expect(pick('condition')).toEqual(['diamond', 'categoricalA4Strong']);
        expect(pick('notify')).toEqual(['flag', 'categoricalA5Strong']);
        expect(pick('write')).toEqual(['cylinder', 'categoricalA7Strong']);
        expect(pick('chain')).toEqual(['parallelogram', 'categoricalA6Strong']);
        expect(pick('job')).toEqual(['double', 'borderColorStrong']);
    });
    it('styles ports', () => {
        const glyphs = (['success', 'failure', 'always', 'start', 'delayed', 'if', 'then'] as PortId[]).map((p) => PORT_STYLE[p].glyph);
        expect(glyphs).toEqual(['✓', '✗', '∞', '▶', '⏱', '◇', '→']);
        expect(Object.values(PORT_STYLE).map((p) => p.label)).toEqual(['Succeeded', 'Failed', 'Finished either way', 'Started', 'Delayed', 'Late', 'If…', 'Then', 'Asks for approval']);
        expect(PORT_STYLE.late.glyph).toBe('⌛');
        expect(PORT_STYLE.late.colorToken).toBe('statusColorMedium');
        expect(PORT_STYLE.success.colorToken).toBe('statusColorNormal');
        expect(PORT_STYLE.failure.colorToken).toBe('statusColorHigh');
        expect(PORT_STYLE.delayed.colorToken).toBe('statusColorMedium');
        expect(PORT_STYLE.always.colorToken).toBe('contentColorMuted');
        expect(PORT_STYLE.then.colorToken).toBe('contentColorMuted');
    });
    it('draws closed paths', () => {
        (Object.keys(FAMILY_STYLE) as (keyof typeof FAMILY_STYLE)[]).forEach((f) => {
            const d = shapePath(FAMILY_STYLE[f].shape, 200, 56);
            expect(d.startsWith('M')).toBe(true);
            expect(d.trim().endsWith('Z')).toBe(true);
        });
    });
    it('places inputs', () => {
        expect(inputOffset('trigger_cron')).toBeNull();
        expect(inputOffset('trigger_completion')).toBeNull();
        expect(inputOffset('job')).toBeNull();
        const { h } = nodeSize('search');
        expect(inputOffset('search')).toEqual({ x: 0, y: h / 2 });
        const d = nodeSize('condition');
        expect(inputOffset('condition')).toEqual({ x: 0, y: d.h / 2 });
    });
    it('gives a + to steps, the whole job, conditions and triggers only', () => {
        const yes: NodeKind[] = ['search', 'saved_search', 'previous', 'summary_index', 'lookup', 'job', 'condition', 'trigger_cron', 'trigger_completion'];
        const no: NodeKind[] = ['email', 'event', 'alert_action', 'start_job'];
        yes.forEach((k) => expect(hasHandle(k)).toBe(true));
        no.forEach((k) => expect(hasHandle(k)).toBe(false));
    });
    it('renders a node with its family stripe', () => {
        const node: FlowNode = { key: 'action:job:0', kind: 'email', label: 'Email', detail: 'a@b.c' };
        const { container } = render(
            <svg>
                <NodeShape node={node} theme={theme} />
            </svg>
        );
        expect(screen.getByText('Email')).toBeInTheDocument();
        expect(container.querySelector('[data-testid="node-stripe"]')?.getAttribute('fill')).toBe('#a5a5a5');
    });
});

describe('handle and tab geometry', () => {
    it('puts the handle on the right edge at mid height', () => {
        const { w, h } = nodeSize('search');
        expect(handleOffset('search')).toEqual({ x: w, y: h / 2 });
        expect(HANDLE_R).toBe(13);
    });
    it('centres the tab column on the node middle, 22 px apart, tab centres on x = w + 11', () => {
        const { w, h } = nodeSize('search');
        expect(tabOffset('search', 0, 1)).toEqual({ x: w, y: h / 2 });
        const two = [0, 1].map((i) => tabOffset('search', i, 2));
        expect(two[0].y).toBe(h / 2 - 11);
        expect(two[1].y).toBe(h / 2 + 11);
        const three = [0, 1, 2].map((i) => tabOffset('search', i, 3));
        expect(three.map((p) => p.y - h / 2)).toEqual([-22, 0, 22]);
        expect(tabBox('search', 0, 1)).toEqual({ x: w + 2, y: h / 2 - 9, w: 18, h: 18 });
    });
    it('puts the + right of the tab column when tabs exist, on the edge otherwise', () => {
        const { w, h } = nodeSize('search');
        expect(handleOffset('search', false, 0)).toEqual({ x: w, y: h / 2 });
        expect(handleOffset('search', false, 3)).toEqual({ x: w + 22 + HANDLE_R, y: h / 2 });
        expect(handleOffset('condition', false, 0)).toEqual({ x: nodeSize('condition').w, y: nodeSize('condition').h / 2 });
    });
    it('with every outcome in use, the tabs stay symmetric about the middle and do not overlap', () => {
        (['search', 'previous', 'summary_index', 'job'] as const).forEach((kind) => {
            const { h } = nodeSize(kind);
            const count = kind === 'job' ? 5 : 6;
            const t = Array.from({ length: count }, (_, i) => tabOffset(kind, i, count));
            expect(new Set(t.map((p) => p.y)).size).toBe(count);
            expect(t[0].y - h / 2).toBeCloseTo(-(t[count - 1].y - h / 2));
        });
    });
    it('compact nodes are 140×32, except the diamond and the whole job', () => {
        (['search', 'saved_search', 'previous', 'summary_index', 'trigger_cron', 'email', 'start_job'] as const).forEach((k) => {
            expect(nodeSize(k, true)).toEqual({ w: 140, h: 32 });
        });
        expect(nodeSize('job', true)).toEqual({ w: 160, h: 32 });
        expect(nodeSize('condition', true)).toEqual(nodeSize('condition'));
        expect(nodeSize('search', false)).toEqual(nodeSize('search'));
    });
    it('handle, tabs and input follow the compact size', () => {
        expect(handleOffset('search', true)).toEqual({ x: 140, y: 16 });
        expect(tabOffset('search', 0, 1, true).x).toBe(140);
        expect(tabOffset('search', 0, 1, true).y).toBe(16);
        expect(handleOffset('search', true, 1)).toEqual({ x: 140 + 22 + HANDLE_R, y: 16 });
        expect(inputOffset('search', true)).toEqual({ x: 0, y: 16 });
    });
});
