/* The Troubleshooting graphs as a small Dashboard Studio dashboard, drawn by Splunk's own
 * dashboard framework (@splunk/dashboard-core): one base search (ds.search, the page's
 * timechart with its filters) and a chain search (ds.chain) per graph that keeps only its
 * series. Splunk runs the searches, draws the panels and their hover action bar; the one action
 * in it is Open in search, which, as in Dashboard Studio, opens the panel's search (base and
 * chain together) in Search. The framework leaves the action itself to the app (Dashboard
 * Studio ships its own), so this file has it. */
import React, { useMemo } from 'react';
import DashboardCore from '@splunk/dashboard-core';
import { DashboardContextProvider } from '@splunk/dashboard-context';
import GridLayoutViewer from '@splunk/dashboard-layouts/GridLayoutViewer';
import SplunkSearch from '@splunk/datasources/SplunkSearch';
import Column from '@splunk/visualizations/Column';
import Line from '@splunk/visualizations/Line';
import Button from '@splunk/react-ui/Button';
import Tooltip from '@splunk/react-ui/Tooltip';
import Magnifier from '@splunk/react-icons/Magnifier';
import { createURL } from '@splunk/splunk-utils/url';
import type { Series } from './charts';
import { useTheme } from './charts';
import { paletteOf } from './palette';

export interface SearchLink {
    spl: string;
    earliest: string;
    latest: string;
}

/** One graph: a panel with a title, its series (columns of the base search) and a height. */
export interface GraphPanel {
    id: string;
    title: string;
    kind: 'column' | 'line';
    series: Series[];
    height: number;
    stacked?: boolean;
    unit?: 'ms';
    /** Join the points across empty buckets (the engine's heartbeat comes every 5 minutes). */
    connect?: boolean;
}

/** Only what these graphs use, so the page doesn't load every Dashboard Studio chart. */
export const PRESET = {
    layouts: { grid: GridLayoutViewer },
    dataSources: { 'ds.search': SplunkSearch, 'ds.chain': SplunkSearch },
    visualizations: { 'splunk.column': Column, 'splunk.line': Line },
    inputs: {},
    eventHandlers: {},
};

export const BASE_ID = 'ds_base';
const WIDTH = 1200;
const GAP = 8;

const colorsByField = (series: Series[]) => Object.fromEntries(series.map((s) => [s.label, s.color]));

/** The dashboard definition: the base search, a chain search and a panel per graph, stacked
 * in a grid on the page's surface. `live` reruns the base search every 10 seconds. */
export function graphDefinition(base: SearchLink, panels: GraphPanel[], surface: string, live = false): Record<string, unknown> {
    const dataSources: Record<string, unknown> = {
        [BASE_ID]: {
            type: 'ds.search',
            name: 'Troubleshooting timechart',
            options: {
                query: base.spl.replace(/^search /, ''),
                queryParameters: { earliest: base.earliest, latest: base.latest },
                ...(live ? { refresh: '10s', refreshType: 'delay' } : {}),
            },
        },
    };
    const visualizations: Record<string, unknown> = {};
    const structure: unknown[] = [];
    let y = 0;
    panels.forEach((p) => {
        const keys = p.series.map((s) => s.key);
        dataSources[`ds_${p.id}`] = {
            type: 'ds.chain',
            name: p.title,
            options: {
                extend: BASE_ID,
                query: `| fields _time _span ${keys.join(' ')} | rename ${p.series.map((s) => `${s.key} AS "${s.label}"`).join(', ')}`,
            },
        };
        const dashed = Object.fromEntries(p.series.filter((s) => s.dashed).map((s) => [s.label, 'dash']));
        visualizations[`viz_${p.id}`] = {
            type: p.kind === 'column' ? 'splunk.column' : 'splunk.line',
            title: p.title,
            dataSources: { primary: `ds_${p.id}` },
            options: {
                backgroundColor: surface,
                legendDisplay: p.series.length > 1 ? 'top' : 'off',
                seriesColorsByField: colorsByField(p.series),
                xAxisTitleVisibility: 'hide',
                yAxisTitleVisibility: p.unit ? 'show' : 'hide',
                ...(p.unit === 'ms' ? { yAxisTitleText: 'Milliseconds' } : {}),
                ...(p.kind === 'column' && p.stacked ? { stackMode: 'stacked' } : {}),
                ...(p.kind === 'line' ? { nullValueDisplay: p.connect ? 'connect' : 'gaps', ...(Object.keys(dashed).length ? { lineDashStylesByField: dashed } : {}) } : {}),
            },
        };
        structure.push({ item: `viz_${p.id}`, type: 'block', position: { x: 0, y, w: WIDTH, h: p.height } });
        y += p.height + GAP;
    });
    return {
        title: 'Troubleshooting',
        dataSources,
        visualizations,
        inputs: {},
        layout: {
            tabs: { items: [{ layoutId: 'layout_1', label: 'Graphs' }], options: { showTabBar: false } },
            layoutDefinitions: { layout_1: { type: 'grid', options: { width: WIDTH, gutterSize: GAP, backgroundColor: surface }, structure } },
            globalInputs: [],
        },
    };
}

