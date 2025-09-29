# Orbicheck - API Data Hygiene Guard

Orbicheck is a monorepo project implementing a robust API for data validation, entity deduplication, and order risk assessment. The core focus is on e-commerce data hygiene, preventing fraud, duplicates, and invalid data through validators, fuzzy matching, and business rules. Built with TypeScript, Fastify, PostgreSQL, Redis, and Podman for scalability.

Recent improvements include:
- Enhanced server startup logic with separate build and start functions for better testability and modularity.
- Refactored route registration in web.ts with dedicated authentication and middleware functions for improved maintainability.
- Added domain-level caching in email validation to optimize DNS lookups and disposable checks, reducing latency in critical paths.
- Improved error handling in validation routes with try-catch blocks and consistent error responses.
- Expanded JSDoc documentation in validators and hooks for better code readability and IDE support.

## Overview

**Product Scope (v1-v2):** Data validation for emails, phones, addresses, tax IDs; deduplication for customers, addresses, orders; order evaluation with risk scoring, auto-hold/tagging, P.O. box blocking, COD/RTO heuristics.

**AI-Friendly Notes:** This repo is optimized for AI-assisted development. See the "AI Assistance Guidelines" section below for tool usage tips, common pitfalls, and step-by-step setup that avoids extra queries or errors.

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
  - **edge/**: OpenResty configuration for edge routing and caching.
- **packages/**
  - **cli/**: Command-line tools (placeholder).
  - **shared/**: Shared types and reason codes.
- **infra/**
  - **compose/**: Podman Compose (dev.compose.yml for local dev with Postgres/Redis/Caddy; prod.compose.yml for production).
  - **loki/grafana/prometheus/promtail/**: Observability stack for logs/metrics.
- **scripts/**: Importers and maintenance (e.g., geonames-importer.ts).
- **tests/**
  - **k6/**: Load tests (email.js, phone.js, address.js, logs.js).
- **bin/**
  - Scripts (k6 binary for testing).
- Root: `package.json` (pnpm workspace), `pnpm-workspace.yaml`, `.gitignore`, this README.

## AI Assistance Guidelines

This repository is structured to facilitate AI-driven development and modifications. When using an AI assistant (e.g., in Code mode):

- **Initial Exploration:** Start by reviewing this README.md for high-level overview and [apps/api/README.md](apps/api/README.md) for API specifics. Use tools like `list_files` or `list_code_definition_names` to map the codebase structure.
- **File Access:** Always use `read_file` to fetch exact current contents before proposing changes. Reference files with paths relative to the workspace root (/home/bastiat/Repositories/orbicheck).
- **Editing Code:** Prefer `apply_diff` for targeted updates to existing files (e.g., adding a new validator in `apps/api/src/validators/`). Use `write_to_file` only for new files or full rewrites. Ensure TypeScript compatibility and add JSDoc comments for functions.
- **Common Tasks:**
  - Adding features: Extend routes in `apps/api/src/routes/`, validators in `apps/api/src/validators/`.
  - Database changes: Add SQL migrations in `apps/api/migrations/` with timestamps.
  - Testing: Write Jest tests in `apps/api/src/__tests__/` or k6 load tests in `tests/k6/`.
  - Infrastructure: Modify Podman Compose in `infra/compose/` for dev/prod environments.
- **Best Practices for AI Tasks:** Break complex changes into steps using a todo list (`update_todo_list`). Run `pnpm lint` after changes via `execute_command`. Confirm tool successes before proceeding.
- **Dependencies:** Managed via pnpm workspace; install with `pnpm install` from root.
- **Running the Project:** Follow Quick Start below; use `execute_command` for commands like `pnpm run dev` in `apps/api`.

**Troubleshooting Common Issues (AI-Specific):**
- **Podman Compose YAML Errors:** If `podman compose up` fails with "additional properties not allowed" for services like statping/uptime-kuma, ensure they are indented under `services:` (2 spaces from root). Use `read_file` on `infra/compose/dev.compose.yml` to verify indentation before running.
- **BullMQ Redis Error ("maxRetriesPerRequest must be null"):** When starting the API (`pnpm run dev`), add `{ maxRetriesPerRequest: null }` to IORedis constructor in `apps/api/src/server.ts` line ~81. Example: `new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })`.
- **Seed Script Fails (SASL/Password Error):** Run with explicit dotenv: `cd apps/api && pnpm exec ts-node --require dotenv/config src/seed.ts`. Ensure `DATABASE_URL` in `.env` matches Postgres setup (e.g., `postgres://postgres:postgres@localhost:5432/orbicheck`).
- **GeoNames Importer 404 Error:** The URL in `scripts/geonames-importer.ts` (line 11) is outdated. GeoNames postal data is now country-specific (e.g., download AR.zip for Argentina from http://download.geonames.org/export/zip/ and update script to handle multiple files). For quick setup, skip or use Nominatim for geo without import.
- **Unit Tests Fail with 404/401:** Tests in `apps/api/src/__tests__/web.test.ts` expect routes under `/v1/` (e.g., `/v1/validate/email`). Ensure server is mocked correctly or run integration tests against running API. For auth failures, use seeded API key from seed output.
- **Load Tests Timeout (k6):** Tests hit edge proxy at localhost:8081 (OpenResty), which proxies to API at 8080. If timing out, verify edge config in `apps/edge/nginx.conf` points to `api:8080` in compose network. Run API first (`pnpm run dev`), then k6: `./bin/k6 run tests/k6/email.js`.
- **ts-node Not Found:** Use `pnpm exec ts-node` for scripts outside package scripts.
- **Podman vs Docker:** Commands use `podman compose`; if using Docker, replace with `docker compose`.

If the AI needs clarification, it should use `ask_followup_question` sparingly, prioritizing tool-based discovery.

**Key AI Workflow:**
- Use `list_code_definition_names` on `apps/api/src/` to map routes/validators/jobs.
- Search for patterns with `search_files` (e.g., regex for reason codes: `reason_codes.*email` in `apps/api/src/`).
- Before edits, read related files (e.g., `apps/api/src/server.ts`, `apps/api/src/web.ts`) to understand integrations like BullMQ queues or Fastify plugins.
- After changes, verify with `execute_command` for `pnpm lint`, `pnpm test`, and container rebuild if needed (`podman compose restart`).

## Quick Start

### Prerequisites
- Node.js 18+, pnpm 8+ (install via `curl -fsSL https://get.pnpm.io/install.sh | sh -` if needed).
- Podman (preferred over Docker for this setup; install via `sudo pacman -S podman` on Arch Linux).
- Optional: k6 for load testing (binary at `./bin/k6`; download from https://k6.io/docs/get-started/installation/ if missing).
- API keys: Twilio SID/token/phone for OTP validation; LocationIQ or Google Maps key for enhanced geocoding (Nominatim is free fallback); VIES WSDL for EU VAT (built-in URL works).
- System: Linux (tested on Arch); ensure `podman-compose` or `podman compose` is available (Arch: `sudo pacman -S podman-compose` if needed, but native `podman compose` preferred).

### Setup
1. Clone and install:
   ```
   git clone <repo>
   cd orbicheck
   pnpm install  # Already up-to-date in most cases; lockfile ensures consistency.
   ```
   **AI Tip:** If `pnpm install` warns about ignored build scripts (e.g., msgpackr-extract), run `pnpm approve-builds` to allow safe ones.

2. Environment (copy templates):
   - Root `.env`: General (minimal; e.g., `DATABASE_URL=postgres://postgres:postgres@localhost:5432/orbicheck` for local overrides).
   - `apps/api/.env`: Database, Redis, API keys (copy from template if needed):
     ```
     DATABASE_URL=postgres://postgres:postgres@postgres:5432/orbicheck  # Use 'postgres' host in container; localhost for direct run.
     REDIS_URL=redis://valkey:6379  # 'valkey' in container; localhost:6379 for direct.
     PORT=8080
     LOG_LEVEL=info
     NOMINATIM_URL=https://nominatim.openstreetmap.org
     LOCATIONIQ_KEY=your_key (optional; rate-limited, use for production geo).
     GOOGLE_GEOCODING_KEY=your_key (optional fallback; set USE_GOOGLE_FALLBACK=true for better accuracy).
     USE_GOOGLE_FALLBACK=false
     TWILIO_ACCOUNT_SID=your_sid (required for phone OTP; skip for validation-only).
     TWILIO_AUTH_TOKEN=your_token
     TWILIO_PHONE_NUMBER=your_number (e.g., +1xxxxxxxxxx).
     VIES_WSDL_URL=https://ec.europa.eu/taxation_customs/vies/checkVatService.wsdl  # EU VAT; set VIES_DOWN=true in container env to disable if slow.
     RATE_LIMIT_COUNT=300  # Requests/min; increase to 30000 in container for load tests.
     RETENTION_DAYS=90  # Log retention.
     SENTRY_DSN=your_dsn (optional; integrates with GlitchTip at localhost:8030 in compose).
     ```
     **AI Tip:** For container runs, use service names (postgres, valkey) in URLs. For local dev without compose, use localhost. Always load with `--require dotenv/config` for scripts.
   - No separate `infra/compose/.env` needed; defaults in yml (POSTGRES_PASSWORD=postgres, etc.). Override for prod (e.g., stronger MinIO keys).

3. Database Setup:
   - Run migrations: `cd apps/api && pnpm run migrate` (applies SQL files in `migrations/` via node-pg-migrate). Output: "No migrations to run!" if up-to-date (init and dedupe tables already applied).
     **AI Tip:** Migrations are timestamped .sql; add new ones with `touch apps/api/migrations/$(date +%s)_description.sql` and edit. Verify with `psql $DATABASE_URL -l` or `read_file` on migration files.
   - Seed data: `cd apps/api && pnpm exec ts-node --require dotenv/config src/seed.ts` (loads dev project and API key into DB). Output example:
     ```
     PROJECT_ID=502ee0d2-912c-4782-be54-bd4de33038e1
     API_KEY=ok_test_b56fe58b1cad24b0dec2367c1f2595d97cde
     ```
     Use this API_KEY in Authorization: Bearer headers for authenticated requests (e.g., /order/evaluate). If SASL/password error, confirm DATABASE_URL and dotenv load.
     **AI Tip:** Seed runs once; re-run to regenerate keys. PROJECT_ID scopes usage/logs.
   - Import GeoNames (optional for postal/geo accuracy): `pnpm exec ts-node --require dotenv/config scripts/geonames-importer.ts`.
     Fails with 404 (outdated URL). Workaround: Download country zips manually from http://download.geonames.org/export/zip/ (e.g., AR.zip for Argentina), unzip to `./data/geonames/`, update script line 11 to loop over files (e.g., forEach zip in dir). Or skip—address validation uses Nominatim (free, but slower/rate-limited).
     **AI Tip:** For AI edits, use `apply_diff` on `scripts/geonames-importer.ts` to fix URL or add multi-file support. Table: geonames_postal (postal_code, place_name, admin_name1, lat, lng, country).

4. Run Locally:
   - Dev stack: `podman compose -f infra/compose/dev.compose.yml up -d` (from root; starts all services: Postgres@5432, Valkey@6379, MinIO@9000/9001, Edge@8081, API@8080 internal, monitoring stack). Wait for healthy (use `podman ps`).
     **Common Issue:** If "additional properties not allowed" error, verify yml indentation (services: at root level, 2 spaces for subkeys). Use `read_file` on `infra/compose/dev.compose.yml` to check.
     **Podman vs Docker:** Use `podman compose` (native); if Docker, replace with `docker compose`. No sudo needed if user namespaces enabled.
     **AI Tip:** Services depend on healthy DB/Redis; logs via `podman logs compose-api-1`. Restart specific: `podman compose restart api`.
   - API Access:
     - Direct: http://localhost:8080 (binds to 0.0.0.0 in container; works from host).
     - Via Edge Proxy: http://localhost:8081 (OpenResty caching/routing; may 502 if API bind issue—logs show 127.0.0.1 but accessible via network IP 10.89.x.x). Workaround: Use direct 8080 for testing; fix by ensuring no HOST=127.0.0.1 in env.
     - Dev without compose: `cd apps/api && pnpm run dev` (uses localhost DB/Redis; PORT=8080).
     **AI Tip:** In container, API logs: "Server listening at http://127.0.0.1:8080" (Fastify log artifact) and network IP; verify with `podman exec -it compose-api-1 curl http://localhost:8080/health`.
   - Swagger Docs: http://localhost:8080/documentation (add ?apiKey=your_key for auth preview).
   - Observability:
     - Grafana: localhost:3000 (default admin/admin; dashboards provisioned for Prometheus/Loki).
     - Loki Logs: localhost:3100 (query API requests).
     - Prometheus Metrics: localhost:9090 (scrape API endpoints).
   - Uptime Monitoring: Uptime Kuma@3001, Statping-ng@8082 (auto-configured for API/edge).
   - Secrets Manager: No Infisical in current compose; use .env or manual for prod.

5. Test:
   - Unit/Integration Tests: `cd apps/api && pnpm run test` (Jest; 59+ tests pass on clean setup, covering validators/web routes. Expects /v1/ prefix; uses supertest mock—add API_KEY via env for auth tests if needed).
     **AI Tip:** If 404/401 fails, verify routes in `src/web.ts`; mock DB/Redis for isolated units. Coverage: Run with `pnpm test --coverage`.
   - Load Tests: `./bin/k6 run tests/k6/email.js` (from root; 50 VUs, 1min; tests validation endpoints). Hits proxy@8081 by default—fails with 100% errors (502) due to bind issue. Workaround: Edit script to use http://localhost:8080 (direct API); add auth: `headers: { 'Authorization': 'Bearer ' + apiKey }` with seeded key. Adapt for other scripts (phone.js, etc.).
     **AI Tip:** Thresholds fail if >95th percentile >3s (tune in script). For custom: `k6 run --vus 10 --duration 30s script.js`. View results in terminal; integrate with Grafana for trends.
   - Manual API Test: Use curl with seeded key, e.g.,
     ```
     curl -X POST http://localhost:8080/v1/validate/email \
       -H "Authorization: Bearer ok_test_..." \
       -H "Content-Type: application/json" \
       -d '{"email": "test@example.com"}'
     ```
     Expect: {"valid":true,"normalized":"test@example.com",...}.
     **AI Tip:** All endpoints idempotent (request_id); rate-limited (300/min). Use Swagger for schemas/examples.

### Production
- Use `infra/compose/prod.compose.yml` with secrets (Infisical integration).
- Deploy API Podman image: `podman build -t orbicheck-api apps/api/`.
- Scale with Kubernetes or ECS; monitor with Grafana/Prometheus.
- Edge: Configure OpenResty in `apps/edge/nginx.conf` for caching/routing.
- Object Storage: MinIO (S3-compatible) for files/logs.
- Errors: GlitchTip (Sentry-compatible) at port 8030.
- Queue: BullMQ with Valkey (Redis fork) for jobs.

## API Documentation

See [apps/api/README.md](apps/api/README.md) for full endpoint details, schemas, examples, and reason codes.

### Recent Refactoring and Optimizations
- **Server Modularity:** The server now separates `build()` for app configuration from `start()` for runtime setup (queues, cron, listening), improving test isolation.
- **Route Hooks:** Authentication and middleware (rate limiting, idempotency) are now in dedicated functions (`authenticateRequest`, `applyRateLimitingAndIdempotency`) in web.ts, making the preHandler hook cleaner and easier to extend.
- **Email Validation Performance:** Added domain-level caching (7 days TTL) for MX records and disposable checks, avoiding repeated DNS/Redis calls for the same domain.
- **Error Handling:** All validation routes now wrap logic in try-catch, logging errors and returning consistent 500 responses with 'server_error' code.
- **Documentation:** Added comprehensive JSDoc to validators (e.g., validateEmail, validateAddress) and hooks (auth, rateLimit), including param descriptions, returns, and performance notes.

### BullMQ/Redis Note
In container (Valkey), BullMQ jobs (disposable refresh) require `{ maxRetriesPerRequest: null }` in IORedis (already in `src/server.ts` line 81). If error on local Redis, add to constructor.

## Development

- **Code Style:** ESLint/Prettier (run `pnpm lint`).
- **Migrations:** Add to `apps/api/migrations/` (timestamped .sql files).
- **Testing:** Unit (add Jest), integration (k6 load tests).
- **Observability:** Logs to Loki, metrics to Prometheus; view in Grafana (localhost:3000).
- **Jobs:** Disposable domains refresh on startup/cron (BullMQ).
- **Geodata:** Run `scripts/geonames-importer.ts` to load postal codes/cities/lat-lng.

## Contributing

1. Fork, branch (feature/xxx).
2. Install: `pnpm install`.
3. Develop, test, commit.
4. PR to main.

## License

MIT. See LICENSE.

For issues, contact support@orbicheck.com.