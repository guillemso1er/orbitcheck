import tsParser from '@typescript-eslint/parser';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import rootConfig from '../../eslint.config.mjs';

export default [
    ...rootConfig,
    {
        ignores: [
            '.graphqlrc.ts',
            'shopify.app.orbitcheck.toml',
            'shopify.web.toml',
            'prisma/',
            'extensions/',
            'public/',
            'docs/',
            'node_modules/',
            '.react-router/',
            'app/types/',
        ],
    },
    {
        files: ['**/*.{js,jsx,ts,tsx}'],
        plugins: {
            react: reactPlugin,
            'jsx-a11y': jsxA11y,
            'react-hooks': reactHooks,
        },
        languageOptions: {
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        settings: {
            react: {
                version: 'detect',
            },
            formComponents: ['Form'],
            linkComponents: [
                { name: 'Link', linkAttribute: 'to' },
                { name: 'NavLink', linkAttribute: 'to' },
            ],
            'import/resolver': {
                typescript: {},
            },
        },
        rules: {
            'react/no-unknown-property': ['error', { ignore: ['variant'] }],
            ...reactPlugin.configs.recommended.rules,
            ...reactPlugin.configs['jsx-runtime'].rules,
            ...reactHooks.configs.recommended.rules,
            ...jsxA11y.configs.recommended.rules,
        },
    },
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
];