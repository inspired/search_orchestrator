/* Splunk's charts draw on canvas, which jsdom lacks: tests get this stand-in, which shows the
 * series it was given (one element per data column) so tests can check what the chart gets. */
const React = require('react');

function VizStub(props) {
    const data = (props.dataSources && props.dataSources.primary && props.dataSources.primary.data) || { fields: [], columns: [] };
    return React.createElement(
        'div',
        { 'data-testid': 'viz-stub', 'data-options': JSON.stringify(props.options || {}) },
        data.fields.map((f, i) => React.createElement('span', { key: f.name, 'data-field': f.name }, (data.columns[i] || []).join(',')))
    );
}

module.exports = VizStub;
module.exports.default = VizStub;
