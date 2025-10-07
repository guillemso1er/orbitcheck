// packages/contracts/src/index.ts (Updated)

// Export the dashboard client
export { createApiClient } from './dashboard-client.js';

// Export the generated API client
export * from './api-client/orbiCheckAPI.js';

// Export the hooks
export { afterResponse } from './hooks/afterResponse.js';
export { beforeRequest } from './hooks/beforeRequest.js';

// Export the OpenAPI types
export type * from './openapi-types.js';

// Export route constants
export { API_ROUTES, API_V1_ROUTES, DASHBOARD_ROUTES } from './routes.js';

// Export the route constants
export * from './routes.js';

