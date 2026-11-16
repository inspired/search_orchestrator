/* Draws one node of the editor canvas: its family shape, a coloured stripe on the left clipped to
 * the shape, an icon, a label and a detail line; and the round handles for its ports. */
import React from 'react';
import Bell from '@splunk/react-icons/Bell';
import Briefcase from '@splunk/react-icons/Briefcase';
import Clock from '@splunk/react-icons/Clock';
import Cylinder from '@splunk/react-icons/Cylinder';
import Diamond from '@splunk/react-icons/Diamond';
import Filter from '@splunk/react-icons/Filter';
import Magnifier from '@splunk/react-icons/Magnifier';
import ArrowRight from '@splunk/react-icons/ArrowRight';
import type { Theme } from './GraphView';
import type { FlowNode, PortId } from './nodeModel';
import { FAMILY_OF, FAMILY_STYLE, Family, PORT_STYLE, nodeSize, shapePath } from './nodeStyle';

type Icon = React.ComponentType<React.SVGProps<SVGSVGElement> & { 'aria-hidden'?: boolean }>;
const ICON: Record<Family, Icon> = {
    trigger: Clock,
    search: Magnifier,
    transform: Filter,
    condition: Diamond,
    notify: Bell,
    write: Cylinder,
    chain: ArrowRight,
    job: Briefcase,
};

const STRIPE = 4;
const ICON_SIZE = 16;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);

export interface NodeShapeProps {
    node: FlowNode;
    theme: Theme;
    selected?: boolean;
    stroke?: string;
    /** Replaces the detail line, for example a run status. */
    status?: React.ReactNode;
    /** Drawn before the status text, in a 24×24 viewBox (for example a react-icons element). */
    statusIcon?: React.ReactNode;
    /** Colour of the status text and icon. */
    statusColor?: string;
}

export function NodeShape({ node, theme, selected = false, stroke, status, statusIcon, statusColor }: NodeShapeProps) {
    const family = FAMILY_OF[node.kind];
    const { shape, colorToken } = FAMILY_STYLE[family];
    const color = theme[colorToken];
    const { w, h } = nodeSize(node.kind);
    const d = shapePath(shape, w, h);
    const Glyph = ICON[family];
    const clipId = `so-clip-${node.key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
    const outline = selected ? theme.focusColor : stroke || theme.borderColorStrong;
    const outlineWidth = selected ? 2.5 : 1.5;
    const inset = shape === 'stadium' || shape === 'parallelogram' ? 22 : 14;
    const textX = inset + ICON_SIZE + 6;
    const chars = Math.max(6, Math.floor((w - textX - 26) / 6.5));
    const diamond = shape === 'diamond';
    const detailFill = (status != null && statusColor) || theme.contentColorMuted;
    const withIcon = status != null && statusIcon != null && !diamond;

    return (
        <>
            <title>{`${node.label}${node.detail ? `: ${node.detail}` : ''}`}</title>
            <defs>
                <clipPath id={clipId}>
                    <path d={d} />
                </clipPath>
            </defs>
            <path d={d} fill={theme.backgroundColorSection} stroke={outline} strokeWidth={outlineWidth} />
            {shape === 'double' && (
                <path
                    d={shapePath('rounded', w - 8, h - 8)}
                    transform="translate(4,4)"
                    fill="none"
                    stroke={selected ? theme.focusColor : theme.borderColorStrong}
                    strokeWidth={1}
                />
            )}
            <g clipPath={`url(#${clipId})`}>
                <rect data-testid="node-stripe" x={0} y={0} width={STRIPE} height={h} fill={color} />
                {node.kind === 'saved_search' && <rect data-testid="node-stripe-inner" x={STRIPE + 2} y={0} width={2} height={h} fill={color} />}
            </g>
            <svg x={diamond ? (w - ICON_SIZE) / 2 : inset} y={(h - ICON_SIZE) / 2} width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" style={{ color }}>
                <Glyph aria-hidden width={24} height={24} />
            </svg>
            {diamond ? (
                <>
                    <text x={w / 2} y={h + 14} textAnchor="middle" fontSize={12} fill={theme.contentColorDefault} fontFamily={theme.fontFamily} fontWeight={theme.fontWeightSemiBold}>
                        {node.label}
                    </text>
                    <text x={w / 2} y={h + 28} textAnchor="middle" fontSize={11} fill={detailFill} fontFamily={theme.fontFamily}>
                        {status ?? clip(node.detail, 28)}
                    </text>
                </>
            ) : (
                <>
                    <text x={textX} y={h / 2 - 3} fontSize={13} fill={theme.contentColorDefault} fontFamily={theme.fontFamily} fontWeight={theme.fontWeightSemiBold}>
                        {clip(node.label, chars)}
                    </text>
                    {withIcon && (
                        <svg x={textX} y={h / 2 + 3} width={12} height={12} viewBox="0 0 24 24" style={{ color: detailFill }}>
                            {statusIcon}
                        </svg>
                    )}
                    <text x={withIcon ? textX + 16 : textX} y={h / 2 + 13} fontSize={11} fill={detailFill} fontFamily={theme.fontFamily}>
                        {status ?? clip(node.detail, chars)}
                    </text>
                </>
            )}
        </>
    );
}

export interface PortHandleProps {
    port: PortId;
    x: number;
    y: number;
    theme: Theme;
    connected: boolean;
}

export function PortHandle({ port, x, y, theme, connected }: PortHandleProps) {
    const style = PORT_STYLE[port];
    const color = theme[style.colorToken];
    return (
        <g data-testid={`port-${port}`}>
            <title>{style.label}</title>
            <text x={x - 9} y={y + 3} textAnchor="end" fontSize={9} fill={color} fontFamily={theme.fontFamily} aria-hidden>
                {style.glyph}
            </text>
            <circle cx={x} cy={y} r={5} fill={connected ? color : theme.backgroundColorSection} stroke={color} strokeWidth={1.5} />
        </g>
    );
}
