import tsParser from '@typescript-eslint/parser';
import rootConfig from '../../eslint.config.mjs';

export default [
    ...rootConfig,
    {
        files: ['**/*.{js,ts}'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
];
