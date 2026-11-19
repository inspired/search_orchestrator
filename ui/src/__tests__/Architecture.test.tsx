import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import Architecture, { LINKS, MODULES, PARTS } from '../features/help/Architecture';
import { renderThemed } from './fixtures';

// Node's fs in jest (the UI build has no Node types).
declare const require: (name: string) => unknown;
declare const __dirname: string;
const fs = require('fs') as { readdirSync: (dir: string) => string[] };

describe('How it works', () => {
    test('every line joins two parts, and every part is on a line', () => {
        const ids = new Set(PARTS.map((p) => p.id));
        LINKS.forEach((l) => {
            expect(ids.has(l.from)).toBe(true);
            expect(ids.has(l.to)).toBe(true);
        });
        PARTS.forEach((p) => expect(LINKS.some((l) => l.from === p.id || l.to === p.id)).toBe(true));
    });

    test('parts in a layer do not overlap and stay inside the drawing', () => {
        const byLayer: Record<string, typeof PARTS> = {};
        PARTS.forEach((p) => (byLayer[p.layer] = [...(byLayer[p.layer] || []), p]));
        Object.values(byLayer).forEach((parts) => {
            const sorted = [...parts].sort((a, b) => a.x - b.x);
            sorted.forEach((p, i) => {
                expect(p.x + p.w).toBeLessThanOrEqual(1110);
                if (i > 0) {
                    expect(p.x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].w);
                }
            });
        });
    });

    test('the module table names every Python module in bin/so', () => {
        const dir = `${__dirname}/../../../app/search_orchestrator/bin/so`;
        const listed = MODULES.map(([file]) => file).join(' ');
        fs.readdirSync(dir)
            .filter((f: string) => f.endsWith('.py') && f !== '__init__.py')
            .forEach((f: string) => expect(listed).toContain(f.replace(/\.py$/, '')));
    });

    test('clicking a part lights its lines and shows what it does', () => {
        renderThemed(<Architecture />);
        expect(screen.getByText(/Click a part to light up/)).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('arch-part-tick'));
        expect(screen.getByTestId('arch-part-tick')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('arch-link-engine_in-tick')).toHaveAttribute('data-lit', 'true');
        expect(screen.getByTestId('arch-link-rest-api')).toHaveAttribute('data-lit', 'false');
        const details = screen.getByTestId('arch-details');
        expect(details).toHaveTextContent('so/engine.py');
        expect(details).toHaveTextContent('Engine process (every 5 s)');
        fireEvent.keyDown(screen.getByTestId('arch-part-tick'), { key: 'Enter' });
        expect(screen.queryByTestId('arch-details')).toBeNull();
    });
});
