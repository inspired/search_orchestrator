/* @splunk/visualizations ships no TypeScript types: its components take options, dataSources,
 * width, height and event props (see its docs-llm folder). */
declare module '@splunk/visualizations/*' {
    import type { ComponentType } from 'react';

    const Viz: ComponentType<Record<string, unknown>>;
    export default Viz;
}
