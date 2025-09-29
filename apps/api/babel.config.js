// babel.config.js
module.exports = {
    presets: [
        // This preset transpiles modern JavaScript features
        ['@babel/preset-env', { targets: { node: 'current' } }],

        // ADD THIS LINE: This preset handles TypeScript
        '@babel/preset-typescript',
    ],
};