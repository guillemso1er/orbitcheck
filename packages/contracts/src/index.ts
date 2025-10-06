// Export the dashboard client
export { createApiClient } from './dashboard-client';

// Export the generated API client
export * from './api-client/orbiCheckAPI';

// Export the hooks
export { beforeRequest } from './hooks/beforeRequest';
export { afterResponse } from './hooks/afterResponse';

// Export the OpenAPI types
export type * from './openapi-types';

// Export route constants
export { API_ROUTES, DASHBOARD_ROUTES, API_V1_ROUTES } from './routes';

// Export the route constants
export * from './routes';