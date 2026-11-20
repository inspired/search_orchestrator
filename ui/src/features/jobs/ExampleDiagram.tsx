/* A read-only picture of an example job's flow, drawn like the builder's canvas: every trigger,
 * step, condition and action node in its shape and colour, at its saved position, with the
 * lines between them coloured by outcome. Scales to the width it is given. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import type { JobDefinition } from '../../api/types';
import { layoutFlow } from '../builder/flowLayout';
import { buildGraph } from '../builder/nodeModel';
import { FAMILY_OF, FAMILY_STYLE, PORT_STYLE, nodeSize, shapePath } from '../builder/nodeStyle';

const PAD = 16;

function clip(text: string, w: number): string {
    const max = Math.max(4, Math.floor(w / 8.5));
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export default function ExampleDiagram({ job, height = 160, title }: { job: JobDefinition; height?: number; title: string }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const graph = buildGraph(job);
    const saved = ((job as unknown as { layout?: { nodes?: Record<string, unknown> } }).layout || {}).nodes;
    const pos = layoutFlow(graph, saved);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    graph.nodes.forEach((n) => {
        const p = pos[n.key];
        const { w, h } = nodeSize(n.kind);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + w);
        maxY = Math.max(maxY, p.y + h);
    });
    if (!graph.nodes.length) {
        return null;
    }
    const vb = `${minX - PAD} ${minY - PAD} ${maxX - minX + PAD * 2} ${maxY - minY + PAD * 2}`;
    const center = (key: string) => {
        const n = graph.nodes.find((x) => x.key === key);
        const p = pos[key];
        const { w, h } = nodeSize(n ? n.kind : 'search');
        return { x: p.x, y: p.y, w, h };
    };
    return (
        <svg role="img" aria-label={`Diagram of ${title}: ${graph.nodes.map((n) => n.label).join(', ')}`} data-testid="example-diagram" viewBox={vb} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: `${height}px`, display: 'block', background: theme.backgroundColorPage || theme.backgroundColor, borderRadius: '4px', border: `1px solid ${theme.borderColor}` }}>
            {graph.links.map((l) => {
                if (!pos[l.from] || !pos[l.to]) {
                    return null;
                }
                const a = center(l.from);
                const b = center(l.to);
                const x1 = a.x + a.w;
                const y1 = a.y + a.h / 2;
                const x2 = b.x;
                const y2 = b.y + b.h / 2;
                const bend = Math.max(40, Math.abs(x2 - x1) / 2);
                const color = l.port ? theme[PORT_STYLE[l.port].colorToken] || theme.contentColorMuted : theme.contentColorMuted;
                return <path key={l.key} d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`} fill="none" stroke={color} strokeWidth={3} strokeDasharray={l.kind === 'action' ? '8 6' : undefined} opacity={0.85} />;
            })}
            {graph.nodes.map((n) => {
                const p = pos[n.key];
                const { w, h } = nodeSize(n.kind);
                const style = FAMILY_STYLE[FAMILY_OF[n.kind]];
                const color = theme[style.colorToken] || theme.borderColorStrong;
                const diamond = style.shape === 'diamond';
                return (
                    <g key={n.key} transform={`translate(${p.x},${p.y})`}>
                        <path d={shapePath(style.shape, w, h)} fill={theme.backgroundColor} stroke={color} strokeWidth={3} />
                        {!diamond && (
                            <text x={w / 2} y={h / 2 + 6} textAnchor="middle" fontSize={17} fill={theme.contentColorDefault}>
                                {clip(n.label, w)}
                            </text>
                        )}
                        {diamond && (
                            <text x={w / 2} y={h / 2 + 7} textAnchor="middle" fontSize={20} fill={color}>
                                ?
                            </text>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}
