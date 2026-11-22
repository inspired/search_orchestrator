import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { DurationField } from '../features/builder/StepPanel';
import { formatDuration, splitDuration, toSeconds } from '../features/builder/duration';
import { renderThemed } from './fixtures';

describe('duration helpers', () => {
    test('splitDuration picks the largest exact unit', () => {
        expect(splitDuration(86400)).toEqual({ amount: 1, unit: 'days' });
        expect(splitDuration(7200)).toEqual({ amount: 2, unit: 'hours' });
        expect(splitDuration(5400)).toEqual({ amount: 90, unit: 'minutes' });
        expect(splitDuration(60)).toEqual({ amount: 1, unit: 'minutes' });
    });

    test('a value that is not whole minutes is rounded and flagged inexact', () => {
        expect(splitDuration(61)).toEqual({ amount: 1, unit: 'minutes', exact: false });
        expect(splitDuration(90)).toEqual({ amount: 2, unit: 'minutes', exact: false });
    });

    test('toSeconds and formatDuration', () => {
        expect(toSeconds(3, 'hours')).toBe(10800);
        expect(toSeconds(2, 'days')).toBe(172800);
        expect(toSeconds(5, 'minutes')).toBe(300);
        expect(formatDuration(3600)).toBe('1 hour');
        expect(formatDuration(86400)).toBe('1 day');
        expect(formatDuration(86400 * 2)).toBe('2 days');
        expect(formatDuration(5400)).toBe('90 minutes');
        expect(formatDuration(60)).toBe('1 minute');
        expect(formatDuration(86400 / 2)).toBe('12 hours');
    });
});

function renderField(value: number | null | undefined, onChange = jest.fn()) {
    renderThemed(
        <DurationField id="d" label="Give up after" value={value} inherited={7200} inheritedFrom="Job default" onChange={onChange} />
    );
    return onChange;
}

describe('DurationField', () => {
    test('shows the amount and unit', () => {
        renderField(86400);
        expect(screen.getByRole('spinbutton')).toHaveValue('1');
        expect(screen.getByRole('combobox', { name: /Give up after/ })).toHaveTextContent('Days');
    });

    test('90 minutes does not show as 1.5 hours', () => {
        renderField(5400);
        expect(screen.getByRole('spinbutton')).toHaveValue('90');
        expect(screen.getByRole('combobox', { name: /Give up after/ })).toHaveTextContent('Minutes');
    });

    test('a value that is not whole minutes is untouched until edited', () => {
        const onChange = renderField(61);
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });
        expect(onChange).toHaveBeenCalledWith(120);
    });

    test('changing the unit converts the amount', () => {
        const onChange = renderField(86400);
        fireEvent.click(screen.getByRole('combobox', { name: /Give up after/ }));
        fireEvent.click(screen.getByRole('option', { name: 'Hours' }));
        expect(onChange).toHaveBeenCalledWith(3600);
    });

    test('zero is refused', () => {
        const onChange = renderField(1800);
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } });
        expect(screen.getByText('At least 1 minute.')).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    test('empty inherits and the placeholder shows the inherited value', () => {
        const onChange = renderField(1800);
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
        expect(onChange).toHaveBeenCalledWith(null);
        expect(screen.getByRole('spinbutton')).toHaveAttribute('placeholder', 'Job default (2 hours)');
    });
});
