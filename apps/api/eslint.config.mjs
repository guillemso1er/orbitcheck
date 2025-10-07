/* eslint-env node */
import tsParser from '@typescript-eslint/parser';
import n from 'eslint-plugin-n';
import promise from 'eslint-plugin-promise';
import importPlugin from 'eslint-plugin-import';
import security from 'eslint-plugin-security';
import regexp from 'eslint-plugin-regexp';
import unicorn from 'eslint-plugin-unicorn';
import eslintComments from 'eslint-plugin-eslint-comments';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import ts from '@typescript-eslint/eslint-plugin';
import deprecation from 'eslint-plugin-deprecation';

export default [
  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        parser: tsParser,
        parserOptions: {
            project: "./tsconfig.json",
        },
        globals: {
            Buffer: 'readonly',
            console: 'readonly',
            exports: 'writable',
            global: 'readonly',
            module: 'readonly',
            process: 'readonly',
            __dirname: 'readonly',
            __filename: 'readonly',
            require: 'readonly',
        },
    },
    settings: {
        // Set your Node version target so deprecated/unsupported APIs are flagged accurately
        n: { tryExtensions: [".js", ".mjs", ".cjs", ".ts"], version: ">=18.18" },
        // Helps eslint-plugin-import resolve TS paths when using TS
        "import/resolver": {
            node: { extensions: [".js", ".mjs", ".cjs", ".ts"] },
            typescript: {},
        },
    },
    // Make sure to ignore the new file name
    ignores: ["dist", "build", "coverage"],
    plugins: {
        n,
        promise,
        import: importPlugin,
        security,
        regexp,
        unicorn,
        'eslint-comments': eslintComments,
        'simple-import-sort': simpleImportSort,
        '@typescript-eslint': ts,
        deprecation
    },
    rules: {
        // Pragmatic Node/Fastify safety
        "n/no-sync": "error", // ban fs.*Sync (blocks event loop)
        "n/no-process-exit": "error",
        "n/no-deprecated-api": "error",

        // Avoid subtle async bugs / hangs
        "consistent-return": "error",
        "no-async-promise-executor": "error",
        "no-promise-executor-return": "error",
        "require-atomic-updates": "error",
        "no-unreachable-loop": "error",
        "no-unsafe-finally": "error",
        "no-await-in-loop": "warn",
        "no-template-curly-in-string": "warn",

        // Promises: prefer async/await patterns
        "promise/no-new-statics": "error",
        "promise/no-return-in-finally": "error",
        "promise/no-nesting": "warn",
        "promise/prefer-await-to-then": "warn",
        "promise/prefer-await-to-callbacks": "warn",

        // Imports hygiene
        "import/no-duplicates": "error",
        "import/no-extraneous-dependencies": [
            "error",
            {
                devDependencies: [
                    "**/*.test.*",
                    "**/__tests__/**",
                    "scripts/**",
                    "*.config.*",
                    "**/vite.config.*",
                    "**/vitest.config.*",
                ],
            },
        ],
        "import/no-cycle": ["warn", { maxDepth: 2 }],
        "simple-import-sort/imports": "error",
        "simple-import-sort/exports": "error",

        // General correctness
        "no-console": ["warn", { allow: ["warn", "error"] }],
        "no-void": ["error", { allowAsStatement: true }], // allow `void fn()` to mark intentionally un-awaited
        "no-shadow": "off",
        "@typescript-eslint/no-shadow": "error",
        "prefer-const": "error",
        "object-shorthand": "error",

        // ESLint directive hygiene
        "eslint-comments/no-unused-disable": "error",
        "eslint-comments/disable-enable-pair": "warn",
        "eslint-comments/no-unlimited-disable": "error",

        // Unicorn tweaks (keep it pragmatic)
        "unicorn/prefer-module": "off",
        "unicorn/filename-case": "off",
        "unicorn/no-null": "off",
        "unicorn/no-process-exit": "off", // handled by n/no-process-exit
        "unicorn/no-useless-undefined": "off",
        "unicorn/no-array-reduce": "off",

        // Regex DoS flags
        "regexp/no-super-linear-backtracking": "warn",

        // Fastify-specific “no hidden hangs” guards
        "no-restricted-syntax": [
            "error",
            // Enforce async hooks (no 'done' callback style)
            {
                selector:
                    "CallExpression[callee.property.name='addHook'] arguments > :matches(FunctionExpression, ArrowFunctionExpression).params[length>=3]",
                message: "Use async hooks (no 'done' callback).",
            },
            // Enforce async route handlers (no 'done' callback style)
            {
                selector:
                    "CallExpression[callee.property.name=/^(get|head|post|put|delete|options|patch|all|route)$/] arguments > :matches(FunctionExpression, ArrowFunctionExpression).params[length>=3]",
                message:
                    "Use async Fastify handlers (no 'done' callback). Return a value or a Promise.",
            },

            // Block event-loop blockers beyond fs.*Sync (which n/no-sync already covers)
            {
                selector:
                    "CallExpression[callee.object.name='child_process'][callee.property.name=/.*Sync$/]",
                message:
                    "Avoid blocking the event loop in API code. Use the async child_process APIs.",
            },
            {
                selector:
                    "CallExpression[callee.object.name='zlib'][callee.property.name=/.*Sync$/]",
                message:
                    "Avoid blocking the event loop in API code. Use the async zlib APIs.",
            },
            {
                selector:
                    "CallExpression[callee.object.name='crypto'][callee.property.name=/.*Sync$/]",
                message:
                    "Avoid blocking the event loop in API code. Use the async crypto APIs.",
            },
            // crypto APIs that are sync when called without callbacks
            {
                selector:
                    "CallExpression[callee.object.name='crypto'][callee.property.name='randomBytes'][arguments.length<2]",
                message:
                    "crypto.randomBytes without a callback is synchronous. Use crypto.randomBytes(size, cb).",
            },
            {
                selector:
                    "CallExpression[callee.object.name='crypto'][callee.property.name='randomFill'][arguments.length<3]",
                message:
                    "crypto.randomFill without a callback is synchronous. Use crypto.randomFill(buffer, offset, size, cb).",
            },
            // Node deprecation footgun
            {
                selector: "NewExpression[callee.name='Buffer']",
                message:
                    "Use Buffer.from or Buffer.alloc instead of the deprecated Buffer constructor.",
            },
        ],

        // TypeScript-specific safety
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-misused-promises": [
            "error",
            { checksVoidReturn: { attributes: false, returns: true } },
        ],
        "@typescript-eslint/await-thenable": "error",
        "@typescript-eslint/no-confusing-void-expression": [
            "error",
            { ignoreArrowShorthand: true, ignoreVoidOperator: true },
        ],
        "@typescript-eslint/consistent-type-imports": "error",
        "@typescript-eslint/explicit-function-return-type": [
            "warn",
            { allowExpressions: true, allowTypedFunctionExpressions: true },
        ],
        "@typescript-eslint/no-unused-vars": [
            "warn",
            { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/return-await": "off", // disable for style
        "deprecation/deprecation": "warn",

        // Disable some rules for better pragmatism
        "consistent-return": "off",
        "prefer-const": "off",
        "@typescript-eslint/no-shadow": "off",
        "unicorn/prevent-abbreviations": "off",
        "unicorn/no-await-expression-member": "off",
        "unicorn/prefer-top-level-await": "off",
        "unicorn/no-useless-spread": "off",
        "unicorn/import-style": "off",
    },

  },

  {
    files: ["**/*.test.*", "**/__tests__/**"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "n/no-unpublished-import": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "prefer-const": "off",
      "no-empty": "off",
      "deprecation/deprecation": "off",
    },
  },

  {
    files: [
      "scripts/**",
      "migrations/**",
      "*.config.*",
      "**/vite.config.*",
      "**/vitest.config.*",
    ],
    rules: {
      "n/no-process-exit": "off",
      "n/no-sync": "off",
      "@typescript-eslint/no-require-imports": "off",
      "import/no-extraneous-dependencies": "off",
      "n/no-extraneous-import": "off",
      "promise/param-names": "off",
    },
  },

  {
    files: ["src/routes/**"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  {
    files: ["src/hooks.ts", "src/jobs/**", "src/plugins/**", "src/seed.ts", "src/server.ts", "src/startup-guard.ts", "src/types/**", "src/validators/**"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/await-thenable": "off",
      "n/no-sync": "off",
      "promise/param-names": "off",
      "no-promise-executor-return": "off",
      "import/no-extraneous-dependencies": "off",
      "n/no-extraneous-import": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];