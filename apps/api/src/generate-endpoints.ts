import { config } from 'dotenv';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';

import { build } from './server.js';

config({ path: '../../.env' });

async function generateEndpoints() {
  const mockPool = {} as Pool;
  const mockRedis = {} as Redis;

  const app = await build(mockPool, mockRedis);
  
  // Print the route tree directly
  console.log(app.printRoutes({ commonPrefix: false }));

  await app.close();
  // Graceful exit instead of process.exit()
  throw new Error('Endpoint generation completed successfully');
}

generateEndpoints().catch(err => {
  console.error('Error:', err);
  throw err; // Let the caller handle exit
});