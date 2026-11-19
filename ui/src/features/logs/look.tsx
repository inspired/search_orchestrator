/* Shared look for the Troubleshooting page: tone colours (status tokens, always with an icon
 * and a word, never colour alone), category icons and time formats. */
import React from 'react';
import CheckCircle from '@splunk/react-icons/CheckCircle';
import Clock from '@splunk/react-icons/Clock';
import Cog from '@splunk/react-icons/Cog';
import Cylinder from '@splunk/react-icons/Cylinder';
import ExclamationCircle from '@splunk/react-icons/ExclamationCircle';
import ExclamationTriangle from '@splunk/react-icons/ExclamationTriangle';
import Filter from '@splunk/react-icons/Filter';
import LayersTriple from '@splunk/react-icons/LayersTriple';
import Magnifier from '@splunk/react-icons/Magnifier';
import Megaphone from '@splunk/react-icons/Megaphone';
import NodeConnection from '@splunk/react-icons/NodeConnection';
import Pulse from '@splunk/react-icons/Pulse';
import Shield from '@splunk/react-icons/Shield';
import ArrowClockwise from '@splunk/react-icons/ArrowClockwise';
import Tag from '@splunk/react-icons/Tag';
import type { Category, Tone } from './catalog';
import type { Theme } from './charts';

export function toneColor(t: Theme, tone: Tone): string {
    switch (tone) {
        case 'error':
            return t.statusColorHigh;
        case 'warning':
            return t.statusColorMedium;
        case 'ok':
            return t.statusColorNormal;
        case 'info':
            return t.statusColorInfo || t.contentColorActive;
        default:
            return t.contentColorMuted;
    }
}

export const TONE_WORD: Record<Tone, string> = { error: 'Error', warning: 'Warning', ok: 'OK', info: 'Info', muted: 'Detail' };

export function ToneIcon({ tone, size = 16 }: { tone: Tone; size?: number }) {
    const Icon = tone === 'error' ? ExclamationCircle : tone === 'warning' ? ExclamationTriangle : tone === 'ok' ? CheckCircle : null;
    if (!Icon) {
        return <span aria-hidden style={{ display: 'inline-block', width: size, textAlign: 'center' }}>•</span>;
    }
    return (
        <span role="img" aria-label={TONE_WORD[tone]} style={{ display: 'inline-flex' }}>
            <Icon width={size} height={size} />
        </span>
    );
}

const CATEGORY_ICON: Record<Category, React.ComponentType<{ width?: number | string; height?: number | string }>> = {
    run: Pulse,
    step: Magnifier,
    condition: Filter,
    action: Megaphone,
    approval: Shield,
    job: LayersTriple,
    engine: Cog,
    api: NodeConnection,
    splunk: Cylinder,
    backfill: ArrowClockwise,
    settings: Tag,
    other: Clock,
};

export function CategoryIcon({ category, size = 14 }: { category: Category; size?: number }) {
    const Icon = CATEGORY_ICON[category] || Clock;
    return <Icon width={size} height={size} />;
}

function toDate(iso?: string): Date | null {
    if (!iso) {
        return null;
    }
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** "13:46:17", or "18 Nov 13:46:17" when not today. */
export function lineTime(iso?: string, now: Date = new Date()): string {
    const d = toDate(iso);
    if (!d) {
        return iso || '';
    }
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

export function epoch(iso?: string): number | null {
    const d = toDate(iso);
    return d ? d.getTime() / 1000 : null;
}

/** "2m 10s", "45s", "1h 3m". */
export function span(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) {
        return `${s}s`;
    }
    if (s < 3600) {
        return `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`;
    }
    const m = Math.floor((s % 3600) / 60);
    return `${Math.floor(s / 3600)}h${m ? ` ${m}m` : ''}`;
}

export function ago(seconds: number): string {
    return seconds < 5 ? 'just now' : `${span(seconds)} ago`;
}
