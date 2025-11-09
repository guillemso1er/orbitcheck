// packages/contracts/src/index.ts (Updated)

export { client } from '../generated/client/client.gen.js';
export { createClient } from '../generated/client/client/client.gen.js';

export * from '../generated/client/sdk.gen';
export * from '../generated/client/types.gen';

// Export the OpenAPI types
export type * from './openapi-types.js';
// Export route constants from dist
export * from '../dist/routes.js';

