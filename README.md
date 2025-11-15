# Orbitcheck

Orbitcheck is a validation and risk assessment platform for e-commerce and business operations. It provides comprehensive validation for emails, phones, addresses, tax IDs, and order risk scoring with deduplication.

## Technologies

- **Backend**: Node.js, TypeScript, Fastify 5.6.1
- **Frontend**: React 18.3.1, TypeScript, Vite 6.3.5
- **Database**: PostgreSQL 16
- **Cache**: Valkey 7.2 (Redis-compatible)
- **Testing**: Jest (unit), Vitest (integration), Playwright (E2E), k6 (load)
- **Deployment**: Docker, Docker Compose
- **Observability**: Loki, Prometheus, Promtail, Grafana, Statping, Uptime Kuma
- **Package Manager**: pnpm 9.12.0+
- **Monorepo Tool**: pnpm workspaces, Turbo

## Features

### Validators
- **Email**: Format (isemail), MX lookup (DNS), disposable domain check (disposable-email-domains list).
- **Phone**: Standardization to E.164 (libphonenumber-js); optional OTP via Twilio Verify.
- **Address**: Normalization (libpostal), geocoding/validation (Google Maps Geocoding API primary; LocationIQ fallback), postal code-city match (GeoNames dataset in Postgres), geo-validation (lat/lng in country bounding boxes), P.O. box detection.
- **Tax ID**: EU VAT via VIES SOAP (Spain NIF/NIE fallback), BR CPF/CNPJ, MX RFC, AR CUIT, CL RUT, PE RUC, CO NIT, ES NIF/NIE/CIF, US EIN.
- **Name**: Basic name validation and normalization.
- **Postal code-city matching**: GeoNames lookup + address geocode reconciliation.

### Dedupe/Entity Resolution
- Deterministic: Normalized email, phone, address hash.
- Fuzzy: pg_trgm similarity on name, street, city (threshold 0.85).
- Merge: /v1/dedupe/merge endpoint for customer/address records.

### Order Rules
- Auto-hold/tagging: Risk score-based actions (approve/hold/block).
- Block P.O. boxes: Risk +30 for PO box, configurable via score.
- COD/RTO heuristics: +20 COD, +50 if new customer + COD + region mismatch + disposable email.
- Fraud/risk: Disposable email, invalid phone, out-of-bounds geo (virtual/hotels), postal/city mismatch.

### Batch Operations
- **Batch Validation**: Process multiple emails, phones, addresses, or tax IDs in a single request.
- **Batch Deduplication**: Check multiple customers or addresses for duplicates.
- **Batch Order Evaluation**: Evaluate multiple orders for risk assessment.

### Billing & Plans
- Subscription management via Stripe integration with multiple tiers:
  - **Free**: 1,000 validations/month, 2 projects, 7-day log retention
  - **Starter**: $49/month, 10,000 validations/month, 5 projects, 90-day retention
  - **Growth**: $149/month, 50,000 validations/month, 15 projects, 180-day retention, webhooks
  - **Scale**: $399/month, 200,000 validations/month, 40 projects, 365-day retention, review queues
  - **Enterprise**: $1,500/month, unlimited usage, custom limits, dedicated support
- Usage-based pricing with overage charges for exceeding plan limits
- Self-service billing portal for plan upgrades and payment management

### Observability
- Audit logs: All events with reason codes, status, meta.
- Metrics: Per-rule counts in usage_daily (jsonb reason_counts).
- Per-project usage: Daily aggregations in usage_daily.

## Endpoints

### Validation
- POST /v1/validate/email: Email validation.
- POST /v1/validate/phone: Phone validation with optional OTP.
- POST /v1/validate/address: Address validation.
- POST /v1/validate/tax-id: Tax ID validation.
- POST /v1/validate/name: Name validation.
- POST /v1/normalize/address: Address normalization.

### Verification
- POST /v1/verify/phone: Verify OTP.

### Dedupe
- POST /v1/dedupe/customer: Customer dedupe.
- POST /v1/dedupe/address: Address dedupe.
- POST /v1/dedupe/merge: Merge records.

