import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import SidePanel, { DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH, usePanelLayout } from '../features/builder/SidePanel';
import { renderThemed } from './fixtures';

function Harness() {
    const panel = usePanelLayout();
    return (
        <SidePanel open={panel.open} width={panel.width} onOpen={panel.setOpen} onWidth={panel.setWidth} maxHeight={400}>
            <p>panel body</p>
        </SidePanel>
    );
}

beforeEach(() => window.localStorage.clear());

test('hides and shows, and remembers it', () => {
    const { unmount } = renderThemed(<Harness />);
    expect(screen.getByText('panel body')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide side panel' }));
    expect(screen.queryByText('panel body')).toBeNull();
    unmount();
    renderThemed(<Harness />);
    expect(screen.queryByText('panel body')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show side panel' }));
    expect(screen.getByText('panel body')).toBeInTheDocument();
});

test('resizes with the arrow keys, Home and End, clamped, and double-click resets', () => {
    renderThemed(<Harness />);
    const edge = screen.getByRole('separator', { name: 'Resize side panel' });
    expect(edge.getAttribute('aria-valuenow')).toBe(String(DEFAULT_WIDTH));
    fireEvent.keyDown(edge, { key: 'ArrowLeft' });
    expect(edge.getAttribute('aria-valuenow')).toBe(String(DEFAULT_WIDTH + 20));
    fireEvent.keyDown(edge, { key: 'End' });
    expect(edge.getAttribute('aria-valuenow')).toBe(String(MAX_WIDTH));
    fireEvent.keyDown(edge, { key: 'ArrowLeft' });
    expect(edge.getAttribute('aria-valuenow')).toBe(String(MAX_WIDTH));
    fireEvent.keyDown(edge, { key: 'Home' });
    expect(edge.getAttribute('aria-valuenow')).toBe(String(MIN_WIDTH));
    expect(JSON.parse(window.localStorage.getItem('so.flow.panel') || '{}').width).toBe(MIN_WIDTH);
    fireEvent.doubleClick(edge);
    expect(edge.getAttribute('aria-valuenow')).toBe(String(DEFAULT_WIDTH));
});

test('dragging the edge to the left widens the panel', () => {
    renderThemed(<Harness />);
    const edge = screen.getByRole('separator', { name: 'Resize side panel' });
    fireEvent.pointerDown(edge, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 400 });
    fireEvent.pointerUp(window);
    expect(edge.getAttribute('aria-valuenow')).toBe(String(DEFAULT_WIDTH + 100));
});
