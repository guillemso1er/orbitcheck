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

// Export route constants from src
export * from '../dist/routes.js';
export { API_V1_ROUTES, DASHBOARD_ROUTES, MGMT_V1_ROUTES } from '../dist/routes.js';


