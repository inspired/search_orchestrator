/* Durations are stored in seconds. The builder shows them as an amount and a unit. */
export type DurationUnit = 'minutes' | 'hours' | 'days';

const UNIT_SECONDS: Record<DurationUnit, number> = { minutes: 60, hours: 3600, days: 86400 };

export const DURATION_UNITS: DurationUnit[] = ['minutes', 'hours', 'days'];

export function toSeconds(amount: number, unit: DurationUnit): number {
    return amount * UNIT_SECONDS[unit];
}

/** The largest unit that divides the seconds exactly (90 minutes stays 90 minutes, not 1.5 hours).
 * Seconds that are not whole minutes are rounded to minutes and flagged `exact: false`. */
export function splitDuration(seconds: number): { amount: number; unit: DurationUnit; exact?: boolean } {
    if (seconds % 60 !== 0) {
        return { amount: Math.round(seconds / 60), unit: 'minutes', exact: false };
    }
    if (seconds >= 86400 && seconds % 86400 === 0) {
        return { amount: seconds / 86400, unit: 'days' };
    }
    if (seconds >= 3600 && seconds % 3600 === 0) {
        return { amount: seconds / 3600, unit: 'hours' };
    }
    return { amount: seconds / 60, unit: 'minutes' };
}

export function formatDuration(seconds: number): string {
    const { amount, unit } = splitDuration(seconds);
    const word = unit.slice(0, -1);
    return `${amount} ${amount === 1 ? word : unit}`;
}
