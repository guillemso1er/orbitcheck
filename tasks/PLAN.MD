Summary
- Goal: add a Shopify address-correction workflow that reuses the existing Fastify API, BullMQ infrastructure, and contracts package so invalid orders are tagged, held, and recoverable via an App Proxy flow.
- Scope boundaries: stay within current Orbitcheck API + Shopify app codebases; defer email delivery to Shopify Flow/Klaviyo by exposing the fix link via order metafields; do not touch dashboard/site apps.
- Success signals: invalid addresses create a persisted "address_fix_needed" session, Shopify tag + fulfillment hold post within seconds, App Proxy confirm updates the order and clears tag/holds, and Flow templates + docs exist for merchants.
- Assumptions: reuse `validateAddress` for Orbitcheck validation output; store fix links in a Shopify order metafield readable by Flow; customers/create|update validation only enriches stored address data and seeds future order corrections.
- Questions: none.

Implementation Steps
1. Action: edit OpenAPI specs and regenerate clients.
	Paths: packages/contracts/openapi/v1/openapi.yml; packages/contracts/openapi/v1/paths/integrations/shopify/*.yml (new files for customers-create, customers-update, address-fix GET/confirm); packages/contracts/openapi/v1/components/schemas (new address fix session/token schemas).
	Intent: model the new webhook surfaces and App Proxy helper endpoints so both API handlers and the Shopify app can share typed clients.
	Diff sketch: add POST paths `/integrations/shopify/webhooks/customers-create|customers-update`, GET `/integrations/shopify/address-fix/{token}`, POST `/integrations/shopify/address-fix/{token}/confirm`; define schemas for `ShopifyOrderAddressFixRequest`, `ShopifyAddressFixSession`, `ShopifyAddressFixConfirmRequest`.
	Dependencies: none.
	Validation: `pnpm generate` (updates contracts build + Fastify types).

2. Action: add a migration for address-fix persistence + indices.
	Paths: apps/api/migrations/1764xxxxxxx_add_shopify_address_fix_workflow.js.
	Intent: create `shopify_order_address_fixes` (id uuid PK, shop_domain, order_id numeric, order_gid text, customer_email, original_address jsonb, normalized_address jsonb, token_hash, token_expires_at, fix_status enum pending/confirmed/cancelled, fulfillment_hold_ids text[], sent_to_flow_at timestamptz, created_at/updated_at default now) and supporting indexes on (shop_domain, order_id) + token_hash.
	Diff sketch: use `pgm.createTable` with enums, add partial index for active sessions, include ON DELETE CASCADE via FK to `shopify_shops`.
	Dependencies: Step 1 (types) optional but not required for migration coding.
	Validation: `pnpm migrate` (or `pnpm --filter @orbitcheck/api run migrate:local` in dev) to ensure migration applies.

3. Action: implement Shopify address-fix service + queue workers.
	Paths: apps/api/src/integrations/shopify/address-fix/service.ts (new); apps/api/src/integrations/shopify/address-fix/graphql.ts (new helper for tags/metafields/holds); apps/api/src/jobs/addressFix.ts (new BullMQ processor) plus exports wiring in apps/api/src/server.ts for worker/queue lifecycle.
	Intent: encapsulate logic to validate shipping addresses via `validateAddress`, persist/update fix sessions, create signed tokens, add `address_fix_needed` tag + metafield + event logging, enqueue fulfillment-hold/poll jobs, and expose helpers to release holds on confirmation.
	Diff sketch: `processOrderWebhook({ shopDomain, order, pool, redis })` -> call validation, bail if valid/deliverable, otherwise upsert session + call `shopifyGraphql` mutations (`tagsAdd`, `metafieldsSet`, `fulfillmentOrderHold` after polling), store FO IDs and fix URL; worker polls Shopify for fulfillment orders until found then submits hold mutation.
	Dependencies: Step 2 (table must exist).
	Validation: interim `pnpm --filter @orbitcheck/api run test -- shopify-address-fix` once tests exist; smoke via `pnpm --filter @orbitcheck/api run typecheck`.

4. Action: extend webhook handlers to use the new service.
	Paths: apps/api/src/integrations/shopify/webhooks/orders-create.ts (refactor); apps/api/src/integrations/shopify/webhooks/customers-create.ts & customers-update.ts (new); apps/api/src/handlers/handlers.ts (wire new operationIds); apps/api/src/generated/fastify/types.gen.ts (auto via Step1).
	Intent: ensure orders/create invokes address-fix processing asynchronously without regressing existing risk tagging; add customer webhooks that sanitize customer default addresses, persist normalized data, and optionally refresh pending sessions.
	Diff sketch: in orders handler, after current Orbitcheck call, `queueMicrotask(() => handleOrderAddressFix({ ... }))`; new customer handler extracts default address, calls service method `recordCustomerAddressProfile` that seeds cache/DB for later; reply 200 immediately.
	Dependencies: Step 3.
	Validation: `pnpm --filter @orbitcheck/api run test -- shopify-address-fix.int.test.ts` (once added).

5. Action: expose App Proxy-friendly endpoints for fix page + confirmation.
	Paths: apps/api/src/services/shopifyAddressFix.ts (new service functions `getSessionByToken`, `confirmSession`); apps/api/src/handlers/handlers.ts (map new OpenAPI handlers); optional apps/api/src/routes helpers if needed.
	Intent: allow Shopify app to fetch session details (sanitized address variants) and confirm updates which call Shopify GraphQL (`orderUpdate`, `tagsRemove`, `fulfillmentOrderReleaseHold`), update local session status, and log outcomes.
	Diff sketch: GET handler validates token hash + expiry, returns masked customer info + corrected address; POST handler verifies signature payload, updates order via `shopifyGraphql`, clears holds using stored FO IDs, updates session status to confirmed + clears metafield.
	Dependencies: Steps 1–4.
  Validation: `pnpm --filter @orbitcheck/api run test -- shopify-address-fix.int.test.ts` plus targeted unit if added.

6. Action: add integration/unit tests for the new API pieces.
	Paths: apps/api/tests/shopify-address-fix.int.test.ts (new jest test); potential fixtures under apps/api/tests/__fixtures__/shopify/ (new files); update apps/api/tests/setup.ts for DB seeding or mocking.
	Intent: cover order webhook invalid-address path (session + tag stored, job enqueued) and confirm endpoint releasing holds (mock Shopify GraphQL + ensure DB status updated).
	Diff sketch: use nock/undici MockAgent to fake Shopify GraphQL responses; seed DB with shop + token; assert `shopify_order_address_fixes` rows.
	Dependencies: Steps 3–5.
	Validation: `pnpm --filter @orbitcheck/api run test -- shopify-address-fix.int.test.ts` and include in CI suite.

7. Action: update Shopify app to forward webhooks and host the fix UI.
	Paths: apps/shopify-app/shopify.app.orbitcheck.toml (add webhooks topics + app_proxy config); apps/shopify-app/app/shopify.server.ts (ensure registerWebhooks covers new subscriptions); apps/shopify-app/app/routes/webhooks.orders.create.tsx & webhooks.customers.(create|update).tsx (new forwarding actions); apps/shopify-app/app/utils/addressFix.server.ts (API client helpers); apps/shopify-app/app/routes/apps.address-fix.tsx (App Proxy GET+POST confirmation UI); docs in apps/shopify-app/docs/flow/address-fix-order.json + address-fix-email.json summarizing Flow templates.
	Intent: guarantee Shopify webhooks reach the API via contracts client, surface a storefront-hosted confirmation experience, and document Flow templates merchants can import.
	Diff sketch: webhook actions call `authenticate.webhook`, then invoke `shopifyOrdersCreateWebhook`/`shopifyCustomersCreateWebhook`; App Proxy loader validates signature, fetches session via new contract (pass `X-Internal-Request` header), renders corrected vs original address and POSTs confirm (with CSRF token) to trigger API confirm endpoint.
	Dependencies: Steps 1 & 5.
	Validation: `pnpm --filter @orbitcheck/orbitcheck-shopify-app run lint` and `pnpm --filter @orbitcheck/orbitcheck-shopify-app run typecheck`.

Tests
- apps/api/tests/shopify-address-fix.int.test.ts: simulate invalid order webhook -> assert DB row, GraphQL calls mocked, job queued, HTTP 200.
- apps/api/tests/shopify-address-fix-confirm.int.test.ts (can share file): confirm endpoint releases holds, removes tag/metafield, marks session confirmed.
- Optional unit: apps/api/src/integrations/shopify/address-fix/service.test.ts to exercise token generation + hold scheduling without hitting Shopify.
- Manual QA script documented in new Flow docs for end-to-end dev-store validation.

Rollback
- Revert commit and run `pnpm --filter @orbitcheck/api run migrate:local-down` for the new migration; purge BullMQ `shopify_address_fix` jobs if deployed; remove new webhook subscriptions via Shopify CLI config rollback.

Done Criteria
- Contracts regenerated and type-safe clients available for new endpoints.
- Database migration applied and observed in Pg schema dump.
- API webhook + App Proxy endpoints pass new integration tests and tag/hold logic verified in logs.
- Shopify app forwards webhooks, serves fix UI, and lint/typecheck succeed.
- Flow template docs checked in and reference the metafield-driven fix link.
