# Orbicheck

Orbicheck is a validation and risk assessment platform for e-commerce and business operations. It provides comprehensive validation for emails, phones, addresses, tax IDs, and order risk scoring with deduplication.

## Technologies

- **Backend**: Node.js, TypeScript, Fastify
- **Frontend**: React 18, TypeScript, Vite
- **Database**: PostgreSQL
- **Cache**: Redis
- **Testing**: Jest (unit), Playwright (E2E), k6 (load)
- **Deployment**: Docker, Docker Compose
- **Observability**: Loki, Prometheus, Promtail, Grafana, Statping, Uptime Kuma
- **Package Manager**: pnpm
- **Monorepo Tool**: pnpm workspaces

## Features

### Validators
- **Email**: Format (isemail), MX lookup (DNS), disposable domain check (disposable-email-domains list).
- **Phone**: Standardization to E.164 (libphonenumber-js); optional OTP via Twilio Verify.
- **Address**: Normalization (libpostal), geocoding/validation (Google Maps Geocoding API primary; LocationIQ fallback), postal code-city match (GeoNames dataset in Postgres), geo-validation (lat/lng in country bounding boxes), P.O. box detection.
- **Tax ID**: EU VAT via VIES SOAP (Spain NIF/NIE fallback), BR CPF/CNPJ, MX RFC, AR CUIT, CL RUT, PE RUC, CO NIT, ES NIF/NIE/CIF, US EIN.
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

### Observability
- Audit logs: All events with reason codes, status, meta.
- Metrics: Per-rule counts in usage_daily (jsonb reason_counts).
- Per-project usage: Daily aggregations in usage_daily.

## Endpoints

### Validation
- POST /v1/validate/email: Email validation.
- POST /v1/validate/phone: Phone validation with optional OTP.
- POST /v1/verify/phone: Verify OTP.
- POST /v1/validate/address: Address validation.
- POST /v1/validate/tax-id: Tax ID validation.

### Dedupe
- POST /v1/dedupe/customer: Customer dedupe.
- POST /v1/dedupe/address: Address dedupe.
- POST /v1/dedupe/merge: Merge records.

### Orders
- POST /v1/orders/evaluate: Order risk assessment.

### Authentication
Orbicheck uses different authentication methods for different APIs:

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
- POST /v1/webhooks/test: Test webhook.
- GET /v1/data/logs: Get event logs.
- GET /v1/data/usage: Get usage statistics.
- GET /v1/rules: Get available rules.
- GET /v1/rules/catalog: Get reason code catalog.
- POST /v1/rules/register: Register custom rules.

### Usage Dashboard
- GET /usage: Project usage dashboard.

## Webhooks

Orbicheck supports webhook testing for integration verification:

- POST /v1/webhooks/test: Send test payloads (validation, order evaluation, custom) to webhook URLs.

## Applications

- **API (apps/api/)**: Fastify-based backend providing data validation, deduplication, order risk assessment, and management APIs. Connected to PostgreSQL (database), Valkey/Redis (cache), MinIO (object storage). Exposes metrics at /metrics for Prometheus monitoring.
- **Dashboard (apps/dashboard/)**: React frontend for user authentication, API key management, log exploration, usage monitoring, and webhook testing. Connects to the API for data and authentication.
- **Site (apps/site/)**: Static HTML/CSS/JS marketing website with documentation, pricing, legal pages, and interactive validation tools. Includes tools for testing email, phone, VAT, and tax ID validation. Served via Caddy reverse proxy in development.
- **Contracts (packages/contracts/)**: Shared OpenAPI specifications, TypeScript types, and generated API clients.

## Observability Services

Orbicheck includes a comprehensive observability stack for monitoring, logging, and alerting:

