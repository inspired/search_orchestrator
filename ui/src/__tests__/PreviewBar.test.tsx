import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import type { ParamDecl } from '../api/types';
import PreviewBar, { PreviewBarProps } from '../features/builder/PreviewBar';
import { renderThemed, runSummary } from './fixtures';

const t = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime() / 1000;

const params: ParamDecl[] = [
    { name: 'region', type: 'string', default: 'eu', label: 'Region' },
    { name: 'size', type: 'enum', values: ['s', 'l'], default: 's' },
];

function renderBar(over: Partial<PreviewBarProps> = {}) {
    const props: PreviewBarProps = {
        scheduledTime: t(2026, 11, 6, 1, 0),
        onScheduledTime: jest.fn(),
        params,
        values: {},
        onValues: jest.fn(),
        source: 'live',
        onSource: jest.fn(),
        runs: [],
        ...over,
    };
    renderThemed(<PreviewBar {...props} />);
    return props;
}

describe('PreviewBar', () => {
    test('shows the time in local time and one control per param', () => {
        renderBar();
        expect(screen.getByText('Preview as if scheduled at')).toBeInTheDocument();
        expect(screen.getByLabelText('Time (HH:MM)')).toHaveValue('01:00');
        expect(screen.getByLabelText('Region')).toBeInTheDocument();
        expect(screen.getByText('size')).toBeInTheDocument();
    });

    test('editing the time sends epoch seconds', () => {
        const props = renderBar();
        fireEvent.change(screen.getByLabelText('Time (HH:MM)'), { target: { value: '13:30' } });
        expect(props.onScheduledTime).toHaveBeenCalledWith(t(2026, 11, 6, 13, 30));
    });

    test('a bad time is not sent', () => {
        const props = renderBar();
        fireEvent.change(screen.getByLabelText('Time (HH:MM)'), { target: { value: '25:00' } });
        expect(props.onScheduledTime).not.toHaveBeenCalled();
        expect(screen.getByText('Use HH:MM, 24-hour.')).toBeInTheDocument();
    });

    test('editing a param sends the values', () => {
        const props = renderBar({ values: { size: 'l' } });
        fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'us' } });
        expect(props.onValues).toHaveBeenCalledWith({ size: 'l', region: 'us' });
    });

    test('an unsaved job offers only Live previews', () => {
        renderBar({ runs: [] });
        fireEvent.click(screen.getByTestId('input-from'));
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Live previews']);
    });

    test('runs are listed newest first, at most 20, labelled time · state', () => {
        const runs = Array.from({ length: 25 }, (_v, i) =>
            runSummary({ id: `r${i}`, scheduled_time: t(2026, 10, 1 + i, 1, 0), state: i === 24 ? 'failed' : 'succeeded' })
        );
        renderBar({ runs });
        fireEvent.click(screen.getByTestId('input-from'));
        const labels = screen.getAllByRole('option').map((o) => o.textContent);
        expect(labels).toHaveLength(21);
        expect(labels[0]).toBe('Live previews');
        expect(labels[1]).toBe('2026-10-25 01:00 · failed');
        expect(labels[2]).toBe('2026-10-24 01:00 · succeeded');
    });

    test('choosing a run sets the time and params from that run', () => {
        const run = runSummary({ id: 'j:5', scheduled_time: t(2026, 11, 5, 1, 0), params: { region: 'us', size: 'l' } });
        const props = renderBar({ runs: [run] });
        fireEvent.click(screen.getByTestId('input-from'));
        fireEvent.click(screen.getByRole('option', { name: '2026-11-05 01:00 · succeeded' }));
        expect(props.onSource).toHaveBeenCalledWith('j:5');
        expect(props.onScheduledTime).toHaveBeenCalledWith(t(2026, 11, 5, 1, 0));
        expect(props.onValues).toHaveBeenCalledWith({ region: 'us', size: 'l' });
    });

    test('choosing Live previews keeps the time', () => {
        const run = runSummary({ id: 'j:5' });
        const props = renderBar({ runs: [run], source: 'j:5' });
        fireEvent.click(screen.getByTestId('input-from'));
        fireEvent.click(screen.getByRole('option', { name: 'Live previews' }));
        expect(props.onSource).toHaveBeenCalledWith('live');
        expect(props.onScheduledTime).not.toHaveBeenCalled();
    });
});
