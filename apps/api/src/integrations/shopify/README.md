# Shopify Integration

This directory contains the Shopify app integration for OrbitCheck.

## Required Environment Variables

Add the following to the API environment configuration:

- `SHOPIFY_API_KEY`: The API key from Shopify Partner Dashboard
- `SHOPIFY_API_SECRET`: The API secret from Shopify Partner Dashboard
- `SHOPIFY_API_VERSION`: 2025-10
- `APP_BASE_URL`: https://shopify.orbitcheck.io

## OAuth Install URL

To install the app, redirect users to:

```
https://api.orbitcheck.io/integrations/shopify/auth/install?shop={shop}.myshopify.com
```

## Webhook Topics and Endpoints

The following webhooks are configured in `shopify.app.toml`:

- `app/uninstalled`: https://api.orbitcheck.io/integrations/shopify/webhooks/app-uninstalled
- `orders/create`: https://api.orbitcheck.io/integrations/shopify/webhooks/orders-create
- `customers/data_request`: https://api.orbitcheck.io/integrations/shopify/webhooks/gdpr/customers-data-request
- `customers/redact`: https://api.orbitcheck.io/integrations/shopify/webhooks/gdpr/customers-redact
- `shop/redact`: https://api.orbitcheck.io/integrations/shopify/webhooks/gdpr/shop-redact

## Testing with a Dev Store

1. Set up a Shopify development store.
2. Install the app using the OAuth install URL.
3. In the embedded UI, set the mode to 'notify' or 'activated'.
4. Create a test order in the dev store.
5. Verify that the webhook is received, the order is evaluated, and tags are added.

## Database Schema

Ensure the database has tables for storing shop tokens and settings. The code assumes functions like `storeShopToken`, `getShopMode`, etc., which need to be implemented with actual DB queries.