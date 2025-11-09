// packages/contracts/src/index.ts (Updated)

// Export the dashboard client
export { createApiClient, ApiClient } from './dashboard-client.js';

// Export the generated API client
export * from './api-client/orbitCheckAPI.js';

// Export the hooks
export { afterResponse } from './hooks/afterResponse.js';
export { beforeRequest } from './hooks/beforeRequest.js';

// Export the OpenAPI types
export type * from './openapi-types.js';
// Export route constants from dist
export * from '../dist/routes.js';

