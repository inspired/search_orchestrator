module.exports = {
    presets: [
        ['@babel/preset-env', { targets: { browsers: ['last 2 Chrome versions', 'last 2 Firefox versions', 'last 2 Safari versions', 'last 2 Edge versions'] } }],
        ['@babel/preset-react', { runtime: 'automatic' }],
        '@babel/preset-typescript',
    ],
    env: {
        test: {
            presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
        },
    },
};
