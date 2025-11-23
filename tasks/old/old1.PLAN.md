# Shopify Shopify-App Implementation Plan

## Goal
Deliver a production-ready Shopify embedded app (frontend in `apps/shopify-app`) plus the existing Fastify API integration in `apps/api` that:
- Requests and maintains the required Admin API scopes for orders and customers across both `shopify.app.toml` and the OAuth flow in `auth/install.ts`.
- Registers and handles GDPR compliance webhooks plus `app/uninstalled` cleanup using the current webhook endpoints under `/integrations/shopify/webhooks/*`.
- Emits actionable logs and PostHog events for key lifecycle moments from the API layer backing the React UI (currently `app/routes/app._index.tsx`).
- Can be installed and iterated safely on the designated Shopify test store using the manual OAuth endpoints already wired up.

## Current state snapshot (Nov 2025)
- **Frontend** (`apps/shopify-app/app/routes/app._index.tsx`): Embedded Polaris screen calling production API URLs directly. No local proxy, no logging, and session token acquisition is assumed but not handled inside the app.
- **Config** (`apps/shopify-app/shopify.app.toml`): Only `read_orders,write_orders` scopes; webhooks already point to production API endpoints and include GDPR topics individually.
- **API integration** (`apps/api/src/integrations/shopify.ts`): Fastify plugin wiring OAuth (`auth/install`, `auth/callback`), session-token middleware (`lib/jwt.ts`), shop settings APIs, and webhook handlers (orders create + GDPR + uninstall). No PostHog usage today.
- **Token persistence** (`apps/api/src/services/shopify.ts`): Stores access token + scopes but lacks customer scopes and structured event logging/audit trails.

## Assumptions & Prep
- Shopify CLI-managed configuration remains the source of truth; after editing `shopify.app.toml`, we redeploy via `shopify app deploy` so the Partner dashboard picks up the scopes + webhook config.
- Session tokens (App Bridge v4) should be verified in `verifyShopifySessionToken`; missing behavior (retry headers, PostHog logs) will be added alongside this middleware.
- Existing DB tables (`shopify_shops`, `shopify_settings`) will hold any new metadata needed for GDPR cleanup tracking.
- PostHog credentials (`POSTHOG_KEY`, optional `POSTHOG_HOST`) will be stored in Infisical/secrets and exposed to `apps/api` runtime; frontend instrumentation is optional and will be coordinated with backend events.

## Workstream 1 — Access Scopes & Config
1. **Inspect current config**
   - `shopify.app.toml` currently lists only `read_orders,write_orders` and manual GDPR webhook URLs. Capture existing values and confirm dev/prod URLs.
2. **Update scopes**
   - Expand `[access_scopes].scopes` to `"read_orders,write_orders,read_customers,write_customers"` (and optionally `read_all_orders` once approved). Mirror the same scope string inside `apps/api/src/integrations/shopify/auth/install.ts` so the manual OAuth redirect stays in sync.
   - Update `install.ts` to build the scope list from a single constant to avoid drift.
3. **Propagate to deployment**
   - Run `shopify app deploy` (or CLI publish) inside `apps/shopify-app` so Shopify registers the new scopes/webhooks before re-installing on the dev store.
   - Document the scope expansion plus customer data usage rationale in `apps/shopify-app/README.md` and/or Partner listing notes for reviewers.
4. **API client alignment**
   - Ensure downstream calls (e.g., `shopifyGraphql` usage in `webhooks/orders-create.ts`) gracefully handle missing customer scopes; add a sanity endpoint that pings `/admin/oauth/access_scopes.json` using the stored access token and logs if customer scopes are missing so support can re-authorize affected shops.

## Workstream 2 — Auth & Token Management
1. **Session token guard**
   - `verifyShopifySessionToken` in `apps/api/src/integrations/shopify/lib/jwt.ts` currently uses `jsonwebtoken` without retry headers. Augment it to return `401` + `X-Shopify-Retry-Invalid-Session-Request` for expired tokens, attach the decoded `shop` (without protocol) on `request`, and add structured logs for debugging.
2. **Token exchange & install flow**
   - The project already uses manual OAuth via `/integrations/shopify/auth/install` and `/integrations/shopify/auth/callback`. Extend `callback.ts` to validate granted scopes include both orders and customers; flag missing scopes in logs/PostHog. Consider adding a follow-up endpoint to confirm install completion from the embedded app if we need PostHog `signup` events there.
3. **Secure storage**
   - `ShopifyService.storeShopToken` persists tokens/plain scopes. Introduce encryption or at least environment-based secrets handling, and add `shopify_shops` metadata (e.g., `installed_at` timestamp, GDPR purge flags) needed for uninstall cleanup.
4. **Contract updates** (if API changes)
   - If new API routes are added (e.g., `/integrations/shopify/api/logs`), update the Fastify contract generator + regenerate via `pnpm generate` per repo instructions.

