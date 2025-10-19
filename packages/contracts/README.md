# OrbiCheck API Contracts

This package contains the OpenAPI specification and shared types for the OrbiCheck services.

## Overview

The OpenAPI specification serves as the single source of truth for all API contracts between services. It includes:

- Complete API documentation
- TypeScript types for both server and client
- Generated API clients
- Validation schemas

## Scripts

### Generate Types
```bash
pnpm generate:types
```
Generates TypeScript types from the OpenAPI specification using `openapi-typescript`.

### Generate Client
```bash
pnpm generate:client
```
Generates API clients using `orval`.

### Validate Specification
```bash
pnpm validate
```
Validates the OpenAPI specification for correctness.

### Generate OpenAPI from Routes
```bash
pnpm generate:openapi
```
Generates the OpenAPI specification from existing API routes (useful for keeping specs in sync).

## File Structure

```
packages/contracts/
├── openapi.yaml              # OpenAPI specification
├── src/
│   ├── openapi-types.ts      # Generated TypeScript types
│   ├── api-client/           # Generated API clients
│   ├── dashboard-client.ts   # Dashboard-specific client wrapper
│   └── hooks/                # Request/response hooks
├── orval.config.ts          # Orval configuration
└── generate-openapi.js      # Script to generate OpenAPI from routes
```

## Usage

### In the API Server

```typescript
import { openapiValidation } from './plugins/openapi.js';

// Register the plugin
await openapiValidation(app);
```

### In the Dashboard

```typescript
import { createApiClient } from '@orbitcheck/contracts';

const apiClient = createApiClient({
  baseURL: '/api', // or full URL
  token: userToken
});

// Usage
const usage = await apiClient.getUsage();
const apiKeys = await apiClient.listApiKeys();
```

### Generated Types

The generated types provide full TypeScript support:

```typescript
import type { GetUsage200, ApiKey } from '@orbitcheck/contracts';

function processUsage(data: GetUsage200) {
  // TypeScript will provide full autocomplete and type checking
  console.log(data.totals.validations);
}
```

## CI/CD Integration

The OpenAPI specification is automatically validated in CI/CD:

1. **Validation**: Checks for syntax errors and compliance with OpenAPI 3.0.3
2. **Type Generation**: Ensures types can be generated without errors
3. **Client Generation**: Verifies that clients can be generated
4. **Breaking Changes**: Detects changes that could break existing clients

## Adding New Endpoints

1. Add the new endpoint to the appropriate route file in `apps/api/src/routes/`
2. Update the OpenAPI specification in `packages/contracts/openapi.yaml`
3. Run `pnpm generate:types` and `pnpm generate:client`
4. Update any consuming services to use the new types

## Best Practices

1. **Always use the generated types** - Never manually define types that should come from the OpenAPI spec
2. **Keep the spec in sync** - Run the generation scripts after making changes to routes
3. **Validate before committing** - Use the `validate` script to ensure correctness
4. **Document thoroughly** - Include descriptions, examples, and proper parameter documentation

## Troubleshooting

### Type Generation Errors
If you encounter errors during type generation:
1. Check the OpenAPI specification for syntax errors
2. Ensure all required fields are properly documented
3. Validate with `pnpm validate`

### Client Generation Issues
If client generation fails:
1. Check that all referenced schemas are defined
2. Ensure parameter names and types match between paths and schemas
3. Verify the orval configuration is correct

### Import Issues
If you can't import the generated types:
1. Check that the path aliases are configured in your `tsconfig.json`
2. Ensure the Vite config (if using) has the correct aliases
3. Verify the package is properly linked