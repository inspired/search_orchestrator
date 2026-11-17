/* Draws one node of the editor canvas: its family shape, a coloured stripe on the left clipped to
 * the shape, an icon, a label and a detail line. The + handle and outcome tabs are PlusHandle.tsx. */
import React from 'react';
import Bell from '@splunk/react-icons/Bell';
import BalloonsChat from '@splunk/react-icons/BalloonsChat';
import Briefcase from '@splunk/react-icons/Briefcase';
import Clipboard from '@splunk/react-icons/Clipboard';
import Clock from '@splunk/react-icons/Clock';
import Cylinder from '@splunk/react-icons/Cylinder';
import Diamond from '@splunk/react-icons/Diamond';
import Filter from '@splunk/react-icons/Filter';
import Magnifier from '@splunk/react-icons/Magnifier';
import MobilePhone from '@splunk/react-icons/MobilePhone';
import ArrowRight from '@splunk/react-icons/ArrowRight';
import type { Theme } from './GraphView';
import type { FlowNode, NodeKind } from './nodeModel';
import { FAMILY_OF, FAMILY_STYLE, Family, nodeSize, shapePath } from './nodeStyle';

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
/** Kinds with an icon of their own instead of their family's. */
const KIND_ICON: Partial<Record<NodeKind, Icon>> = {
    teams: BalloonsChat,
    pagerduty: MobilePhone,
    servicenow: Clipboard,
};

const STRIPE = 4;
const ICON_SIZE = 16;
const BAR_PAD = 14;
const BAR_H = 3;

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
    /** Marks the status text as the preview of this step (test id `preview-text-<id>`). */
    previewId?: string;
    /** A 3 px bar under the text, this fraction (0 to 1) of the node's inner width, in the family colour. */
    bar?: number;
    /** Icon and name only (see nodeSize); the diamond is drawn as ever. */
    compact?: boolean;
}

export function NodeShape({ node, theme, selected = false, stroke, status, statusIcon, statusColor, previewId, bar, compact = false }: NodeShapeProps) {
    const family = FAMILY_OF[node.kind];
    const { shape, colorToken } = FAMILY_STYLE[family];
    const color = theme[colorToken];
    const { w, h } = nodeSize(node.kind, compact);
    const d = shapePath(shape, w, h);
    const Glyph = KIND_ICON[node.kind] || ICON[family];
    // Compact and full drawings of one node can be on screen together: their ids differ.
    const clipId = `so-clip-${node.key.replace(/[^A-Za-z0-9_-]/g, '_')}${compact ? '-c' : ''}`;
    const outline = selected ? theme.focusColor : stroke || theme.borderColorStrong;
    const outlineWidth = selected ? 2.5 : 1.5;
    const inset = shape === 'stadium' || shape === 'parallelogram' ? 22 : 14;
    const textX = inset + ICON_SIZE + 6;
    const chars = Math.max(6, Math.floor((w - textX - 26) / 6.5));
    const diamond = shape === 'diamond';
    const small = compact && !diamond;
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
            ) : small ? (
                <text x={textX} y={h / 2 + 4} fontSize={13} fill={theme.contentColorDefault} fontFamily={theme.fontFamily} fontWeight={theme.fontWeightSemiBold}>
                    {clip(node.label, Math.max(6, Math.floor((w - textX - 12) / 6.5)))}
                </text>
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
                    {/* A nested svg clips a long status (a preview error) to the node. */}
                    <svg x={withIcon ? textX + 16 : textX} y={h / 2 + 2} width={Math.max(10, w - (withIcon ? textX + 16 : textX) - 12)} height={14}>
                        <text data-testid={previewId ? `preview-text-${previewId}` : undefined} x={0} y={11} fontSize={11} fill={detailFill} fontFamily={theme.fontFamily}>
                            {status ?? clip(node.detail, chars)}
                        </text>
                    </svg>
                    {bar !== undefined && bar > 0 && (
                        <rect
                            data-testid={previewId ? `preview-bar-${previewId}` : undefined}
                            x={BAR_PAD}
                            y={h - BAR_H - 7}
                            width={bar * (w - 2 * BAR_PAD)}
                            height={BAR_H}
                            rx={1.5}
                            fill={color}
                        />
                    )}
                </>
            )}
        </>
    );
}
