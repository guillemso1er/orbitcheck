# Orbitcheck Shopify App

This embedded Polaris app lives inside `apps/shopify-app` and talks to the Fastify API under `apps/api`. It relies on the manual OAuth endpoints exported from the API and the scopes/webhooks defined in `shopify.app.toml`.

## Scopes & Webhooks

- **Requested scopes**: `read_orders`, `write_orders`, `read_customers`, `write_customers`. These cover the checkout/order data plus customer digests needed for GDPR handling and tagging.
- **Scopes source of truth**: `shopify.app.toml` and `apps/api/src/integrations/shopify/auth/install.ts` both build their scope sets from the shared `SHOPIFY_REQUIRED_SCOPES` constant.
- **Webhooks**: GDPR topics (`customers/data_request`, `customers/redact`, `shop/redact`), `orders/create`, and `app/uninstalled` are wired to `https://api.orbitcheck.io/integrations/shopify/webhooks/*`. After editing this file run `shopify app deploy` so Shopify registers the new scopes and webhooks before reinstalling on a store.

## Environment variables

| Variable              | Purpose                                                                                |
|-----------------------|----------------------------------------------------------------------------------------|
| `SHOPIFY_API_KEY`     | App API key (Partner dashboard).                                                       |
| `SHOPIFY_API_SECRET`  | App secret (used for OAuth and webhook verification).                                  |
| `APP_BASE_URL`        | Base URL for your API backend (used by the OAuth redirect).                            |
| `SHOPIFY_API_VERSION` | Admin API version used by the API (e.g., `2025-10`).                                   |
| `POSTHOG_KEY`         | PostHog project key used by the API for lifecycle events (empty disables telemetry).   |
| `POSTHOG_HOST`        | Optional PostHog host (defaults to `https://us.i.posthog.com`).                        |
| `API_URL`             | Where the embedded app should send requests (defaults to `https://api.orbitcheck.io`). |

Set these in your Infisical project or `.env.local` before running the app locally.

## Local development

1. Run the backend: `pnpm --filter @orbitcheck/api dev`.
2. Run the frontend: `pnpm --filter @orbitcheck/shopify-app dev`.
3. Use a tunnel (Shopify CLI or a tool such as `cloudflared`) so the embedded app can be loaded inside Shopify.
4. Hit the manual install URL for your test store (`/integrations/shopify/auth/install?shop=<your-store>.myshopify.com`).

Once installed, PostHog events (`signup`, `first_validation`, `correction`, `block`, `uninstalled`) are emitted from the API. The embedded UI relies on session tokens and the API routes under `/integrations/shopify/api/*` for toggling Orbitcheck modes.

## Testing/deployment notes

- After editing Shopify config or scopes, run `shopify app deploy` in this directory before reinstalling on a dev store.
- The frontend assumes the API keeps encrypted access tokens, validates webhook HMACs, and logs lifecycle events for each webhook and GDPR handler.
- To verify scopes, call `/integrations/shopify/api/access-scopes` (with a valid session token) to confirm customer scopes exist; the API also logs and alerts if required scopes are missing.

Keep this README in sync with any additional Shopify CLI deploy steps or scope changes required by the Partner dashboard.