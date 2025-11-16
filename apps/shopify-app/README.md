# OrbitCheck Shopify App

A Shopify embedded app that integrates with the OrbitCheck validation service to automatically validate customer information and flag high-risk orders.

## Overview

This app uses:
- **React Router** for routing
- **Shopify App Bridge v4** for embedded app functionality
- **Polaris** for the UI components
- **Prisma** for database management
- **Fastify API** (separate service) for Shopify integration and OrbitCheck API calls

## Architecture

The app follows Shopify's recommended architecture:

1. **Frontend** (`apps/shopify-app`): Embedded React app using App Bridge
2. **Backend** (`apps/api`): Fastify server handling OAuth, webhooks, and API integration

## Shopify Configuration

### Required Scopes

The app requires the following Shopify API scopes:

- `read_orders` - Read order data
- `write_orders` - Add tags to orders
- `read_customers` - Read customer data (for validation)
- `write_customers` - Write customer data (if needed)

### Webhooks

The app subscribes to:

- `app/uninstalled` - Cleanup when uninstalled
- `app/scopes_update` - Handle scope changes
- GDPR compliance webhooks:
  - `customers/data_request` - Handle data export requests
  - `customers/redact` - Handle customer data deletion
  - `shop/redact` - Handle shop data deletion

## Environment Setup

### Required Environment Variables

```bash
# Shopify credentials (from Partner Dashboard)
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret

# App configuration
APP_BASE_URL=https://your-domain.com
SHOPIFY_API_VERSION=2026-01

# PostHog analytics (optional)
POSTHOG_KEY=phc_your_key
POSTHOG_HOST=https://us.i.posthog.com

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/orbitcheck
```

### Development Setup

1. Install dependencies:
   ```bash
   cd apps/shopify-app
   pnpm install
   ```

2. Set up database:
   ```bash
   pnpm prisma generate
   pnpm prisma migrate dev
   ```

3. Start development server:
   ```bash
   pnpm dev
   ```

4. For the API backend:
   ```bash
   cd apps/api
   pnpm install
   pnpm dev
   ```

## Installation on Test Store

### Using Shopify CLI

1. Create/select a development store in your Shopify Partner Dashboard
2. Link your app to the store:
   ```bash
   pnpm shopify config:link
   ```
3. Start development:
   ```bash
   pnpm shopify dev
   ```
4. Install the app on your test store using the Shopify CLI prompt

### Manual Installation

1. Deploy your app configuration:
   ```bash
   pnpm shopify deploy
   ```
2. Visit your development store's admin
3. Go to Apps > Development
4. Install your app and authorize the requested scopes

## Features

### Order Validation

The app automatically validates orders through the OrbitCheck API and:

- Tags orders with risk indicators
- Emits analytics events for tracking
- Handles validation errors gracefully

### GDPR Compliance

The app implements all required GDPR webhooks:

- Records data requests and redaction requests
- Emits PostHog events for compliance tracking
- Provides hooks for actual data deletion (implementation needed)

### Analytics

The app uses PostHog for server-side analytics:

- `signup` - When a shop installs the app
- `first_validation` - When an order is first validated
- `correction` - When an order is flagged for review
- `block` - When an order is blocked
- `uninstalled` - When the app is uninstalled
- `gdpr_*` - Various GDPR compliance events

## Development

### Adding New Features

1. Update the Shopify app configuration in `shopify.app.orbitcheck.toml`
2. Add new API routes in `apps/api/src/integrations/shopify/`
3. Update the frontend components as needed
4. Add appropriate webhook handlers

### Testing

Run the test suites:

```bash
# API tests
cd apps/api
pnpm test

# Type checking
pnpm typecheck

# Linting
pnpm lint
```

### Deployment

1. Update the Shopify app configuration:
   ```bash
   pnpm shopify deploy
   ```

2. Deploy the API backend to your hosting provider
3. Ensure environment variables are configured
4. Test the installation flow on your development store

## Troubleshooting

### Common Issues

1. **Session token errors**: Ensure `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` match your Partner Dashboard
2. **Webhook verification failures**: Check that your API endpoint URLs are correct and accessible
3. **Scope errors**: Verify that the app has been reinstalled with the updated scopes

### Logs

Check the Fastify API logs for detailed error information:

```bash
# View logs from your deployment platform
# or run locally with pnpm dev for development logs
```

## Security

- All webhook requests are verified using HMAC signatures
- Session tokens are validated on every embedded app request
- Customer data is handled according to GDPR requirements
- API keys and secrets should be stored securely

## Support

For issues related to:
- Shopify API: Check [Shopify's API documentation](https://shopify.dev/docs/api)
- App Bridge: See [App Bridge documentation](https://shopify.dev/docs/apps/tools/app-bridge)
- OrbitCheck API: Contact OrbitCheck support

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request
