// packages/api/openapi-ts.fastify.config.ts
import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../packages/contracts/dist/openapi.v1.json',
  output: 'src/generated/fastify',
  plugins: [
    {
      name: 'fastify',
      // Optional: make “glue” and related types available from ./client/index.ts
      exportFromIndex: true,
    },
  ]
});