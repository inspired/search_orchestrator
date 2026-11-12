import React, { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import ScheduleEditor from '../features/builder/ScheduleEditor';
import { renderThemed } from './fixtures';

function Harness({ initial, onChange }: { initial: string; onChange: (c: string) => void }) {
    const [cron, setCron] = useState(initial);
    return (
        <>
            <ScheduleEditor
                id="s"
                cron={cron}
                timezone="Europe/Oslo"
                onChange={(c) => {
                    setCron(c);
                    onChange(c);
                }}
            />
            <button type="button" onClick={() => setCron('40 2 * * 1-5')}>
                outside
            </button>
        </>
    );
}

describe('ScheduleEditor', () => {
    test('opens a weekday cron as On days and says what it means', () => {
        const onChange = jest.fn();
        renderThemed(<Harness initial="0 6 * * 1-5" onChange={onChange} />);
        expect(screen.getByRole('radio', { name: 'On days' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId('schedule-summary').textContent).toContain('Every weekday at 06:00 (Europe/Oslo)');
        expect(onChange).not.toHaveBeenCalled(); // opening never rewrites the schedule
    });

    test('editing the time and days writes cron', () => {
        const onChange = jest.fn();
        renderThemed(<Harness initial="0 6 * * 1-5" onChange={onChange} />);
        fireEvent.change(screen.getByLabelText('At'), { target: { value: '07:30' } });
        expect(onChange).toHaveBeenLastCalledWith('30 7 * * 1-5');
        fireEvent.click(screen.getByRole('button', { name: 'Saturday' }));
        expect(onChange).toHaveBeenLastCalledWith('30 7 * * 1-6');
        fireEvent.change(screen.getByLabelText('At'), { target: { value: '7:6' } });
        expect(onChange).toHaveBeenCalledTimes(2); // not a time yet: nothing written
    });

    test('a cron no form can say opens in Advanced, and stays there', () => {
        const onChange = jest.fn();
        renderThemed(<Harness initial="0 6,18 1-7 * 1" onChange={onChange} />);
        expect(screen.getByRole('radio', { name: 'Advanced (cron)' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByLabelText('Cron')).toHaveValue('0 6,18 1-7 * 1');
    });

    test('switching to Monthly keeps the time', () => {
        const onChange = jest.fn();
        renderThemed(<Harness initial="0 6 * * 1-5" onChange={onChange} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }));
        expect(onChange).toHaveBeenLastCalledWith('0 6 1 * *');
        expect(screen.getByTestId('schedule-summary').textContent).toContain('On the 1st of every month at 06:00');
    });

    test('a change from outside, such as Use this time, updates the fields', () => {
        renderThemed(<Harness initial="0 2 * * 1-5" onChange={jest.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'outside' }));
        expect(screen.getByLabelText('At')).toHaveValue('02:40');
    });
});
