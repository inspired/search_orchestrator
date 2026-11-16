import React from 'react';
import { render, screen } from '@testing-library/react';
import type { FlowNode, NodeKind, PortId } from '../features/builder/nodeModel';
import { FAMILY_OF, FAMILY_STYLE, PORT_STYLE, inputOffset, nodeSize, portOffset, shapePath } from '../features/builder/nodeStyle';
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
        expect(portOffset('condition', 'then', ['then'])).toEqual({ x: d.w, y: d.h / 2 });
        const vis: PortId[] = ['success', 'failure', 'if'];
        const ys = vis.map((p) => portOffset('search', p, vis).y);
        expect(ys[0]).toBeLessThan(ys[1]);
        expect(ys[1]).toBeLessThan(ys[2]);
        expect(ys[1] - ys[0]).toBeCloseTo(ys[2] - ys[1]);
        expect(portOffset('search', 'success', vis).x).toBe(w);
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
