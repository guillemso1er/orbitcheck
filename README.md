# Orbicheck - API Data Hygiene Guard

Orbicheck is a monorepo project implementing a robust API for data validation, entity deduplication, and order risk assessment. The core focus is on e-commerce data hygiene, preventing fraud, duplicates, and invalid data through validators, fuzzy matching, and business rules. Built with TypeScript, Fastify, PostgreSQL, Redis, and Docker for scalability.

## Overview

**Product Scope (v1-v2):** Data validation for emails, phones, addresses, tax IDs; deduplication for customers, addresses, orders; order evaluation with risk scoring, auto-hold/tagging, P.O. box blocking, COD/RTO heuristics.

**Key Features:**
- **Validators:** Email (MX + disposable), Phone (E.164 + OTP), Address (normalization, geo, postal matching), Tax ID (LATAM/ES/US/EU VAT).
- **Deduplication:** Deterministic + fuzzy (pg_trgm) for entities.
- **Order Rules:** Risk scoring (0-100), actions (approve/hold/block), tags, reason codes.
- **Observability:** Audit logs, metrics, reason codes per rule.
- **API:** Secure (API keys, rate limiting, idempotency), documented with Swagger.

## Project Structure

- **apps/**
  - **api/**: Main API server (Fastify, validators, routes, migrations).
    - `src/`: Core code (server.ts, web.ts, validators/, jobs/, env.ts).
    - `migrations/`: Database schema (init.sql, dedupe_tables.sql).
    - `package.json`: Dependencies (fastify, pg, ioredis, twilio, libphonenumber-js, etc.).
    - `Dockerfile`: Container build.
  - **dashboard/**: Future admin UI (placeholder).
- **packages/**
  - **cli/**: Command-line tools (placeholder).
- **infra/**
  - **compose/**: Docker Compose (dev.compose.yml for local dev with Postgres/Redis/Caddy; prod.compose.yml for production).
  - **loki/grafana/prometheus/promtail/**: Observability stack for logs/metrics.
- **tests/**
  - **k6/**: Load tests (email.js, phone.js, address.js, logs.js).
- **bin/**
  - Scripts (k6 binary for testing).
- Root: `package.json` (pnpm workspace), `pnpm-workspace.yaml`, `.gitignore`, this README.

## Quick Start

### Prerequisites
- Node.js 18+, pnpm 8+, Docker/Docker Compose.
- PostgreSQL, Redis (via Docker).
- API keys: Twilio (for OTP), LocationIQ (optional geo), VIES WSDL (EU VAT).

### Setup
1. Clone and install:
   ```
   git clone <repo>
   cd orbicheck
   pnpm install
   ```

2. Environment (copy templates):
   - Root `.env`: General (none required).
   - `apps/api/.env`: 
     ```
     DATABASE_URL=postgres://postgres:postgres@localhost:5432/orbicheck
     REDIS_URL=redis://localhost:6379
     PORT=8080
     LOG_LEVEL=info
     NOMINATIM_URL=https://nominatim.openstreetmap.org
     LOCATIONIQ_KEY=your_key (optional)
     TWILIO_ACCOUNT_SID=your_sid
     TWILIO_AUTH_TOKEN=your_token
     TWILIO_PHONE_NUMBER=your_number
     VIES_WSDL_URL=https://ec.europa.eu/taxation_customs/vies/checkVatService.wsdl
     RATE_LIMIT_COUNT=300
     RETENTION_DAYS=90
     ```
   - `infra/compose/.env`: Services (DB/Redis passwords).

3. Database Setup:
   - Run migrations: `cd apps/api && pnpm run migrate` (uses drizzle-kit or similar; add if needed).
   - Seed API key: `cd apps/api && pnpm run seed` (creates dev project/key).

4. Run Locally:
   - Dev stack: `docker compose -f infra/compose/dev.compose.yml up -d` (starts Postgres, Redis, Caddy).
   - API: `cd apps/api && pnpm run dev` (runs on localhost:8080).
   - Docs: http://localhost:8080/documentation (Swagger UI).

5. Test:
   - Load tests: `cd tests && ./bin/k6 run k6/email.js` (adapt for others).
   - API key from seed output for auth.

### Production
- Use `infra/compose/prod.compose.yml` with secrets.
- Deploy API Docker image: `docker build -t orbicheck-api apps/api/`.
- Scale with Kubernetes or ECS; monitor with Grafana/Prometheus.

## API Documentation

See [apps/api/README.md](apps/api/README.md) for full endpoint details, schemas, examples, and reason codes.

## Development

- **Code Style:** ESLint/Prettier (run `pnpm lint`).
- **Migrations:** Add to `apps/api/migrations/` (timestamped .sql files).
- **Testing:** Unit (add Jest), integration (k6 load tests).
- **Observability:** Logs to Loki, metrics to Prometheus; view in Grafana (localhost:3000).
- **Jobs:** Disposable domains refresh on startup/cron (node-cron).

## Contributing

1. Fork, branch (feature/xxx).
2. Install: `pnpm install`.
3. Develop, test, commit.
4. PR to main.

## License

MIT. See LICENSE.

For issues, contact support@orbicheck.com.