/** The height the panels take, for the box the dashboard is drawn in. */
export const graphHeight = (panels: GraphPanel[]) => panels.reduce((h, p) => h + p.height + GAP, 0);

interface DsDef {
    type?: string;
    options?: { query?: string; extend?: string; queryParameters?: { earliest?: string; latest?: string } };
}

/** A panel's whole search, as Dashboard Studio's Open in search builds it: a chain search
 * follows its `extend` back to the base search, and the pieces are joined. */
export function panelSearch(itemDefinition: { dataSources?: { primary?: string } } | undefined, dataSources: Record<string, DsDef> | undefined): SearchLink | null {
    let id = itemDefinition?.dataSources?.primary;
    const parts: string[] = [];
    let params: { earliest?: string; latest?: string } = {};
    for (let guard = 0; id && dataSources && dataSources[id] && guard < 10; guard += 1) {
        const ds: DsDef = dataSources[id];
        parts.unshift((ds.options?.query || '').trim());
        if (ds.options?.queryParameters) {
            params = ds.options.queryParameters;
        }
        id = ds.type === 'ds.chain' ? ds.options?.extend : undefined;
    }
    if (!parts.length || !parts[0]) {
        return null;
    }
    return { spl: parts.join(' '), earliest: params.earliest || '-24h', latest: params.latest || 'now' };
}

/** The Search page URL for a panel's search. */
export const searchUrl = (search: SearchLink) => createURL('/app/search/search', { q: search.spl, earliest: search.earliest, latest: search.latest });

/** The Open in search action in a panel's action bar. The framework gives it the panel's
 * definition and only the data sources that panel uses (the chain, not the base it extends),
 * so the dashboard's own data sources come in as `allDataSources`. It opens a new tab from a
 * plain icon button, as Dashboard Studio's does (a link button would add an external-link icon). */
export function OpenInSearchAction(props: { itemDefinition?: { dataSources?: { primary?: string } }; dataSources?: Record<string, DsDef>; allDataSources?: Record<string, DsDef> }) {
    const search = panelSearch(props.itemDefinition, { ...(props.dataSources || {}), ...(props.allDataSources || {}) });
    if (!search) {
        return null;
    }
    const url = searchUrl(search);
    return (
        <Tooltip content="Open in search">
            <Button
                appearance="subtle"
                icon={<Magnifier />}
                onClick={() => window.open(url, '_blank', 'noopener')}
                aria-label="Open in search"
                data-testid="open-in-search"
                data-href={url}
            />
        </Tooltip>
    );
}

export default function GraphDashboard({ base, panels, live = false, label }: { base: SearchLink; panels: GraphPanel[]; live?: boolean; label: string }) {
    const theme = useTheme();
    const surface = paletteOf(theme).surface;
    const definition = useMemo(() => graphDefinition(base, panels, surface, live), [base, panels, surface, live]);
    const key = useMemo(() => JSON.stringify(definition), [definition]);
    const actions = useMemo(
        () => [<OpenInSearchAction key="open-in-search" allDataSources={definition.dataSources as Record<string, DsDef>} />],
        [definition]
    );
    return (
        <section aria-label={label} data-testid="graph-dashboard" style={{ width: '100%', height: graphHeight(panels) }}>
            {/* initialDefinition and initialMode come from @splunk/dashboard-types, which isn't installed (types only). */}
            <DashboardContextProvider key={key} preset={PRESET as never} {...({ initialDefinition: definition, initialMode: 'view' } as object)}>
                <DashboardCore width="100%" height="100%" actionMenus={actions} />
            </DashboardContextProvider>
        </section>
    );
}