- **Prometheus (localhost:9090)**: Metrics collection from the API service (/metrics endpoint). Provides time-series data for performance monitoring and is connected to Grafana for visualization.
- **Grafana (localhost:3000)**: Visualization dashboard connected to Prometheus and Loki. Default login: admin/admin. Displays metrics and logs from the API and other services.
- **Loki (localhost:3100)**: Log aggregation system that collects logs from all services via Promtail.
- **Promtail**: Log shipping agent that forwards container logs to Loki, automatically collecting API logs.
- **Statping (localhost:8082)**: Status monitoring tool that can be configured via its web UI to check health endpoints like the API's /health. Requires manual setup to monitor specific services.
- **Uptime Kuma (localhost:3001)**: Uptime monitoring with alerts for service availability. Can be configured via its web UI to monitor the API, Caddy proxy, and other endpoints.

### Error Tracking
- **Sentry/Glitchtip**: The API integrates with Sentry for error tracking. In production, errors are sent to a self-hosted Glitchtip instance (localhost:8030 in dev/prod compose). Set SENTRY_DSN environment variable to enable.

### Secrets Management
- **Infisical (localhost:8081 in prod)**: Secrets management tool running in production. Currently not integrated with the API; can be used for managing environment variables and secrets separately.

Automatic connections: Prometheus scrapes API metrics, Promtail ships logs to Loki, Grafana visualizes data from Prometheus and Loki. Statping and Uptime Kuma require manual configuration via their web interfaces to monitor specific endpoints and provide value.

## Setup and Running the App

Orbicheck is a monorepo with multiple applications: the API (backend server), the Dashboard (React frontend), the Site (static marketing site), and shared Contracts package.

### Prerequisites
- Node.js (v20+ recommended)
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
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orbicheck
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
S3_BUCKET=orbicheck
```

Ensure your PostgreSQL and Redis servers are running locally or update the URLs accordingly.

### 3. Database Setup
Run migrations for the API:
```
pnpm --filter @orbicheck/api run migrate
```

Seed initial data (creates a dev project and API key):
```
pnpm --filter @orbicheck/api exec ts-node --require dotenv/config src/seed.ts
```
Note the output PROJECT_ID and API_KEY for authentication.

Alternatively, register a new user via the dashboard at http://localhost:5173 to get both a Personal Access Token (PAT) for management API access and an API key for runtime validation endpoints.

### 4. Running the API (Backend)
In one terminal, from the root:
```
pnpm --filter @orbicheck/api run dev
```
The API will start on http://localhost:8080. Access Swagger docs at http://localhost:8080/documentation.

For production build:
```
pnpm --filter @orbicheck/api run build
pnpm --filter @orbicheck/api run start
```

### 5. Running the Dashboard (Frontend)
In another terminal, from the root:
```
pnpm --filter @orbicheck/dashboard run dev
```
The dashboard will start on http://localhost:5173. Use the seeded API key to log in.

For production build:
```
pnpm --filter @orbicheck/dashboard run build
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

For production deployment, use the production Docker Compose configuration:

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
2. **Build and Deploy**: Run the production compose
   ```
   podman compose -f infra/compose/prod.compose.yml up -d
   ```
3. **Database Migration**: Run migrations in the API container
   ```
   podman compose -f infra/compose/prod.compose.yml exec api pnpm run migrate
   ```
4. **Access Services**:
   - **API**: https://yourdomain.com (reverse proxied by Caddy)
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
The API uses Jest for unit and integration tests.
From the root:
```
pnpm --filter @orbicheck/api run test
```
This runs tests in `apps/api/src/__tests__/`. Coverage reports are generated if configured.

Watch mode:
```
pnpm --filter @orbicheck/api run test:watch
```

### E2E Tests (Dashboard)
The Dashboard uses Playwright for end-to-end tests.
From the root (or apps/dashboard):
```
pnpm --filter @orbicheck/dashboard exec playwright test
```
Tests are in `apps/dashboard/e2e/`. Run specific tests:
```
pnpm --filter @orbicheck/dashboard exec playwright test apiKeys.spec.ts
```
For UI mode (visual debugging):
```
pnpm --filter @orbicheck/dashboard exec playwright test --ui
```

### Unit Tests (Dashboard)
The Dashboard has unit tests using Jest for component testing.
From the root:
```
pnpm --filter @orbicheck/dashboard run test
```

Watch mode:
```
pnpm --filter @orbicheck/dashboard run test:watch
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