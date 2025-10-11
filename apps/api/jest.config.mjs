/** @type {import('jest').Config} */
export default {
    preset: 'ts-jest/presets/default-esm',
    resolver: 'jest-pnp-resolver',
    testEnvironment: 'node',

    transform: {
        '^.+\\.m?[tj]sx?$': [
            'ts-jest',
            {
                useESM: true,
                tsconfig: '<rootDir>/tsconfig.jest.json',
                diagnostics: { ignoreCodes: [1343] },
                astTransformers: {
                    before: [
                        {
                            path: 'ts-jest-mock-import-meta',
                            options: { metaObjectReplacement: { url: 'https://www.url.com/server.js' } },
                        },
                    ],
                },
            },
        ],
    },

    extensionsToTreatAsEsm: ['.ts'],
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
    moduleFileExtensions: ['ts', 'js', 'mjs'],

    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        '^@/(.*)$': '<rootDir>/src/$1',
    },

    setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
    testTimeout: 10_000,

    // Additions for compact, relevant failure logs:
    silent: false,                 // hide raw console output; reporter will print relevant logs for failures
    testLocationInResults: true,  // gives us line/column for tests (used by the reporter)
    reporters: [
        ['<rootDir>/jest/compact-reporter.cjs', {
            // optional tuning
            maxStackLines: 4,
            maxConsoleLines: 20,
            codeFrame: true,
            codeFrameLines: 2,
        }],
    ],
};