import React from 'react';
import { render, screen } from '@testing-library/react';
import SplunkThemeProvider from '@splunk/themes/SplunkThemeProvider';
import { PALETTES, paletteOf, schemeOf, toneHex } from '../features/logs/palette';
import { LevelText } from '../features/logs/LinesTable';
import { ChartFrame, StackedColumns, chartSearchUrl } from '../features/logs/charts';
import LogsSurface from '../features/logs/Surface';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';

function PageBg() {
    const t = useSplunkTheme() as unknown as Record<string, string>;
    return <span data-testid="page-bg">{`${t.colorScheme} ${t.backgroundColorPage}`}</span>;
}

function inScheme(scheme: 'dark' | 'light', el: React.ReactElement) {
    return render(
        <SplunkThemeProvider family="prisma" colorScheme={scheme} density="comfortable">
            {el}
        </SplunkThemeProvider>
    );
}

describe('Troubleshooting palette', () => {
    test('each scheme sits on the charts surface: black in dark, white in light', () => {
        expect(PALETTES.dark.surface).toBe('#000000');
        expect(PALETTES.light.surface).toBe('#FFFFFF');
        expect(schemeOf({ colorScheme: 'dark' })).toBe('dark');
        expect(schemeOf({})).toBe('light');
        expect(paletteOf({ colorScheme: 'dark' })).toBe(PALETTES.dark);
    });

    test('every tone has a colour, and the levels differ from each other', () => {
        (['dark', 'light'] as const).forEach((s) => {
            const p = PALETTES[s];
            const tones = (['error', 'warning', 'info', 'ok', 'muted'] as const).map((tone) => toneHex(p, tone));
            expect(new Set(tones).size).toBe(5);
            expect(tones).not.toContain(p.surface);
        });
    });

    test.each(['dark', 'light'] as const)('the Level column colours Info and OK too (%s)', (scheme) => {
        inScheme(
            scheme,
            <div>
                <LevelText tone="info" />
                <LevelText tone="ok" />
                <LevelText tone="error" />
            </div>
        );
        const [info, ok, error] = screen.getAllByTestId('level-text');
        const p = PALETTES[scheme];
        const hex = (el: HTMLElement) => el.style.color;
        const rgb = (h: string) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
        expect(hex(info)).toBe(rgb(p.info));
        expect(hex(ok)).toBe(rgb(p.ok));
        expect(hex(error)).toBe(rgb(p.error));
        expect(info.querySelector('[role="img"]')).not.toBeNull();
    });

    test.each(['dark', 'light'] as const)('the charts draw on the page surface (%s)', (scheme) => {
        inScheme(scheme, <StackedColumns label="x" points={[]} series={[{ key: 'a', label: 'A', color: '#123456' }]} />);
        const options = JSON.parse(screen.getByTestId('viz-stub').getAttribute('data-options') || '{}');
        expect(options.backgroundColor).toBe(PALETTES[scheme].surface);
    });

    test('the page surface paints the body and tells Splunk components', () => {
        const { unmount } = inScheme('dark', <LogsSurface>content</LogsSurface>);
        expect(screen.getByTestId('logs-surface').getAttribute('data-scheme')).toBe('dark');
        expect(document.body.style.backgroundColor).toBe('rgb(0, 0, 0)');
        unmount();
        expect(document.body.style.backgroundColor).toBe('');
    });

    test.each(['dark', 'light'] as const)('Splunk components inside read the surface as the page background (%s)', (scheme) => {
        inScheme(
            scheme,
            <LogsSurface>
                <PageBg />
            </LogsSurface>
        );
        expect(screen.getByTestId('page-bg').textContent).toBe(`${scheme} ${PALETTES[scheme].surface}`);
    });

    test('the magnifying glass opens a graph in Search as the same chart, with only its series', () => {
        const url = decodeURIComponent(
            chartSearchUrl(
                { spl: 'search index=_internal | timechart span=30m count AS error count AS info', earliest: '-24h', latest: 'now' },
                { kind: 'column', stacked: true, series: [{ key: 'error', label: 'Errors', color: '#E8473C' }] }
            ).replace(/\+/g, ' ')
        );
        expect(url).toContain('/app/search/search');
        expect(url).toContain('| fields _time _span error | rename error AS "Errors"');
        expect(url).toContain('display.visualizations.charting.chart=column');
        expect(url).toContain('display.visualizations.charting.chart.stackMode=stacked');
        expect(url).toContain('"Errors":0xE8473C');
        expect(url).toContain('earliest=-24h');
        inScheme('light', <ChartFrame href="/x">chart</ChartFrame>);
        const button = screen.getByTestId('open-in-search');
        expect(button.getAttribute('aria-label')).toBe('Open in Search');
        expect(button.getAttribute('href')).toBe('/x');
        expect(button.getAttribute('target')).toBe('_blank');
    });
});
