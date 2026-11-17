import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SplunkThemeProvider from '@splunk/themes/SplunkThemeProvider';
import type { ActionRun, JobDefinition, StepStatus } from '../api/types';
import RunGraph, { RunGraphProps } from '../features/run/RunGraph';
import useNow from '../hooks/useNow';
import { mockReducedMotion, NOW, renderThemed } from './fixtures';

const def: JobDefinition = {
    name: 'j',
    enabled: true,
    triggers: [],
    steps: [
        { id: 'a', type: 'inline', spl: 'x', actions: [{ hook: 'on_success', type: 'email', to: 'a@b' }] },
        { id: 'b', type: 'inline', spl: 'y' },
    ],
    edges: [{ from: 'a', to: 'b', condition: 'on_success' }],
};
const rows = [{ run_id: 'r', scope: 'step', step_id: 'a', hook: 'on_success', actions: [{ index: 0, state: 'done', attempts: 1 }] }] as ActionRun[];

describe('RunGraph', () => {
    test('shows step and action states; only step nodes select', () => {
        const onSelect = jest.fn();
        renderThemed(<RunGraph definition={def} states={{ a: { state: 'failed' }, b: { state: 'waiting' } }} actions={rows} onSelect={onSelect} />);
        expect(screen.getByText('Failed')).toBeInTheDocument();
        expect(screen.getByText('Sent')).toBeInTheDocument();
        // The status icon drawn beside "Sent" (12 px, before the text).
        expect(screen.getByTestId('node-action:a:0').querySelector('svg[width="12"]')).not.toBeNull();
        fireEvent.keyDown(screen.getByTestId('node-action:a:0'), { key: 'Enter' });
        expect(onSelect).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByTestId('node-step:a'), { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledWith('a');
    });

    test('groups are drawn expanded on the run page, whatever was saved', () => {
        const layout = {
            nodes: { 'step:a': { x: 100, y: 100 }, 'step:b': { x: 400, y: 100 } },
            groups: [{ id: 'g1', title: 'Both', color: 'categoricalA4' as const, x: 50, y: 50, w: 600, h: 200, collapsed: true }],
        };
        renderThemed(<RunGraph definition={{ ...def, layout }} states={{ a: { state: 'running' } }} actions={[]} />);
        expect(screen.getByTestId('group-g1')).toHaveTextContent('Both');
        expect(screen.getByTestId('node-step:a')).toBeInTheDocument();
        expect(screen.queryByTestId('group-block-g1')).toBeNull();
    });

    describe('live', () => {
        const AB = 'step:a-success->step:b';
        const layout = { nodes: { 'step:a': { x: 50, y: 50 }, 'step:b': { x: 900, y: 50 } } };
        const live = { ...def, steps: [{ id: 'a', type: 'inline' as const, spl: 'x' }, { id: 'b', type: 'previous' as const, spl: '| stats count' }], layout };
        const original = {
            w: Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!,
            h: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!,
        };
        const size = (w: number, h: number) => {
            Object.defineProperty(Element.prototype, 'clientWidth', { value: w, configurable: true });
            Object.defineProperty(Element.prototype, 'clientHeight', { value: h, configurable: true });
        };
        afterEach(() => {
            Object.defineProperty(Element.prototype, 'clientWidth', original.w);
            Object.defineProperty(Element.prototype, 'clientHeight', original.h);
            delete (window as { matchMedia?: unknown }).matchMedia;
            jest.useRealTimers();
        });
        const themed = (ui: React.ReactElement) => (
            <SplunkThemeProvider family="enterprise" colorScheme="light" density="comfortable">
                {ui}
            </SplunkThemeProvider>
        );
        const line = (key: string) => screen.getByTestId(`link-${key}`).querySelector('path') as SVGPathElement;
        const view = () => screen.getByRole('group', { name: /^Job flow/ }).querySelector('g[data-view]') as SVGGElement;

        test('a running step shows a spinner and a timer that advances each second', () => {
            jest.useFakeTimers();
            jest.setSystemTime(NOW * 1000);
            function Live() {
                const now = useNow(true);
                return <RunGraph definition={live} states={{ a: { state: 'running', started_at: NOW - 29 } }} actions={[]} active now={now} />;
            }
            renderThemed(<Live />);
            expect(screen.getByTestId('spinner-step:a')).toHaveClass('so-spin');
            expect(screen.getByTestId('timer-step:a')).toHaveTextContent('0:29');
            act(() => {
                jest.advanceTimersByTime(2000);
            });
            expect(screen.getByTestId('timer-step:a')).toHaveTextContent('0:31');
        });

        test('the line into a running step flows; reduced motion stops the animation', () => {
            const states: Record<string, StepStatus> = { a: { state: 'succeeded', started_at: NOW - 62, ended_at: NOW, result_count: 1204 }, b: { state: 'running', started_at: NOW } };
            const { unmount } = renderThemed(<RunGraph definition={live} states={states} actions={[]} active now={NOW} />);
            expect(line(AB)).toHaveClass('so-flow');
            expect(screen.getByTestId(`line-label-${AB}`)).toHaveTextContent(/1.204 rows →/);
            expect(screen.getByTestId('node-step:a')).toHaveTextContent('Succeeded · 1 m 2 s');
            unmount();
            mockReducedMotion(true);
            renderThemed(<RunGraph definition={live} states={states} actions={[]} active now={NOW} />);
            expect(line(AB)).not.toHaveClass('so-flow');
            expect(screen.queryByTestId('spinner-step:b')).toBeNull();
            expect(screen.getByTestId('timer-step:b')).toHaveTextContent('0:00');
        });

        test('a waiting step is dimmed and says what it waits for; an action counts down its retry', () => {
            const withAction = { ...live, steps: [{ ...live.steps[0], actions: [{ hook: 'on_success' as const, type: 'email' as const, to: 'a@b' }] }, live.steps[1]] };
            const rows = [{ run_id: 'r', created_at: NOW, actions: [{ index: 0, state: 'pending', attempts: 1, next_at: NOW + 30 }] }] as ActionRun[];
            renderThemed(<RunGraph definition={withAction} states={{ a: { state: 'running', started_at: NOW }, b: { state: 'waiting' } }} actions={rows} active now={NOW} />);
            expect(screen.getByTestId('node-step:b')).toHaveTextContent('Waiting for a');
            expect(screen.getByTestId('node-step:b')).toHaveAttribute('opacity', '0.6');
            expect(screen.getByTestId('node-action:a:0')).toHaveTextContent('Retrying in 30 s');
        });

        test('a finished run shows the final picture with no animation', () => {
            const states: Record<string, StepStatus> = { a: { state: 'succeeded', started_at: NOW - 5, ended_at: NOW }, b: { state: 'running', started_at: NOW } };
            renderThemed(<RunGraph definition={live} states={states} actions={[]} active={false} now={NOW} />);
            const canvas = screen.getByRole('group', { name: /^Job flow/ });
            expect(canvas.querySelectorAll('.so-flow, .so-spin, .so-pulse')).toHaveLength(0);
            expect(screen.queryByTestId('timer-step:b')).toBeNull();
            expect(line(AB)).toHaveAttribute('stroke-width', '2');
            expect(screen.queryByRole('button', { name: 'Follow the run' })).toBeNull();
        });

        // Review Focus 5: a poll mid-animation updates lines and text without the follow-pan fighting a user who panned.
        test('without a user pan, a poll with another running step moves the view to it', () => {
            size(400, 300);
            const props: RunGraphProps = { definition: live, states: { a: { state: 'running', started_at: NOW } }, actions: [], active: true, now: NOW };
            const r = render(themed(<RunGraph {...props} />));
            expect(view().getAttribute('transform')).toBe('translate(0,0) scale(1)');
            r.rerender(themed(<RunGraph {...props} states={{ a: { state: 'succeeded' }, b: { state: 'running', started_at: NOW } }} />));
            expect(view().getAttribute('transform')).toBe('translate(-720,0) scale(1)');
        });

        test('after a user pan, a new poll does not move the view; "Follow the run" turns follow back on', () => {
            size(400, 300);
            const props: RunGraphProps = { definition: live, states: { a: { state: 'running', started_at: NOW } }, actions: [], active: true, now: NOW };
            const r = render(themed(<RunGraph {...props} />));
            expect(screen.queryByRole('button', { name: 'Follow the run' })).toBeNull();
            const canvas = screen.getByRole('group', { name: /^Job flow/ });
            fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
            fireEvent.pointerMove(canvas, { clientX: 40, clientY: 10 });
            fireEvent.pointerUp(canvas, { clientX: 40, clientY: 10 });
            expect(view().getAttribute('transform')).toBe('translate(30,0) scale(1)');
            r.rerender(themed(<RunGraph {...props} states={{ a: { state: 'succeeded' }, b: { state: 'running', started_at: NOW } }} />));
            expect(view().getAttribute('transform')).toBe('translate(30,0) scale(1)');
            // The poll still updated lines and text.
            expect(line(AB)).toHaveClass('so-flow');
            expect(screen.getByTestId('node-step:a')).toHaveTextContent('Succeeded');
            fireEvent.click(screen.getByRole('button', { name: 'Follow the run' }));
            expect(view().getAttribute('transform')).toBe('translate(-720,0) scale(1)');
            expect(screen.queryByRole('button', { name: 'Follow the run' })).toBeNull();
        });
    });
});

