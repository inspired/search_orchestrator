/* Shared formatting for times, durations and lists in user-facing copy. */

/** An epoch-seconds time in the viewer's locale and time zone. */
export function formatTime(epoch: number | null | undefined): string {
    if (epoch === null || epoch === undefined) {
        return '';
    }
    return new Date(epoch * 1000).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/** A compact duration: "42s", "3m 10s", "1h 5m", "2d 3h". */
export function formatDuration(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60) {
        return `${s}s`;
    }
    if (s < 3600) {
        return `${Math.floor(s / 60)}m ${s % 60}s`;
    }
    if (s < 86400) {
        return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    }
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function unit(seconds: number): { n: number; name: string } {
    const minutes = Math.floor(seconds / 60);
    if (minutes >= 120 && minutes % 60 === 0) {
        return { n: minutes / 60, name: 'hour' };
    }
    if (minutes >= 48 * 60) {
        return { n: Math.floor(minutes / 60), name: 'hour' };
    }
    return { n: minutes, name: 'minute' };
}

/** A span as a noun phrase: "42 minutes", "1 minute", "3 hours", "less than a minute". */
export function formatSpan(seconds: number): string {
    if (seconds < 60) {
        return 'less than a minute';
    }
    const { n, name } = unit(seconds);
    return `${n} ${name}${n === 1 ? '' : 's'}`;
}

/** A span used as an adjective: "60 minute", "2 hour". */
export function formatSpanAdjective(seconds: number): string {
    const { n, name } = unit(Math.max(seconds, 60));
    return `${n} ${name}`;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
    if (names.length <= 1) {
        return names.join('');
    }
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
