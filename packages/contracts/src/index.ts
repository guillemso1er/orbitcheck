// Export the dashboard client
export { createApiClient } from './dashboard-client.js';

// Export the generated API client
export * from './api-client/orbiCheckAPI.js';

// Export the hooks
export { beforeRequest } from './hooks/beforeRequest.js';
export { afterResponse } from './hooks/afterResponse.js';

// Export the OpenAPI types
export type * from './openapi-types.js';

// Export route constants
export { API_ROUTES, DASHBOARD_ROUTES, API_V1_ROUTES } from './routes.js';

// Export the route constants
export * from './routes.js';