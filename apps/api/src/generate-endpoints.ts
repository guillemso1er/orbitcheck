import { config } from 'dotenv';
import fs from 'fs';
import type { Redis } from 'ioredis';
import path from 'path';
import type { Pool } from 'pg';

import { build } from './server.js';

config({ path: '../../.env' });

// --- CONFIGURATION ---
// Add the path prefixes for the routes you want to include in the output.
const API_PREFIXES = ['/v1', '/auth']; 
// You can also add specific root-level routes if needed, e.g., '/health'
// const API_PREFIXES = ['/v1', '/auth', '/health'];
// ---------------------

async function generateEndpoints() {
  const mockPool = {} as Pool;
  const mockRedis = {} as Redis;

  const app = await build(mockPool, mockRedis);
  
  // Get raw route output
  const routeTree = app.printRoutes({ commonPrefix: false });
  
  const endpoints: string[] = [];
  const lines = routeTree.split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Check if line contains parentheses with HTTP methods
    if (line.includes('(') && line.includes(')')) {
      const openIdx = line.indexOf('(');
      const closeIdx = line.lastIndexOf(')');
      
      if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
        const methodsPart = line.substring(openIdx + 1, closeIdx);
        const pathPart = line.substring(0, openIdx);
        
        // Clean up the path part - remove tree characters and whitespace
        const cleanPath = pathPart
          .replace(/[├└│─\s]/g, '') // More robust regex
          .trim();
        
        // *** THE KEY FIX: Filter by prefix ***
        const isApiRoute = API_PREFIXES.some(prefix => cleanPath.startsWith(prefix));
        if (!isApiRoute) {
          continue; // Skip routes that don't match our prefixes
        }
        
        // Parse methods
        const methods = methodsPart.split(',').map(m => m.trim());
        
        // Ensure path starts with '/' (it should already, but as a safeguard)
        const finalPath = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
        
        // Add endpoints
        for (const method of methods) {
          if (method && method !== 'OPTIONS' && method !== 'HEAD') {
            const endpoint = `${method} ${finalPath}`;
            endpoints.push(endpoint);
          }
        }
      }
    }
  }
  
  // Sort and deduplicate
  const uniqueEndpoints = [...new Set(endpoints)].sort((a, b) => {
    // Sort by path first, then by method
    const pathA = a.substring(a.indexOf(' ') + 1);
    const pathB = b.substring(b.indexOf(' ') + 1);
    if (pathA < pathB) return -1;
    if (pathA > pathB) return 1;
    return a.localeCompare(b);
  });
  
  const endpointsText = uniqueEndpoints.join('\n');

  // Write to file
  const outputPath = path.join(process.cwd(), 'dist', 'endpoints.txt');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, endpointsText || 'No endpoints found');

  console.log(`\n=== RESULTS ===`);
  console.log(`Generated ${uniqueEndpoints.length} endpoints.`);
  console.log(`Endpoints saved to: ${outputPath}`);
  if (uniqueEndpoints.length > 0) {
    console.log('\nEndpoints:');
    console.log(endpointsText);
  }

  await app.close();
  // Graceful exit instead of process.exit()
  throw new Error('Endpoint generation completed successfully');
}

generateEndpoints().catch(err => {
  console.error('Error:', err);
  throw err; // Let the caller handle exit
});