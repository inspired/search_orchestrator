/* Builds every page in src/pages/<name>/index.tsx into stage/appserver/static/pages/<name>.js
 * and copies the Splunk files in src/splunk/ (views, nav, templates) into stage/.
 * scripts/package.sh merges stage/ into the app. */
const fs = require('fs');
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const pagesDir = path.join(__dirname, 'src', 'pages');
const entry = {};
fs.readdirSync(pagesDir).forEach((name) => {
    const file = path.join(pagesDir, name, 'index.tsx');
    if (fs.existsSync(file)) {
        entry[name] = file;
    }
});

module.exports = (env, argv) => ({
    mode: argv.mode || 'production',
    entry,
    output: {
        path: path.join(__dirname, 'stage', 'appserver', 'static', 'pages'),
        filename: '[name].js',
    },
    // No source maps in the package (AppInspect, and no CDN or extra assets).
    devtool: argv.mode === 'development' ? 'eval-cheap-module-source-map' : false,
    resolve: { extensions: ['.tsx', '.ts', '.js', '.jsx'] },
    module: {
        rules: [
            {
                test: /\.[jt]sx?$/,
                exclude: /node_modules/,
                use: 'babel-loader',
            },
            {
                test: /\.m?js$/,
                resolve: { fullySpecified: false },
            },
        ],
    },
    optimization: {
        // Readable output: AppInspect asks for unminified JS to be reviewable.
        minimize: false,
    },
    performance: { hints: false },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [{ from: path.join(__dirname, 'src', 'splunk'), to: path.join(__dirname, 'stage') }],
        }),
    ],
});