### Orders
- POST /v1/orders/evaluate: Order risk assessment.

### Batch Operations
- POST /v1/batch/validate: Batch validation.
- POST /v1/batch/dedupe: Batch deduplication.
- POST /v1/batch/orders: Batch order evaluation.

### Jobs
- GET /v1/jobs/{id}: Get status of async batch operation jobs.

### Authentication
Orbitcheck uses different authentication methods for different APIs:

- **Dashboard (session-based)**: For user registration, login, and web dashboard access.
- **Management API (Bearer token or session)**: For managing API keys, viewing usage, etc. Uses Personal Access Tokens (PATs) or session cookies.
- **Runtime API (API key)**: For validation, deduplication, and order evaluation endpoints.

### Dashboard Auth
- POST /auth/register: Register a new user (returns API key and PAT).
- POST /auth/login: Session-based login.
- POST /auth/logout: Logout and clear session.

### Management API (v1)
- GET /v1/api-keys: List API keys.
- POST /v1/api-keys: Create API key.
- DELETE /v1/api-keys/:id: Delete API key.
- GET /v1/pats: List Personal Access Tokens.
- POST /v1/pats: Create Personal Access Token.
- DELETE /v1/pats/{token_id}: Delete Personal Access Token.
- GET /v1/webhooks: List webhooks.
- POST /v1/webhooks: Create webhook.
- DELETE /v1/webhooks/{id}: Delete webhook.
- POST /v1/webhooks/test: Test webhook.
- GET /v1/data/logs: Get event logs.
- DELETE /v1/logs/{id}: Delete log entry.
- GET /v1/data/usage: Get usage statistics.
- GET /v1/rules: Get available rules.
- GET /v1/rules/builtin: Get builtin rules.
- GET /v1/rules/error-codes: Get error codes.
- GET /v1/rules/catalog: Get reason code catalog.
- POST /v1/rules/test: Test rules.
- POST /v1/rules/register: Register custom rules.
- DELETE /v1/rules/{id}: Delete custom rule.
- GET /v1/settings: Get project settings (country defaults, formatting, risk thresholds).
- PUT /v1/settings: Update project settings.
- POST /v1/data/erase: Erase user data.
- POST /v1/billing/checkout: Create billing checkout session.
- POST /v1/billing/portal: Access billing portal.
- GET /v1/users: List users.
- POST /v1/users: Create user.

### Projects & Plans
- GET /projects: List projects.
- POST /projects: Create project.
- DELETE /projects/{id}: Delete project.
- GET /user/plan: Get current plan.
- PATCH /user/plan: Update plan.
- GET /public/plans: List available plans.
- POST /user/plan/usage/check: Check usage limits.

### Usage Dashboard
- GET /usage: Project usage dashboard.

## Webhooks

Orbitcheck supports webhook management for real-time notifications and integration verification:

- GET /v1/webhooks: List configured webhooks for a project.
- POST /v1/webhooks: Create a new webhook endpoint.
- DELETE /v1/webhooks/{id}: Delete a webhook configuration.
- POST /v1/webhooks/test: Send test payloads (validation, order evaluation, custom) to webhook URLs.

## Applications

- **API (apps/api/)**: Fastify-based backend providing data validation, deduplication, order risk assessment, and management APIs. Connected to PostgreSQL (database), Valkey/Redis (cache), MinIO (object storage). Exposes metrics at /metrics for Prometheus monitoring.
- **Dashboard (apps/dashboard/)**: React frontend for user authentication, API key management, log exploration, usage monitoring, and webhook testing. Connects to the API for data and authentication.
- **Site (apps/site/)**: Static HTML/CSS/JS marketing website with documentation, pricing, legal pages, and interactive validation tools. Includes tools for testing email, phone, VAT, and tax ID validation. Served via Caddy reverse proxy in development.
- **Contracts (packages/contracts/)**: Shared OpenAPI specifications, TypeScript types, and generated API clients.

## Observability Services

Orbitcheck includes a comprehensive observability stack for monitoring, logging, and alerting:

