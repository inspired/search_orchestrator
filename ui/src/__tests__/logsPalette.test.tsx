import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SplunkThemeProvider from '@splunk/themes/SplunkThemeProvider';
import { PALETTES, paletteOf, schemeOf, toneHex } from '../features/logs/palette';
import { LevelText } from '../features/logs/LinesTable';
import GraphDashboard, { graphDefinition, panelSearch } from '../features/logs/GraphDashboard';
import { graphPanels } from '../features/logs/Overview';
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

    test.each(['dark', 'light'] as const)('the graphs draw on the page surface (%s)', (scheme) => {
        const def = graphDefinition({ spl: 'search x', earliest: '-24h', latest: 'now' }, graphPanels(PALETTES[scheme]).activity, PALETTES[scheme].surface) as {
            visualizations: Record<string, { options: { backgroundColor: string } }>;
            layout: { layoutDefinitions: Record<string, { options: { backgroundColor: string } }> };
        };
        expect(def.visualizations.viz_levels.options.backgroundColor).toBe(PALETTES[scheme].surface);
        expect(def.layout.layoutDefinitions.layout_1.options.backgroundColor).toBe(PALETTES[scheme].surface);
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

    test('the graphs are a Dashboard Studio definition: one base search, a chain search per panel', () => {
        const panels = graphPanels(PALETTES.dark);
        const def = graphDefinition({ spl: 'search index=_internal | timechart count AS error', earliest: '-7d', latest: 'now' }, panels.requests, '#000000', true) as {
            dataSources: Record<string, { type: string; options: Record<string, unknown> }>;
            visualizations: Record<string, { type: string; title: string; dataSources: { primary: string }; options: Record<string, unknown> }>;
            layout: { tabs: { options: { showTabBar: boolean } }; layoutDefinitions: Record<string, { type: string; structure: Array<{ item: string; position: { y: number } }> }> };
        };
        expect(def.dataSources.ds_base).toEqual({
            type: 'ds.search',
            name: 'Troubleshooting timechart',
            options: { query: 'index=_internal | timechart count AS error', queryParameters: { earliest: '-7d', latest: 'now' }, refresh: '10s', refreshType: 'delay' },
        });
        expect(def.dataSources.ds_requests.type).toBe('ds.chain');
        expect(def.dataSources.ds_requests.options).toEqual({
            extend: 'ds_base',
            query: '| fields _time _span req_5xx req_4xx req_ok | rename req_5xx AS "Server errors (5xx)", req_4xx AS "Refused (4xx)", req_ok AS "OK"',
        });
        expect(def.visualizations.viz_requests.type).toBe('splunk.column');
        expect(def.visualizations.viz_requests.options.stackMode).toBe('stacked');
        expect(def.visualizations.viz_p95.type).toBe('splunk.line');
        expect(def.visualizations.viz_p95.dataSources.primary).toBe('ds_p95');
        expect(def.layout.tabs.options.showTabBar).toBe(false);
        expect(def.layout.layoutDefinitions.layout_1.type).toBe('grid');
        expect(def.layout.layoutDefinitions.layout_1.structure.map((x) => x.item)).toEqual(['viz_requests', 'viz_p95']);
    });

    test("a panel's Open in search follows the chain back to the base search, as Dashboard Studio does", () => {
        const dataSources = {
            ds_base: { type: 'ds.search', options: { query: 'index=_internal | timechart count AS error', queryParameters: { earliest: '-24h', latest: 'now' } } },
            ds_x: { type: 'ds.chain', options: { extend: 'ds_base', query: '| fields _time error' } },
        };
        expect(panelSearch({ dataSources: { primary: 'ds_x' } }, dataSources)).toEqual({ spl: 'index=_internal | timechart count AS error | fields _time error', earliest: '-24h', latest: 'now' });
        expect(panelSearch({ dataSources: { primary: 'nope' } }, dataSources)).toBeNull();
        inScheme('light', <GraphDashboard base={{ spl: 'search index=_internal | timechart count AS error', earliest: '-24h', latest: 'now' }} panels={graphPanels(PALETTES.light).activity} label="Activity" />);
        const panel = screen.getByTestId('panel-viz_levels');
        expect(panel).toHaveTextContent('Log lines over time by level');
        const button = screen.getByTestId('open-in-search');
        expect(button.getAttribute('aria-label')).toBe('Open in search');
        // A plain icon button (no external-link icon) that opens a new tab with the whole search,
        // base and chain, although the framework hands it only the chain.
        expect(button.querySelectorAll('svg')).toHaveLength(1);
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        fireEvent.click(button);
        expect(open).toHaveBeenCalledWith(button.getAttribute('data-href'), '_blank', 'noopener');
        open.mockRestore();
        const href = decodeURIComponent((button.getAttribute('data-href') || '').replace(/\+/g, ' '));
        expect(href).toContain('/app/search/search');
        expect(href).toContain('q=index=_internal | timechart count AS error | fields _time _span error warning info debug | rename error AS "Errors"');
        expect(href).toContain('earliest=-24h');
    });
});
