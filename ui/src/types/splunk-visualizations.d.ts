/* @splunk/visualizations ships no TypeScript types: its components take options, dataSources,
 * width, height and event props (see its docs-llm folder). */
declare module '@splunk/visualizations/*' {
    import type { ComponentType } from 'react';

    const Viz: ComponentType<Record<string, unknown>>;
    export default Viz;
}

/* The dashboard framework's layout and data source modules ship no TypeScript types either. */
declare module '@splunk/dashboard-layouts/GridLayoutViewer' {
    const Layout: unknown;
    export default Layout;
}
declare module '@splunk/datasources/SplunkSearch' {
    const DataSource: unknown;
    export default DataSource;
}
