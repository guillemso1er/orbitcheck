# Orbicheck API - Data Hygiene Guard

The API is a Fastify-based TypeScript server providing data validation, deduplication, order risk assessment, and batch operations for e-commerce hygiene. It handles validators for emails, phones, addresses, names, and tax IDs; fuzzy/deterministic dedupe for customers and addresses; order evaluation with configurable rules (P.O. box block, COD risk, fraud scoring); batch processing for high-volume operations; and comprehensive observability (logs, metrics, webhooks). It also provides management endpoints for authentication, API key management, data access, rules configuration, settings management, billing integration, and webhook testing.

**AI-Friendly Notes:** Follow root README.md for monorepo setup. Use `list_code_definition_names` on `src/` to see routes (e.g., validateEmail), validators, jobs. Before edits, read `src/server.ts` (Fastify config, BullMQ), `src/web.ts` (route registration), and relevant files. Test changes with `pnpm run test` via `execute_command`.

## Setup

### Dependencies
Install from monorepo root: `pnpm install`.

### Environment (.env)
```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/orbicheck
REDIS_URL=redis://localhost:6379
PORT=8080
LOG_LEVEL=info
NOMINATIM_URL=https://nominatim.openstreetmap.org
LOCATIONIQ_KEY= (optional for enhanced geo)
DISPOSABLE_LIST_URL=https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.json
SENTRY_DSN= (optional error tracking)
VIES_WSDL_URL=https://ec.europa.eu/taxation_customs/vies/checkVatService.wsdl
RETENTION_DAYS=90
RATE_LIMIT_COUNT=300
TWILIO_ACCOUNT_SID= (for OTP)
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

### Database
- Migrations: Manual via psql or tool: `psql $DATABASE_URL -f migrations/*.sql`.
- Seed: `pnpm exec ts-node --require dotenv/config src/seed.ts` (creates dev project/API key; output PROJECT_ID/API_KEY for auth). If SASL/password error, ensure DATABASE_URL in .env is correct and dotenv is loaded.

### Run
- Dev (local, no compose): `pnpm run dev` (ts-node-dev + dotenv; binds to localhost:8080; requires manual DB/Redis start). BullMQ/Valkey compatible with `{ maxRetriesPerRequest: null }` in `src/server.ts` (line 81).
  **AI Tip:** If Redis error on local, confirm REDIS_URL=redis://localhost:6379. Use `execute_command` for `pnpm run dev`; logs show startup and disposable refresh.
- Container (with compose): API auto-starts in `podman compose up -d`; accesses via localhost:8080 (direct) or 8081 (edge proxy). Env uses service names (postgres:5432, valkey:6379).
  **Common Issue:** Proxy 502—API binds 0.0.0.0 but logs 127.0.0.1; accessible via network. Test direct: `curl http://localhost:8080/health`.
- Prod Build: `pnpm run build && node dist/server.js` (or Docker: `podman build -t orbicheck-api . && podman run -p 8080:8080 --env-file .env orbicheck-api`).
  **AI Tip:** For rebuild after code changes, `podman compose restart api` (no full up needed). Verify with `podman logs compose-api-1`.

### Swagger Docs
- http://localhost:8080/documentation (OpenAPI UI).

## Architecture

- **Server:** Fastify with CORS, Swagger, auth (SHA256 API keys, PAT tokens, session cookies), rate limiting (Redis), idempotency (Redis 24h).
- **Database:** Postgres (Pool); tables: projects, api_keys, logs, usage_daily, geonames_postal, customers, addresses, orders, jobs, webhooks, settings, users, accounts, stores.
- **Cache:** Redis (disposable domains set, rate limits, idempotency, BullMQ queues).
- **Jobs:** BullMQ workers for batch operations (validation/dedupe); cron refresh disposable domains (daily + startup).
- **Validators:** Modular (address.ts, email.ts, phone.ts, taxid.ts, name.ts); external: libphonenumber-js, tldts, soap (VIES), libpostal CLI, Twilio Verify.
- **Deduplication:** pg_trgm for fuzzy similarity; indexes on GIN ops; batch processing support.
- **Observability:** Logs to Postgres (reason codes, meta JSON); daily usage aggregates; webhooks for real-time notifications.
- **Billing:** Stripe integration for subscriptions and usage-based billing.

## API Endpoints

All POST/GET/PUT/DELETE; auth via Bearer API key (runtime), PAT token or session cookies (management); rate limited (300/min); idempotent for mutations.

**Error Codes:**

All API errors follow the format:
```json
{
  "error": {
    "code": "error_code",
    "message": "Human-readable description"
  },
  "request_id": "uuid"
}
```

**Common Error Codes:**

| Code | HTTP Status | Category | Description |
|------|-------------|----------|-------------|
| `invalid_url` | 400 | validation | Valid HTTPS/HTTP URL required |
| `missing_payload` | 400 | validation | Custom payload required for custom type |
| `invalid_type` | 400 | validation | Invalid webhook payload_type |
| `invalid_ids` | 400 | validation | Invalid or mismatched IDs |
| `not_found` | 404 | resource | Requested resource not found |
| `unauthorized` | 401 | auth | Authentication required but not provided |
| `invalid_token` | 401 | auth | Provided authentication token is invalid or expired |
| `no_project` | 403 | auth | No default project configured for user |
| `user_exists` | 409 | auth | User with provided credentials already exists |
| `invalid_credentials` | 401 | auth | Invalid login credentials provided |
| `server_error` | 500 | server | Internal server error occurred |
| `webhook_send_failed` | 502 | webhook | Failed to deliver webhook to configured endpoint |
| `rate_limited` | 429 | rate_limit | Request rate limit exceeded |

For a complete list of error codes with categories and severity levels, see the [Error Code Catalog API](#get-v1ruleserror-codes).

**Reason Codes:**

Validation and risk assessment responses include `reason_codes` arrays with standardized codes. For a complete catalog, see the [Reason Code Catalog API](#get-v1rulescatalog).

**Reason Codes (deterministic):**
- Validators: email.invalid_format, email.mx_not_found, email.disposable_domain, email.server_error, phone.invalid_format, phone.unparseable, phone.otp_sent, phone.otp_send_failed, address.po_box, address.postal_city_mismatch, address.in_bounds, taxid.invalid_format, taxid.invalid_checksum, taxid.vies_invalid, taxid.vies_unavailable, name.invalid_format.
- Dedupe: dedupe.server_error.
- Order: order.customer_dedupe_match, order.address_dedupe_match, order.duplicate_detected, order.po_box_block, order.address_mismatch, order.invalid_email, order.invalid_phone, order.cod_risk, order.high_value, order.server_error.
- Webhook: webhook.send_failed.
- Batch: batch_validation_completed, batch_dedupe_completed, batch_job_failed.

### 1. POST /v1/validate/email
**Body:** { "email": "string" }
**Response (200):** { "valid": boolean, "normalized": "string", "disposable": boolean, "mx_found": boolean, "reason_codes": ["string"], "request_id": "string", "ttl_seconds": integer }
**Example Request:** `{ "email": "test@example.com" }`
**Example Response:** `{ "valid": true, "normalized": "test@example.com", "disposable": false, "mx_found": true, "reason_codes": [], "request_id": "uuid", "ttl_seconds": 2592000 }`

### 2. POST /v1/validate/phone
**Body:** { "phone": "string", "country"?: "string", "request_otp"?: boolean }
**Response (200):** { "valid": boolean, "e164": "string", "country": "string|null", "reason_codes": ["string"], "request_id": "string", "ttl_seconds": integer, "verification_id"?: "string" }
**Example Request:** `{ "phone": "+1 555 123 4567", "country": "US", "request_otp": true }`
**Example Response:** `{ "valid": true, "e164": "+15551234567", "country": "US", "reason_codes": ["phone.otp_sent"], "request_id": "uuid", "ttl_seconds": 2592000, "verification_id": "uuid" }`

### 3. POST /v1/validate/address
**Body:** { "address": { "line1": "string", "line2"?: "string", "city": "string", "postal_code": "string", "state"?: "string", "country": "string" } }
**Response (200):** { "valid": boolean, "normalized": { "line1": "string", "line2": "string", "city": "string", "postal_code": "string", "state": "string", "country": "string" }, "geo"?: { "lat": number, "lng": number, "confidence": number }, "po_box": boolean, "postal_city_match": boolean, "reason_codes": ["string"], "request_id": "string", "ttl_seconds": integer }
**Example Request:** `{ "address": { "line1": "123 Main St", "city": "New York", "postal_code": "10001", "country": "US" } }`
**Example Response:** `{ "valid": true, "normalized": { "line1": "123 Main St", "line2": "", "city": "New York", "postal_code": "10001", "state": "", "country": "US" }, "geo": { "lat": 40.7128, "lng": -74.0060, "confidence": 0.9 }, "po_box": false, "postal_city_match": true, "reason_codes": [], "request_id": "uuid", "ttl_seconds": 604800 }`

### 4. POST /v1/validate/tax-id
**Body:** { "type": "string" (cpf|cnpj|rfc|cuit|rut|ruc|nit|nif|ein|vat), "value": "string", "country"?: "string" }
**Response (200):** { "valid": boolean, "normalized": "string", "reason_codes": ["string"], "request_id": "string", "source"?: "string" (format|vies) }
**Example Request:** `{ "type": "cpf", "value": "123.456.789-09" }`
**Example Response:** `{ "valid": true, "normalized": "12345678909", "reason_codes": [], "request_id": "uuid", "source": "format" }`

### 5. POST /v1/dedupe/customer
**Body:** { "email"?: "string", "phone"?: "string", "first_name": "string", "last_name": "string" }
**Response (200):** { "matches": [{ "id": "string", "similarity_score": number, "match_type": "string" (exact_email|exact_phone|fuzzy_name|fuzzy_email|fuzzy_phone), "data": object }], "suggested_action": "string" (create_new|merge_with|review), "request_id": "string" }
**Example Request:** `{ "email": "test@example.com", "first_name": "John", "last_name": "Doe" }`
**Example Response:** `{ "matches": [{ "id": "uuid", "similarity_score": 1.0, "match_type": "exact_email", "data": { "email": "test@example.com" } }], "suggested_action": "merge_with", "request_id": "uuid" }`

### 6. POST /v1/dedupe/address
**Body:** { "address": { "line1": "string", "line2"?: "string", "city": "string", "postal_code": "string", "state"?: "string", "country": "string" } }
**Response (200):** { "matches": [{ "id": "string", "similarity_score": number, "match_type": "string" (exact_postal|fuzzy_address), "data": object }], "suggested_action": "string", "request_id": "string" }
**Example Request:** `{ "address": { "line1": "123 Main St", "city": "New York", "postal_code": "10001", "country": "US" } }`
**Example Response:** `{ "matches": [{ "id": "uuid", "similarity_score": 1.0, "match_type": "exact_postal", "data": { "postal_code": "10001" } }], "suggested_action": "merge_with", "request_id": "uuid" }`

### 7. POST /v1/orders/evaluate
**Body:** { "order_id": "string", "customer": object, "shipping_address": object, "total_amount": number, "currency": "string", "payment_method"?: "string" }
**Response (200):** { "order_id": "string", "risk_score": number (0-100), "action": "string" (approve|hold|block), "tags": ["string"], "reason_codes": ["string"], "customer_dedupe": object, "address_dedupe": object, "validations": { "email": object, "phone": object, "address": object }, "request_id": "string" }
**Example Request:** `{ "order_id": "ORD-123", "customer": { "email": "test@example.com", "first_name": "John", "last_name": "Doe" }, "shipping_address": { "line1": "123 Main St", "city": "New York", "postal_code": "10001", "country": "US" }, "total_amount": 150.0, "currency": "USD", "payment_method": "cod" }`
**Example Response:** `{ "order_id": "ORD-123", "risk_score": 50, "action": "hold", "tags": ["potential_duplicate_customer", "cod_order"], "reason_codes": ["order.customer_dedupe_match", "order.cod_risk"], "customer_dedupe": { "matches": [...], "suggested_action": "review" }, "address_dedupe": { "matches": [], "suggested_action": "create_new" }, "validations": { "email": { "valid": true, "reason_codes": [] }, "phone": { "valid": true, "reason_codes": [] }, "address": { "valid": true, "reason_codes": [] } }, "request_id": "uuid" }`

### 8. POST /v1/normalize/address
**Body:** { "address": { "line1": "string", "line2"?: "string", "city": "string", "postal_code": "string", "state"?: "string", "country": "string" } }
**Response (200):** { "normalized": { "line1": "string", "line2": "string", "city": "string", "postal_code": "string", "state": "string", "country": "string" }, "request_id": "string" }

### 9. POST /v1/batch/validate
**Body:** { "type": "email"|"phone"|"address"|"tax-id", "data": ["string"] }
**Response (202):** { "job_id": "string", "status": "pending", "request_id": "string" }

### 10. POST /v1/batch/dedupe
**Body:** { "type": "customers"|"addresses", "data": [object] }
**Response (202):** { "job_id": "string", "status": "pending", "request_id": "string" }

### 11. GET /v1/jobs/:id
**Response (200):** { "job_id": "string", "status": "pending"|"processing"|"completed"|"failed", "progress": { "total": number, "processed": number, "percentage": number }, "result_url"?: "string", "error"?: "string", "result_data"?: object, "created_at": "string", "updated_at": "string", "request_id": "string" }

### 8. GET /v1/data/logs
**Response (200):** { "data": [{ "id": "string", "type": "string", "endpoint": "string", "reason_codes": ["string"], "status": integer, "created_at": "string" }], "next_cursor": "string|null" }
**Example:** `{ "data": [{ "id": "uuid", "type": "validation", "endpoint": "/validate/email", "reason_codes": [], "status": 200, "created_at": "2025-09-27T20:00:00Z" }], "next_cursor": null }`

### 9. GET /v1/data/usage
**Response (200):** { "period": "string", "totals": { "validations": integer, "orders": integer }, "by_day": [{ "date": "string", "validations": integer, "orders": integer }], "request_id": "string" }
**Example:** `{ "period": "month", "totals": { "validations": 100, "orders": 50 }, "by_day": [{ "date": "2025-09-27", "validations": 10, "orders": 5 }], "request_id": "uuid" }`

### 1. GET /v1/rules
**Response (200):** { "rules": [{ "id": "string", "name": "string", "description": "string", "reason_code": "string", "severity": "string", "enabled": boolean }], "request_id": "string" }
**Example:** `{ "rules": [{ "id": "email_format", "name": "Email Format Validation", "description": "Checks if email is properly formatted", "reason_code": "email.invalid_format", "severity": "low", "enabled": true }], "request_id": "uuid" }`

### 2. GET /v1/rules/catalog
**Response (200):** { "catalog": { "reason_codes": {...}, "severities": [...] } }

### 3. GET /v1/rules/catalog/error-codes
**Response (200):** { "error_codes": {...}, "categories": [...] }

### 4. POST /v1/rules/test
**Body:** { "payload": object, "rules"?: ["string"] }
**Response (200):** { "triggered_rules": [{ "id": "string", "severity": "string", "reason_code": "string" }], "request_id": "string" }

### 5. POST /v1/rules/register
**Body:** { "rules": [{ "id": "string", "name": "string", "description": "string", "reason_code": "string", "severity": "string", "enabled": boolean }] }
**Response (200):** { "registered": ["string"] }

### 6. GET /v1/settings
**Response (200):** { "country_defaults": object, "formatting": object, "risk_thresholds": object, "request_id": "string" }

### 7. PUT /v1/settings
**Body:** { "country_defaults"?: object, "formatting"?: object, "risk_thresholds"?: object }
**Response (200):** { "message": "Settings updated successfully", "request_id": "string" }

### 8. GET /v1/data/usage
**Query:** period?
**Response (200):** { "period": "string", "totals": { "validations": integer, "orders": integer }, "by_day": [{ "date": "string", "validations": integer, "orders": integer }], "request_id": "string" }

### 9. GET /v1/data/logs
**Query:** limit?, cursor?, type?, endpoint?
**Response (200):** { "data": [{ "id": "string", "type": "string", "endpoint": "string", "reason_codes": ["string"], "status": integer, "created_at": "string" }], "next_cursor": "string|null" }

### 10. DELETE /v1/data/logs/:id
**Response (200):** { "deleted": true }

### 11. POST /v1/data/erase
**Body:** { "reason": "string" }
**Response (202):** { "message": "Data erasure initiated", "request_id": "string" }

### 12. GET /v1/api-keys
**Response (200):** { "api_keys": [{ "id": "string", "name": "string", "created_at": "string" }] }

### 13. POST /v1/api-keys
**Body:** { "name"?: "string" }
**Response (201):** { "id": "string", "key": "string", "name": "string", "created_at": "string" }

### 14. DELETE /v1/api-keys/:id
**Response (200):** { "deleted": true }

### 15. GET /v1/webhooks
**Response (200):** { "webhooks": [{ "id": "string", "url": "string", "events": ["string"], "status": "string", "created_at": "string" }] }

### 16. POST /v1/webhooks
**Body:** { "url": "string", "events": ["string"] }
**Response (201):** { "id": "string", "url": "string", "events": ["string"], "status": "string", "created_at": "string" }

### 17. DELETE /v1/webhooks/:id
**Response (200):** { "deleted": true }

### 18. POST /v1/webhooks/test
**Body:** { "url": "string", "payload_type": "validation"|"order"|"custom", "custom_payload"?: object }
**Response (200):** { "sent_to": "string", "response": { "status": integer, "body": "string" } }
**Example Request:** `{ "url": "https://example.com/webhook", "payload_type": "validation" }`
**Example Response:** `{ "sent_to": "https://example.com/webhook", "response": { "status": 200, "body": "OK" } }`

### 19. POST /auth/register
**Body:** { "email": "string", "password": "string" }
**Response (201):** { "api_key": "string", "pat": "string", "project_id": "string" }
**Example Request:** `{ "email": "user@example.com", "password": "securepass" }`
**Example Response:** `{ "api_key": "ok_test_...", "pat": "pat_...", "project_id": "proj_..." }`

### 20. POST /auth/login
**Body:** { "api_key": "string" }
**Response (200):** Sets session cookie

### 21. POST /auth/logout
**Response (200):** Clears session

### 22. POST /v1/billing/checkout
**Response (200):** { "session_url": "string", "session_id": "string", "request_id": "string" }

### 23. POST /v1/billing/portal
**Response (200):** { "portal_url": "string", "request_id": "string" }

## Observability

- **Logs:** All requests logged to Postgres 'logs' table (project_id, type, endpoint, reason_codes, status, meta JSON). Retention: RETENTION_DAYS.
- **Metrics:** Daily aggregates in 'usage_daily' (validations, orders per project).
- **Jobs:** Asynchronous job tracking in 'jobs' table with BullMQ queues for batch operations.
- **Webhooks:** Real-time notifications for validation/order events to configured endpoints.
- **External:** Integrate Loki/Prometheus for advanced monitoring (see monorepo infra).

## Testing

- Load: k6 scripts in `tests/k6/` (run from root: `./bin/k6 run tests/k6/email.js`; 50 VUs/1min, hits proxy@8081). Fails 100% (502) due to bind—edit script to http://host.docker.internal:8080 or localhost:8080 (direct). Add auth: `headers: { Authorization: 'Bearer ' + seededKey }`.
  **AI Tip:** Thresholds: http_req_duration <3s p95. For custom load, `--vus 10 --duration 30s`. Results show iterations/checks; integrate with Prometheus for metrics.
- Unit: Jest in `src/__tests__/` and `src/validators/__tests__/` (run `pnpm run test`; covers validators, routes, jobs). Mocks DB/Redis; tests /v1/ routes. If 404/401, check `src/web.ts` prefixes and env API_KEY for auth. Passes on clean setup.
  **AI Tip:** Add tests with supertest; run `--coverage` for reports. For integration, start API and use real endpoints.
- E2E: Playwright tests in `../dashboard/e2e/` cover full user journeys including API interactions.

## Deployment

- Docker Compose (monorepo infra).
- CI/CD: GitHub Actions or similar for build/test/deploy.
- Scaling: Horizontal Fastify instances behind load balancer.

For monorepo overview, see root README.md.

**AI-Specific Troubleshooting:**
- **Proxy/502 Error:** Caddy proxies to api:8080; fails if API not reachable in network. Use direct localhost:8080. Fix: Ensure no HOST=127.0.0.1 override.
- **VIES/SOAP Slow:** Set VIES_DOWN=true in env to skip EU VAT (fallback to format check).
- **Disposable Refresh:** BullMQ job runs on startup/cron; loads 71k+ domains from GitHub raw. If fails, manual: `pnpm run db:init`.
- **Batch Jobs:** Asynchronous processing via BullMQ queues; monitor with GET /v1/jobs/:id; results stored in jobs table.
- **Rate Limiting:** Redis-based; 300/min default. Increase for tests.
- **Idempotency:** All POST use request_id (UUID) for 24h dedupe; replay returns cached response.
- **Webhooks:** Configured per project; triggered on validation/order events; retry on failure.
- **Billing:** Stripe integration requires STRIPE_SECRET_KEY; checkout sessions create subscriptions.