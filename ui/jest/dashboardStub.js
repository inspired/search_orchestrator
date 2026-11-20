/* Splunk's dashboard framework (@splunk/dashboard-core and -context) needs a browser with
 * canvas and splunkd: tests get this stand-in. The provider shows the dashboard definition it
 * was given; the core draws each panel's title and, as the framework does, gives every action
 * menu the panel's definition and the dashboard's data sources. */
const React = require('react');

const Definition = React.createContext(null);

function DashboardContextProvider(props) {
    return React.createElement(
        Definition.Provider,
        { value: props.initialDefinition || null },
        React.createElement('div', { 'data-testid': 'dashboard', 'data-definition': JSON.stringify(props.initialDefinition || {}) }, props.children)
    );
}

function DashboardCore(props) {
    const def = React.useContext(Definition) || {};
    const vizs = def.visualizations || {};
    return React.createElement(
        'div',
        { 'data-testid': 'dashboard-core' },
        Object.keys(vizs).map((id) =>
            React.createElement(
                'div',
                { key: id, 'data-testid': `panel-${id}`, 'data-type': vizs[id].type },
                React.createElement('span', null, vizs[id].title),
                (props.actionMenus || []).map((el, i) =>
                    React.cloneElement(el, { key: i, type: 'block', itemId: id, itemDefinition: vizs[id], dataSources: def.dataSources })
                )
            )
        )
    );
}

const stub = {};
module.exports = DashboardCore;
module.exports.default = DashboardCore;
module.exports.DashboardContextProvider = DashboardContextProvider;
module.exports.stub = stub;
