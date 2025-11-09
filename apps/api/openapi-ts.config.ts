// packages/api/openapi-ts.fastify.config.ts
import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../packages/contract/dist/openapi.v1.json',
  output: 'src/generated/fastify',
  plugins: [
    'fastify'
    // Optionally: ['fastify', { prefix: '/api' }]
  ]
});