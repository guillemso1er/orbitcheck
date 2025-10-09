# Orbicheck Dashboard

The Dashboard is a React-based frontend application for managing Orbicheck API projects, API keys, logs, usage, and webhooks. It provides a user interface for authentication, monitoring, and configuration.

## Tech Stack
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: CSS Modules
- **Charts**: Chart.js
- **Testing**: Jest for unit tests, Playwright for E2E tests
- **HTTP Client**: Axios (via generated API client)

## Features

- **Authentication**: Login and logout using API keys for session management.
- **API Key Management**: Create, list, and delete API keys for runtime API access.
- **Log Explorer**: Browse and filter audit logs with pagination and search capabilities.
- **Usage Dashboard**: Visualize API usage statistics with interactive charts.
- **Webhook Tester**: Test webhook integrations by sending sample payloads to configured URLs.

## Setup and Running

### Prerequisites
- Node.js (v20+ recommended)
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
The Dashboard uses Jest for unit testing React components.
From the monorepo root:
```
pnpm --filter @orbicheck/dashboard run test
```

Watch mode:
```
pnpm --filter @orbicheck/dashboard run test:watch
```

Tests are located in `src/__tests__/`.

## Components
- **Login**: Authenticates with API key.
- **ApiKeys**: Manage API keys (create, list, delete).
- **LogExplorer**: View and filter audit logs with pagination.
- **UsageDashboard**: Visualize usage metrics with charts (Chart.js).
- **WebhookTester**: Test webhook configurations.

For development, hot-reload is enabled via Vite. Ensure CORS is allowed on the API for localhost:5173.

See the root [README.md](../README.md) for full monorepo setup and API details.