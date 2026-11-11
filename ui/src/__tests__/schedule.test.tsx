import { describeSchedule, fromCron, timeZoneOptions, toCron } from '../features/builder/schedule';

describe('schedule presets', () => {
    test('daily round-trips', () => {
        expect(fromCron('0 1 * * *')).toEqual({ kind: 'daily', hour: 1, minute: 0 });
        expect(toCron({ kind: 'daily', hour: 1, minute: 0 })).toBe('0 1 * * *');
    });

    test('weekly, monthly and hourly', () => {
        expect(fromCron('30 6 * * 1')).toEqual({ kind: 'weekly', days: [1], hour: 6, minute: 30 });
        expect(fromCron('0 2 1 * *')).toEqual({ kind: 'monthly', dayOfMonth: 1, hour: 2, minute: 0 });
        expect(fromCron('15 * * * *')).toEqual({ kind: 'hourly', minute: 15 });
        expect(toCron({ kind: 'weekly', days: [1, 3], hour: 6, minute: 30 })).toBe('30 6 * * 1,3');
        expect(toCron({ kind: 'monthly', dayOfMonth: 1, hour: 2, minute: 0 })).toBe('0 2 1 * *');
        expect(toCron({ kind: 'hourly', minute: 15 })).toBe('15 * * * *');
    });

    test.each(['*/15 * * * *', '0 1 * * 1-5', '0 1 * 1 *', '00 1 * * *', '0 1 * * 3,1', '0 1 * * 7', '0 1 * * 1,1', '0 1  * * *', '0 24 * * *', '60 * * * *', '0 1 32 * *', '0 1 0 * *', ''])(
        '%j is custom and unchanged',
        (cron) => {
            expect(fromCron(cron)).toEqual({ kind: 'custom', cron });
            expect(toCron(fromCron(cron))).toBe(cron);
        }
    );

    test('describes', () => {
        expect(describeSchedule('0 1 * * *')).toBe('Every day at 01:00');
        expect(describeSchedule('30 6 * * 1,3')).toBe('Every Monday and Wednesday at 06:30');
        expect(describeSchedule('30 6 * * 0,1,6')).toBe('Every Sunday, Monday and Saturday at 06:30');
        expect(describeSchedule('0 2 1 * *')).toBe('On day 1 of every month at 02:00');
        expect(describeSchedule('15 * * * *')).toBe('Every hour at 15 minutes past');
        expect(describeSchedule('*/15 * * * *')).toBe('Custom schedule: */15 * * * *');
    });

    test('time zone options keep an unlisted zone', () => {
        const opts = timeZoneOptions('Etc/Unknown');
        expect(opts).toContain('Etc/Unknown');
        expect(opts).toContain('Europe/Oslo');
        expect(opts).toEqual([...opts].sort());
        expect(timeZoneOptions(undefined)).toContain('Europe/Oslo');
        expect(timeZoneOptions(undefined).filter((z) => z === 'UTC')).toHaveLength(1);
        expect(timeZoneOptions('UTC').filter((z) => z === 'UTC')).toHaveLength(1);
    });
});
