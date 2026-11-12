import { cronOfForm, describeForm, formOfCron, parseTime, switchMode } from '../features/builder/scheduleForm';

describe('schedule forms', () => {
    test.each([
        ['0 6 * * 1-5', 'days', 'Every weekday at 06:00'],
        ['30 23 * * *', 'days', 'Every day at 23:30'],
        ['0 9 * * 0,6', 'days', 'On weekends at 09:00'],
        ['0 9 * * 1,3,5', 'days', 'On Mon, Wed, Fri at 09:00'],
        ['30 3 1 * *', 'monthly', 'On the 1st of every month at 03:30'],
        ['0 4 31 * *', 'monthly', 'On the 31st of every month at 04:00 (months without a 31st are skipped)'],
        ['*/15 8-17 * * 1-5', 'every', 'Every 15 minutes from 08:00 to 17:45, every weekday'],
        ['*/5 * * * *', 'every', 'Every 5 minutes, every day'],
        ['0 */2 * * *', 'every', 'Every 2 hours, every day'],
        ['0 8-18/4 * * 1-5', 'every', 'Every 4 hours from 08:00 to 16:00, every weekday'],
        ['0 * * * 6', 'every', 'Every hour, on Saturdays'],
    ])('%s opens as %s and round-trips', (cron, mode, text) => {
        const form = formOfCron(cron);
        expect(form.mode).toBe(mode);
        expect(describeForm(form)).toBe(text);
        expect(formOfCron(cronOfForm(form))).toEqual(form);
    });

    test.each(['0 6,18 * * *', '0 6 1-7 * 1', '*/7 * * * *', '5 */2 * * *', '0 6 * 1 *', '0 6 1 * 1', 'nonsense', ''])(
        '%s stays Advanced',
        (cron) => {
            expect(formOfCron(cron)).toEqual({ mode: 'cron', cron });
        }
    );

    test('writes the expected cron', () => {
        expect(cronOfForm({ mode: 'days', days: [1, 2, 3, 4, 5], hour: 6, minute: 0 })).toBe('0 6 * * 1-5');
        expect(cronOfForm({ mode: 'days', days: [0, 1, 2, 3, 4, 5, 6], hour: 6, minute: 0 })).toBe('0 6 * * *');
        expect(cronOfForm({ mode: 'every', every: 15, unit: 'minutes', fromHour: 8, toHour: 17, days: [1, 2, 3, 4, 5] })).toBe(
            '*/15 8-17 * * 1-5'
        );
        expect(cronOfForm({ mode: 'every', every: 1, unit: 'hours', fromHour: 0, toHour: 23, days: [0, 1, 2, 3, 4, 5, 6] })).toBe(
            '0 * * * *'
        );
        expect(cronOfForm({ mode: 'monthly', dom: 15, hour: 2, minute: 5 })).toBe('5 2 15 * *');
    });

    test('switching mode keeps days and time where it can', () => {
        const days = formOfCron('0 6 * * 1-5');
        expect(switchMode(days, 'monthly', '0 6 * * 1-5')).toEqual({ mode: 'monthly', dom: 1, hour: 6, minute: 0 });
        expect(switchMode(days, 'every', '0 6 * * 1-5')).toMatchObject({ mode: 'every', days: [1, 2, 3, 4, 5] });
        expect(switchMode(days, 'cron', '0 6 * * 1-5')).toEqual({ mode: 'cron', cron: '0 6 * * 1-5' });
    });

    test('parseTime', () => {
        expect(parseTime('06:00')).toEqual([6, 0]);
        expect(parseTime('6:05')).toEqual([6, 5]);
        expect(parseTime('24:00')).toBeNull();
        expect(parseTime('6')).toBeNull();
    });
});