- **Prometheus (localhost:9090)**: Metrics collection from the API service (/metrics endpoint). Provides time-series data for performance monitoring and is connected to Grafana for visualization.
- **Grafana (localhost:3000)**: Visualization dashboard connected to Prometheus and Loki. Default login: admin/admin. Displays metrics and logs from the API and other services.
- **Loki (localhost:3100)**: Log aggregation system that collects logs from all services via Promtail.
- **Promtail**: Log shipping agent that forwards container logs to Loki, automatically collecting API logs.
- **Statping (localhost:8082)**: Status monitoring tool that can be configured via its web UI to check health endpoints like the API's /health. Requires manual setup to monitor specific services.
- **Uptime Kuma (localhost:3001)**: Uptime monitoring with alerts for service availability. Can be configured via its web UI to monitor the API, Caddy proxy, and other endpoints.

### Error Tracking
- **Sentry/Glitchtip**: The API integrates with Sentry for error tracking. In production, errors are sent to a self-hosted Glitchtip instance (localhost:8030 in dev/prod compose). Set SENTRY_DSN environment variable to enable.

### Secrets Management
- **Infisical Backend (localhost:8085)**: Secrets management tool. Used for managing environment variables and secrets. Integrated with the API for secure configuration management.

Automatic connections: Prometheus scrapes API metrics, Promtail ships logs to Loki, Grafana visualizes data from Prometheus and Loki. Statping and Uptime Kuma require manual configuration via their web interfaces to monitor specific endpoints and provide value.

## Setup and Running the App

Orbitcheck is a monorepo with multiple applications: the API (backend server), the Dashboard (React frontend), the Site (static marketing site), and shared Contracts package.

### Prerequisites
- Node.js (v22+ for API, v20.10+ for dashboard)
- pnpm (package manager)
- PostgreSQL database
- Redis (for caching and rate limiting)
- Optional: Docker/Podman for containerized setup

### 1. Clone and Install Dependencies
From the root directory:
```
pnpm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env` (if available) or create `.env` in the root with the following (adjust as needed):
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orbitcheck
REDIS_URL=redis://localhost:6379
PORT=8080
LOG_LEVEL=info
LOCATIONIQ_KEY=your_locationiq_key (optional)
TWILIO_ACCOUNT_SID=your_twilio_sid (for OTP)
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=your_twilio_number
VIES_DOWN=true (to skip VIES if unavailable)
RATE_LIMIT_COUNT=30000 (for development)
S3_ENDPOINT=http://localhost:9000 (if using MinIO)
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=orbitcheck
```

Ensure your PostgreSQL and Redis servers are running locally or update the URLs accordingly.

### 3. Database Setup
Run migrations for the API:
```
pnpm --filter @orbitcheck/api run migrate:local
```

Seed initial data (creates a dev project and API key):
```
pnpm --filter @orbitcheck/api exec ts-node --require dotenv/config src/seed.ts
```
Note the output PROJECT_ID and API_KEY for authentication.

Alternatively, register a new user via the dashboard at http://localhost:5173 to get both a Personal Access Token (PAT) for management API access and an API key for runtime validation endpoints.

### 4. Running the API (Backend)
In one terminal, from the root:
```
pnpm --filter @orbitcheck/api run dev
```
The API will start on http://localhost:8080. Access Swagger docs at http://localhost:8080/documentation.

For production build:
```
pnpm --filter @orbitcheck/api run build
pnpm --filter @orbitcheck/api run start
```

Build the API Docker image locally:
```
 podman build -f apps/api/Dockerfile . -t test-api
