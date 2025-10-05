# Orbicheck API

Orbicheck is a validation and risk assessment API for e-commerce and business operations. It provides comprehensive validation for emails, phones, addresses, tax IDs, and order risk scoring with deduplication.

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

### Auth/Dashboard
- POST /auth/login: JWT login.
- GET /api/keys: List API keys.
- POST /api/keys: Create API key.
- DELETE /api/keys/:id: Delete API key.
- POST /webhooks: Create webhook.
- GET /webhooks: List webhooks.
- DELETE /webhooks/:id: Delete webhook.

### Usage
- GET /usage: Project usage dashboard.

## Setup and Running the App

Orbicheck is a monorepo with two main applications: the API (backend server) and the Dashboard (React frontend).

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

### Containerized Setup (Optional)
Use Docker Compose for full stack (DB, Redis, API, Dashboard):
```
podman compose -f infra/compose/dev.compose.yml up -d
```
Access API at http://localhost:8080 and Dashboard at http://localhost:5173.

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
Currently, no dedicated unit tests for the Dashboard. Consider adding Jest or Vitest for component testing in the future.

### Load Testing
Load tests using k6 scripts in `tests/k6/`:
```
k6 run tests/k6/email.js
```
Adjust scripts for authentication and endpoints as needed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT