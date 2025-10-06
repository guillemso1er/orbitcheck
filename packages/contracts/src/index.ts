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

// Export the OpenAPI schema as parsed object
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const openapiPath = join(__dirname, '..', 'openapi.yaml');
export const openapiSchema = yaml.load(readFileSync(openapiPath, 'utf8'));