## Workstream 3 — GDPR & Uninstall Webhooks
1. **Configuration**
   - `shopify.app.toml` already defines individual webhook entries pointing to `/integrations/shopify/webhooks/...`. Consolidate GDPR topics using `compliance_topics` arrays (optional) and ensure the URIs stay in sync with the Fastify routes when deploying new environments (dev vs prod URLs).
2. **Fastify webhook route**
   - The plugin already adds `rawBody`, `verifyHmac`, and `preventDuplicates` hooks. Review `rawBody` and `verifyHmac` implementations for debug logging and ensure idempotency keys cover all GDPR topics. Add structured log lines when a webhook is accepted/rejected to aid support.
3. **Handler logic (existing files under `apps/api/src/integrations/shopify/webhooks/`)**
   - `gdpr.ts`: flesh out `customersDataRequest`, `customersRedact`, `shopRedact` handlers so they read/write the real DB tables (currently stubs) and store audit rows for compliance.
   - `app-uninstalled.ts`: after deleting shop data via `ShopifyService.deleteShopData`, emit PostHog `uninstalled` and add defensive logs before/after deletion.
   - `orders-create.ts`: once customer scopes exist, consider augmenting payload with Shopify customer IDs to improve downstream validation.
4. **Verification & retries**
   - Add unit/integration tests that feed sample webhook payloads and assert 401 on bad HMAC, 200 on valid.
   - Document manual test via Shopify CLI `shopify app webhook trigger ...` or Dashboard.

## Workstream 4 — Logging & PostHog Events
1. **Structured logging**
   - Fastify already runs with logging enabled (see `apps/api/src/server.ts`). Add child loggers in `install.ts`, `callback.ts`, and each webhook so we can trace shop + topic + request IDs. Follow repo guidance to add debug logs when diagnosing issues.
2. **PostHog server instrumentation**
   - Add `posthog-node` dependency to `apps/api/package.json`. Initialize a singleton telemetry client (with graceful shutdown) and expose helper functions (e.g., `emitShopifyEvent({ shop, event, properties })`). Wire these helpers into:
     - `storeShopToken` success path → emit `signup` once per shop.
     - Orders evaluation flow (`orders-create.ts`) → emit `first_validation`, `correction`, or `block` based on OrbitCheck API response.
     - GDPR handlers + uninstall cleanup → emit `uninstalled` and compliance events.
3. **Frontend hooks (optional)**
   - The Polaris UI currently hits production APIs directly. If we need PostHog JS, add it to the React app only after the API emits core events to avoid duplication. Document decision inside `apps/shopify-app/README.md`.
4. **Monitoring**
   - Pipe Fastify logs + PostHog failures into existing observability stack (Grafana/Loki). Add alerting around repeated webhook failures or PostHog queue backpressure.

## Workstream 5 — Test Store Install Readiness
1. **Environment setup**
   - Confirm `.env` / Infisical entries used by `apps/api` include `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `APP_BASE_URL` (used by `install.ts`), `SHOPIFY_API_VERSION`, and new PostHog keys. Update `README` with any additional vars.
2. **Dev store linking**
   - Document the test store domain in `docs/` or `apps/shopify-app/README.md` and ensure the OAuth install URL (`/integrations/shopify/auth/install?shop=<store>.myshopify.com`) is reachable from the dev tunnel.
3. **Install flow validation**
   - Run `pnpm --filter @orbitcheck/shopify-app dev` for the frontend and `pnpm --filter @orbitcheck/api dev` (or equivalent) for the Fastify API. Use Shopify CLI or manual install to authorize scopes, then ensure `callback.ts` stores tokens with both customer + order scopes and triggers the PostHog `signup` event.
4. **Regression checklist**
   - Validate the Polaris UI toggles mode via `/integrations/shopify/api/shop-settings` with a verified session token.
   - Create test orders/customers on the dev store to ensure `orders-create` webhook fires, tags orders, and logs PostHog events.

## Workstream 6 — QA & Delivery
1. **Automated tests**
   - Add unit tests for token middleware, webhook signature verification, PostHog event helpers.
   - Create integration tests (Vitest/Jest) for webhook controller paths using fixture payloads from Shopify docs.
2. **Manual validation**
   - Trigger GDPR webhooks from Partner Dashboard to ensure cleanup routines run and logs/PostHog entries are produced.
   - Simulate uninstall by removing the app from the dev store; confirm tokens and data are purged.
3. **Documentation**
   - Update `apps/shopify-app/README.md` (or `/docs`) with setup steps, required env vars, PostHog usage, and test-store install guide.
4. **Deployment checklist**
   - Ensure `pnpm lint`, `pnpm typecheck`, and relevant test suites pass.
   - After merging, redeploy app/backend, re-run `shopify app deploy`, and reinstall on the dev store to validate end-to-end.

## Deliverables Summary
- Updated `shopify.app.toml` with scopes + webhook subscriptions.
- Fastify middleware/utilities for session token verification, token exchange, GDPR handlers, and uninstall cleanup.
- PostHog instrumentation plus logging enhancements.
- Documentation covering environment config, test-store install steps, and GDPR obligations.
- Automated and manual test procedures verifying scopes, webhooks, logging, and analytics.
