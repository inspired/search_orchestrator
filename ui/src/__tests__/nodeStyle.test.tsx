import React from 'react';
import { render, screen } from '@testing-library/react';
import type { FlowNode, NodeKind, PortId } from '../features/builder/nodeModel';
import { FAMILY_OF, FAMILY_STYLE, PORT_STYLE, HANDLE_R, handleOffset, inputOffset, nodeSize, portOffset, shapePath, tabOffset } from '../features/builder/nodeStyle';
import { NodeShape, PortHandle } from '../features/builder/NodeShape';

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
    it('places ports and inputs', () => {
        expect(inputOffset('trigger_cron')).toBeNull();
        expect(inputOffset('trigger_completion')).toBeNull();
        expect(inputOffset('job')).toBeNull();
        const { w, h } = nodeSize('search');
        expect(inputOffset('search')).toEqual({ x: 0, y: h / 2 });
        const d = nodeSize('condition');
        expect(inputOffset('condition')).toEqual({ x: 0, y: d.h / 2 });
        expect(portOffset('condition', 'then')).toEqual({ x: d.w, y: d.h / 2 });
        const all: PortId[] = ['success', 'failure', 'always', 'start', 'delayed', 'if'];
        const ys = all.map((p) => portOffset('search', p).y);
        ys.slice(1).forEach((y, i) => expect(y).toBeGreaterThan(ys[i]));
        expect(ys[1] - ys[0]).toBeCloseTo(ys[5] - ys[4]);
        expect(portOffset('search', 'success').x).toBe(w);
    });
    it('keeps each port in its own slot whether or not the others are shown', () => {
        const { h } = nodeSize('search');
        // Six slots on a step: Succeeded first, If… last, never moved by hiding Started or Delayed.
        expect(portOffset('search', 'success').y).toBeCloseTo(h / 7);
        expect(portOffset('search', 'if').y).toBeCloseTo((6 * h) / 7);
        const job = nodeSize('job');
        expect(portOffset('job', 'delayed').y).toBeCloseTo((5 * job.h) / 6);
        const kinds: NodeKind[] = ['search', 'job'];
        kinds.forEach((k) => expect(nodeSize(k).w).toBeGreaterThan(0));
    });
    it('renders a node with its family stripe', () => {
        const node: FlowNode = { key: 'action:job:0', kind: 'email', label: 'Email', detail: 'a@b.c' };
        const { container } = render(
            <svg>
                <NodeShape node={node} theme={theme} />
                <PortHandle port="success" x={10} y={10} theme={theme} connected={false} />
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
});
