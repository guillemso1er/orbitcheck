/* eslint-env node */
module.exports = {
    root: true,
    env: {
        node: true,
        es2023: true,
    },
    parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
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
    ignorePatterns: ["dist", "build", "coverage", ".eslintrc.cjs"],
    plugins: [
        "n",
        "promise",
        "import",
        "security",
        "sonarjs",
        "regexp",
        "unicorn",
        "eslint-comments",
        "simple-import-sort",
    ],
    extends: [
        "eslint:recommended",
        "plugin:n/recommended",
        "plugin:promise/recommended",
        "plugin:import/recommended",
        "plugin:security/recommended",
        "plugin:sonarjs/recommended",
        "plugin:regexp/recommended",
        "plugin:unicorn/recommended",
        "prettier",
    ],
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
        "no-shadow": "error",
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
    },

    overrides: [
        // TypeScript-specific safety (remove this block if you’re JS-only)
        {
            files: ["**/*.ts"],
            parser: "@typescript-eslint/parser",
            parserOptions: {
                tsconfigRootDir: __dirname,
                // use a dedicated tsconfig for linting if you have one; otherwise tsconfig.json
                project: ["./tsconfig.eslint.json", "./tsconfig.json"].filter(Boolean),
                sourceType: "module",
                ecmaVersion: "latest",
            },
            plugins: ["@typescript-eslint", "deprecation"],
            extends: [
                "plugin:@typescript-eslint/recommended",
                "plugin:@typescript-eslint/recommended-requiring-type-checking",
                "plugin:import/typescript",
            ],
            rules: {
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
                "@typescript-eslint/return-await": ["error", "in-try-catch"],
                "deprecation/deprecation": "warn",
                // Prefer TS versions of base rules where relevant
                "no-shadow": "off",
                "@typescript-eslint/no-shadow": "error",
            },
        },

        // Tests can be looser
        {
            files: ["**/*.test.*", "**/__tests__/**"],
            env: { node: true, jest: true },
            rules: {
                "no-console": "off",
                "@typescript-eslint/no-floating-promises": "off",
            },
        },

        // Allow sync/exit in scripts and tooling
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
            },
        },
    ],
};