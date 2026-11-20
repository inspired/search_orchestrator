import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import Architecture, { AREAS, ARROWS, HEIGHT, LABEL_PX, LINKS, MODULES, PAD_PX, PARTS, SUB_PX, WIDTH } from '../features/help/Architecture';
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

    test('no two parts overlap, every part fits the drawing and its text fits its box', () => {
        const h = (p: (typeof PARTS)[number]) => p.h || 46;
        PARTS.forEach((p, i) => {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x + p.w).toBeLessThanOrEqual(WIDTH);
            expect(p.y + h(p)).toBeLessThanOrEqual(HEIGHT);
            if (p.h) {
                expect((p.label.length * LABEL_PX) + 10 + p.sub.length * SUB_PX + PAD_PX).toBeLessThanOrEqual(p.w);
            } else {
                expect(p.label.length * LABEL_PX + PAD_PX).toBeLessThanOrEqual(p.w);
                expect(p.sub.length * SUB_PX + PAD_PX).toBeLessThanOrEqual(p.w);
            }
            PARTS.slice(i + 1).forEach((q) => {
                const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + h(p) <= q.y || q.y + h(q) <= p.y;
                expect(apart).toBe(true);
            });
        });
        AREAS.forEach((a) => expect(a.x + a.w).toBeLessThanOrEqual(WIDTH));
    });

    test('only a few arrows: the hand-offs between areas', () => {
        expect(ARROWS.length).toBeLessThanOrEqual(8);
        renderThemed(<Architecture />);
        expect(screen.getAllByTestId('arch-arrow')).toHaveLength(ARROWS.length);
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
        expect(screen.getByRole('img', { name: /Component map/ }).getAttribute('style')).toContain('width: 100%');
        fireEvent.click(screen.getByTestId('arch-part-tick'));
        expect(screen.getByTestId('arch-part-tick')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('arch-part-engine_in')).toHaveAttribute('data-lit', 'true');
        expect(screen.getByTestId('arch-part-actions')).toHaveAttribute('data-lit', 'true');
        expect(screen.getByTestId('arch-part-rest')).toHaveAttribute('data-lit', 'false');
        const details = screen.getByTestId('arch-details');
        expect(details).toHaveTextContent('so/engine.py');
        expect(details).toHaveTextContent('Engine process (every 5 s)');
        fireEvent.keyDown(screen.getByTestId('arch-part-tick'), { key: 'Enter' });
        expect(screen.queryByTestId('arch-details')).toBeNull();
    });
});