```

### 5. Running the Dashboard (Frontend)
In another terminal, from the root:
```
pnpm --filter @orbitcheck/dashboard run dev
```
The dashboard will start on http://localhost:5173. Use the seeded API key to log in.

For production build:
```
pnpm --filter @orbitcheck/dashboard run build
```

### Containerized Setup (Development)
Use Docker Compose for full stack (DB, Redis, API, Dashboard, monitoring services):
```
podman compose -f infra/compose/dev.compose.yml up -d
```
Access services at:
- **Site**: http://localhost:8081 (marketing website)
- **API**: http://localhost:8080 (API docs at /documentation, metrics at /metrics)
- **Dashboard**: http://localhost:5173 (React frontend)
- **Prometheus**: http://localhost:9090 (metrics collection)
- **Grafana**: http://localhost:3000 (dashboards, default login: admin/admin)
- **Loki**: http://localhost:3100 (log aggregation)
- **Statping**: http://localhost:8082 (status monitoring)
- **Uptime Kuma**: http://localhost:3001 (uptime monitoring)

## Production Deployment

For production deployment, set up the services manually or adapt the development compose configuration:

### Prerequisites for Production
- Docker/Podman and Docker Compose
- Domain name and SSL certificates (managed by Caddy)
- Production environment variables (copy `.env.example` to `.env` and configure)

### Required Production Environment Variables
```
# Database
POSTGRES_PASSWORD=your_secure_postgres_password

# Object Storage (MinIO)
MINIO_ACCESS_KEY=your_minio_access_key
MINIO_SECRET_KEY=your_minio_secret_key

# Error Tracking
GLITCHTIP_SECRET=your_glitchtip_secret_key

# API Environment Variables (see .env.example for full list)
JWT_SECRET=your_jwt_secret
ENCRYPTION_KEY=your_32_character_encryption_key
LOCATIONIQ_KEY=your_locationiq_api_key
# ... other API variables
```

### Production Deployment Steps
1. **Configure Environment**: Copy and update `.env` with production values
2. **Build and Deploy**: Use Docker Compose or manual deployment (reference `infra/compose/dev.compose.yml` for service configuration)
3. **Database Migration**: Run migrations
   ```
   pnpm --filter @orbitcheck/api run migrate:ci
   ```
4. **Access Services**: Configure reverse proxy (Caddy) for your domain
   - **API**: https://yourdomain.com
   - **Dashboard**: https://yourdomain.com/dashboard
   - **Site**: https://yourdomain.com (marketing pages)
   - **Grafana**: https://yourdomain.com/grafana
   - **Prometheus**: https://yourdomain.com/prometheus
   - **MinIO Console**: https://yourdomain.com/minio

### Production Services
- **Caddy**: Reverse proxy with automatic SSL
- **PostgreSQL**: Database with persistent volumes
- **Valkey**: Redis-compatible cache
- **MinIO**: S3-compatible object storage
- **Glitchtip**: Self-hosted error tracking (alternative to Sentry)
- **Prometheus/Grafana/Loki**: Monitoring stack
- **Uptime Kuma**: Uptime monitoring
- **Statping**: Status page
- **Infisical**: Secrets management

### Security Considerations
- Change all default passwords and secrets
- Use strong, unique values for JWT_SECRET and ENCRYPTION_KEY
- Configure firewall rules for production ports
- Enable OIDC or other authentication methods as needed
- Regularly update Docker images and dependencies

## Testing

### Unit Tests (API)
The API uses Jest for unit tests and Vitest for integration tests.
From the root:
```
pnpm --filter @orbitcheck/api run test
```
Integration tests:
```
pnpm --filter @orbitcheck/api run test:int
```

Watch mode:
```
pnpm --filter @orbitcheck/api run test:watch
```

### E2E Tests (Dashboard)
The Dashboard uses Playwright for end-to-end tests.
From the root (or apps/dashboard):
```
pnpm --filter @orbitcheck/dashboard exec playwright test
```
Tests are in `apps/dashboard/e2e/`. Run specific tests:
```
pnpm --filter @orbitcheck/dashboard exec playwright test apiKeys.spec.ts
```
For UI mode (visual debugging):
```
pnpm --filter @orbitcheck/dashboard exec playwright test --ui
```

### Unit Tests (Dashboard)
The Dashboard has unit tests using Jest for component testing.
From the root:
```
pnpm --filter @orbitcheck/dashboard run test
```

Watch mode:
```
pnpm --filter @orbitcheck/dashboard run test:watch
```

### Load Testing
Load tests using k6 scripts in `tests/k6/`:
```
k6 run tests/k6/email.js
```
Adjust scripts for authentication and endpoints as needed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT - see [LICENSE](LICENSE) for details.