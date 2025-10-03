/** @type {import('jest').Config} */
export default {
    // Use the ts-jest preset for ESM projects
    preset: 'ts-jest/presets/default-esm',

    resolver: 'jest-pnp-resolver',
    testEnvironment: 'node',

    // The preset handles the transform, so the old transform property is removed.
    // We add this block to ensure ts-jest is correctly configured for ESM.
    transform: {
        '^.+\\.m?[tj]sx?$': [
            'ts-jest',
            // Correct: All ts-jest options are in ONE object
            {
                useESM: true,
                diagnostics: {
                    ignoreCodes: [1343]
                },
                astTransformers: {
                    before: [
                        {
                            path: 'ts-jest-mock-import-meta',
                            options: { metaObjectReplacement: { url: 'https://www.url.com/server.js' } } // Made URL more realistic
                        }
                    ]
                }
            }
        ],
    },

    // This tells Jest to treat .ts files as ES Modules
    extensionsToTreatAsEsm: ['.ts'],

    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
    moduleFileExtensions: ['ts', 'js', 'mjs'], // Added 'mjs' for completeness

    // This is the most important change: it maps .js imports to the original files
    moduleNameMapper: {
        // This regex finds relative imports ending in .js and removes the extension
        '^(\\.{1,2}/.*)\\.js$': '$1',

        // Your existing alias is preserved
        '^@/(.*)$': '<rootDir>/src/$1',
    },

    setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
    testTimeout: 10_000,
};