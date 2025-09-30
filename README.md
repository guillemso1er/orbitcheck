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
- GET /api-keys: List API keys.
- POST /api-keys: Create API key.
- DELETE /api-keys/:id: Delete API key.
- POST /webhooks: Create webhook.
- GET /webhooks: List webhooks.
- DELETE /webhooks/:id: Delete webhook.

### Usage
- GET /usage: Project usage dashboard.

## Setup

1. Install dependencies: `pnpm install`
2. Set up environment (.env): DATABASE_URL, REDIS_URL, API keys for LocationIQ/Google/Twilio/VIES.
3. Run migrations: `pnpm run db:migrate`
4. Start API: `pnpm run api:dev`
5. Access dashboard: http://localhost:5173 (separate dev server).

## Testing

Run `pnpm run test` for unit/integration tests.

## Contributing

See CONTRIBUTING.md.

## License

MIT