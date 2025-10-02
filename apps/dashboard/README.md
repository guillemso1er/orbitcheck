# Orbicheck Dashboard

The Dashboard is a React-based frontend application for managing Orbicheck API projects, API keys, logs, usage, and webhooks. It provides a user interface for authentication, monitoring, and configuration.

## Setup and Running

### Prerequisites
- Node.js (v18+)
- pnpm

### Install Dependencies
From the monorepo root:
```
pnpm install
```

### Environment
The Dashboard connects to the API at `http://localhost:8080` by default. Ensure the API is running. No separate `.env` is needed for the Dashboard, but API keys are managed via the UI after seeding the database.

### Run Development Server
From the monorepo root:
```
pnpm --filter @orbicheck/dashboard run dev
```

Access the Dashboard at http://localhost:5173.

### Build for Production
```
pnpm --filter @orbicheck/dashboard run build
```

The build output is in `dist/`. Serve it with a static server (e.g., via Vite preview or nginx).

## Testing

### E2E Tests (Playwright)
Run end-to-end tests to simulate user interactions (login, API keys, log explorer, usage dashboard):
```
pnpm --filter @orbicheck/dashboard exec playwright test
```

- Tests are in `e2e/`.
- Run a specific test: `pnpm --filter @orbicheck/dashboard exec playwright test login.spec.ts`
- UI mode for visual debugging: `pnpm --filter @orbicheck/dashboard exec playwright test --ui`
- Headless mode (default): Uses Chromium; ensure API is running for tests.

### Unit Tests
Currently, no unit tests are configured for the Dashboard components. Consider adding Vitest or Jest for testing React components in the future.

## Components
- **Login**: Authenticates with API key.
- **ApiKeys**: Manage API keys (create, list, delete).
- **LogExplorer**: View and filter audit logs with pagination.
- **UsageDashboard**: Visualize usage metrics with charts (Chart.js).
- **WebhookTester**: Test webhook configurations.

For development, hot-reload is enabled via Vite. Ensure CORS is allowed on the API for localhost:5173.

See the root [README.md](../README.md) for full monorepo setup and API details.