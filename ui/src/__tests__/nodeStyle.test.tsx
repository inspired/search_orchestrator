import React from 'react';
import { render, screen } from '@testing-library/react';
import type { FlowNode, NodeKind, PortId } from '../features/builder/nodeModel';
import { FAMILY_OF, FAMILY_STYLE, PORT_STYLE, HANDLE_R, handleOffset, hasHandle, inputOffset, nodeSize, shapePath, tabOffset } from '../features/builder/nodeStyle';
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
        expect(FAMILY_OF.webhook).toBe('notify');
        expect(FAMILY_OF.slack).toBe('notify');
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
        expect(Object.values(PORT_STYLE).map((p) => p.label)).toEqual(['Succeeded', 'Failed', 'Finished either way', 'Started', 'Delayed', 'If…', 'Then']);
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
    it('gives a + to steps, the whole job and conditions only', () => {
        const yes: NodeKind[] = ['search', 'saved_search', 'previous', 'summary_index', 'lookup', 'job', 'condition'];
        const no: NodeKind[] = ['trigger_cron', 'trigger_completion', 'email', 'webhook', 'slack', 'event', 'alert_action', 'start_job'];
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
    it('stacks tabs upward, 22 px apart, clear of the handle', () => {
        const h = handleOffset('search');
        const t = [0, 1, 2].map((i) => tabOffset('search', i, 3));
        expect(t[1].y - t[0].y).toBe(-22);
        expect(t[2].y - t[1].y).toBe(-22);
        t.forEach((p) => {
            expect(p.x).toBe(h.x);
            expect(h.y - p.y).toBeGreaterThan(HANDLE_R);
        });
    });
    it('with every outcome in use, tabs stay within one node height above the node, the rest stack below the +', () => {
        (['search', 'previous', 'summary_index', 'job'] as const).forEach((kind) => {
            const { h: height } = nodeSize(kind);
            const h = handleOffset(kind);
            const count = kind === 'job' ? 5 : 6;
            const t = Array.from({ length: count }, (_, i) => tabOffset(kind, i, count));
            t.forEach((p) => {
                // 9 px is half a tab's height.
                expect(p.y - 9).toBeGreaterThanOrEqual(-height);
                expect(Math.abs(p.y - h.y)).toBeGreaterThan(HANDLE_R);
            });
            expect(new Set(t.map((p) => p.y)).size).toBe(count);
            expect(t.some((p) => p.y > h.y)).toBe(true);
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
        expect(tabOffset('search', 0, 1, true).y).toBe(16 - HANDLE_R - 11);
        expect(inputOffset('search', true)).toEqual({ x: 0, y: 16 });
    });
});
