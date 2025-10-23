#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

// --- Merge OpenAPI specs first ---
const splitDir = 'specs';
const files = ['ui-endpoints.yaml', 'management-api.yaml', 'runtime-api.yaml', 'internal.yaml'];

// Define the complete tag objects to ensure all tags are included
const completeTags = [
  { name: 'UI Endpoints', description: 'Endpoints used exclusively by the web application UI, such as user authentication.' },
  { name: 'Management API', description: 'Endpoints for managing your account, data, API keys, and configurations.' },
  { name: 'Runtime API', description: 'Core operational endpoints for data validation, deduplication, and order processing.' },
  { name: 'Internal', description: 'Internal endpoints for system administration and maintenance.' }
];

let mergedSpec = {
  openapi: '3.0.3',
  info: {
    title: 'OrbitCheck API',
    description: 'API for validation, deduplication, and risk assessment services',
    version: '1.0.0',
    contact: {
      name: 'OrbitCheck Team',
      email: 'support@orbitcheck.io'
    }
  },
  servers: [
    {
      url: 'https://api.orbitcheck.io/v1',
      description: 'Production server'
    },
    {
      url: 'https://dev-api.orbitcheck.io/v1',
      description: 'Development server'
    }
  ],
  security: [
    {
      BearerAuth: []
    }
  ],
  tags: completeTags,
  paths: {},
  components: {}
};
let allPaths = {};

files.forEach(file => {
  const filePath = path.join(splitDir, file);
  const spec = yaml.load(fs.readFileSync(filePath, 'utf8'));

  // Merge components
  if (spec.components) {
    Object.assign(mergedSpec.components, spec.components);
  }

  // Merge paths, but exclude non-path keys like 'components' that might be at the same level
  if (spec.paths) {
    Object.keys(spec.paths).forEach(pathKey => {
      if (pathKey.startsWith('/')) {
        allPaths[pathKey] = spec.paths[pathKey];
      }
    });
  }
});

// Filter out invalid paths
const validPaths = {};
Object.entries(allPaths).forEach(([path, methods]) => {
  if (methods && typeof methods === 'object' && Object.keys(methods).length > 0) {
    validPaths[path] = methods;
  }
});
mergedSpec.paths = validPaths;

// Ensure dist directory exists
const distDir = path.join(process.cwd(), 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Write the merged spec to dist/openapi.yaml
fs.writeFileSync(path.join(distDir, 'openapi.yaml'), yaml.dump(mergedSpec, { indent: 2, noRefs: true }));

console.log('Merged openapi.yaml created successfully.');

// --- Now load the merged OpenAPI schema ---
const openapiPath = path.join(process.cwd(), 'dist', 'openapi.yaml');
const openapiDoc = yaml.load(fs.readFileSync(openapiPath, 'utf8'));

// Initialize route objects
const DASHBOARD_ROUTES = {};
const MGMT_V1_ROUTES = {};
const API_V1_ROUTES = {};

// --- Helper function to create a clean constant name from the summary ---
const createConstantName = (summary) => {
  if (!summary) return 'UNKNOWN_ROUTE';
  return summary
    .replace(/[^a-zA-Z0-9\s]/g, '') // Allow letters, numbers, and spaces
    .trim()
    .replace(/\s+/g, '_')
    .toUpperCase();
};

// --- Process each path in the OpenAPI document ---
Object.entries(openapiDoc.paths).forEach(([path, methods]) => {
  if (!methods || typeof methods !== 'object') {
    console.warn(`[!] Skipping path "${path}" as it has no valid methods.`);
    return;
  }
  Object.entries(methods).forEach(([method, methodConfig]) => {
    const { tags, summary } = methodConfig;
    const constantName = createConstantName(summary || `${method}_${path}`);

    if (!tags || tags.length === 0) {
      return; // Skip routes with no tags
    }

    const mainTag = tags[0];
    const formattedPath = path.replace(/\{([^}]+)\}/g, ':$1');

    switch (mainTag) {
      case 'UI Endpoints':
        DASHBOARD_ROUTES[constantName] = formattedPath;
        break;

      case 'Management API':
      case 'Runtime API':
        const segments = formattedPath.replace(/^\//, '').split('/');

        // --- STEP 1: Intelligently determine the GROUP KEY ---
        // If path is `/v1/rules`, the group segment is `rules`.
        // If path is `/rules`, the group segment is also `rules`.
        let groupSegment;
        if (segments.length > 1 && segments[0].toLowerCase() === 'v1') {
          groupSegment = segments[1];
        } else {
          groupSegment = segments[0];
        }

        if (!groupSegment) {
          console.warn(`[!] Skipping API path "${path}" as it lacks a resource segment for grouping.`);
          break;
        }

        const groupKey = groupSegment.toUpperCase().replace(/-/g, '_');

        // --- STEP 2: Explicitly ensure the FINAL PATH has the /v1 prefix ---
        const finalPath = formattedPath.startsWith('/v1') ? formattedPath : `/v1${formattedPath}`;

        const targetObject = mainTag === 'Management API' ? MGMT_V1_ROUTES : API_V1_ROUTES;

        if (!targetObject[groupKey]) {
          targetObject[groupKey] = {};
        }

        // Assign the correctly prefixed path
        targetObject[groupKey][constantName] = finalPath;
        break;
    }
  });
});

// --- Generate the TypeScript output ---
let routesOutput = `/**
 * Auto-generated route constants from OpenAPI schema
 * Generated at: ${new Date().toISOString()}
 * Do not edit this file manually - run this script to update
 */

`;

// --- Generate DASHBOARD_ROUTES ---
if (Object.keys(DASHBOARD_ROUTES).length > 0) {
  // Note: Renamed from DASHBOARD_ROUTES to match your desired output
  routesOutput += '// UI-only (session/cookies; unversioned)\n';
  routesOutput += 'export const DASHBOARD_ROUTES = {\n';
  for (const [key, value] of Object.entries(DASHBOARD_ROUTES)) {
    routesOutput += `  ${key}: '${value}',\n`;
  }
  routesOutput += `  };\n\n`;
}

// --- Generate MGMT_V1_ROUTES ---
if (Object.keys(MGMT_V1_ROUTES).length > 0) {
  routesOutput += '// Management API (versioned)\n';
  routesOutput += 'export const MGMT_V1_ROUTES = {\n';
  const sortedGroups = Object.keys(MGMT_V1_ROUTES).sort();
  for (const group of sortedGroups) {
    routesOutput += `  ${group}: {\n`;
    const routes = MGMT_V1_ROUTES[group];
    const sortedRoutes = Object.entries(routes).sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
    for (const [key, value] of sortedRoutes) {
      routesOutput += `    ${key}: '${value}',\n`;
    }
    routesOutput += `  },\n`;
  }
  routesOutput += ` }; \n\n`;
}

// --- Generate API_V1_ROUTES ---
if (Object.keys(API_V1_ROUTES).length > 0) {
  routesOutput += '// Runtime API\n';
  routesOutput += 'export const API_V1_ROUTES = {\n';
  const sortedGroups = Object.keys(API_V1_ROUTES).sort();
  for (const group of sortedGroups) {
    routesOutput += `  ${group}: {\n`;
    const routes = API_V1_ROUTES[group];
    const sortedRoutes = Object.entries(routes).sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
    for (const [key, value] of sortedRoutes) {
      routesOutput += `    ${key}: '${value}',\n`;
    }
    routesOutput += `  },\n`;
  }
  routesOutput += ` }; \n\n`;
}


const routesPath = path.join(process.cwd(), 'dist', 'routes.js');
fs.writeFileSync(routesPath, routesOutput.trim() + '\n');

console.log('✅ Route constants generated successfully!');
console.log(`📁 Updated: ${routesPath}`);

// Generate TypeScript declaration file for routes.js
let dtsOutput = `/**
 * Auto-generated type declarations for route constants
 * Generated at: ${new Date().toISOString()}
 * Do not edit this file manually - run this script to update
 */

// UI-only (session/cookies; unversioned)
export declare const DASHBOARD_ROUTES: Record<string, string>;

// Management API (versioned)
export declare const MGMT_V1_ROUTES: Record<string, Record<string, string>>;

// Runtime API
export declare const API_V1_ROUTES: Record<string, Record<string, string>>;
`;

const dtsPath = path.join(process.cwd(), 'dist', 'routes.d.ts');
fs.writeFileSync(dtsPath, dtsOutput.trim() + '\n');

console.log('✅ Type declarations generated successfully!');
console.log(`📁 Updated: ${dtsPath}`);

// --- Execute generate:types equivalent ---
console.log('Generating types...');
execSync('npx openapi-typescript dist/openapi.yaml -o src/openapi-types.ts', { stdio: 'inherit' });

// --- Execute generate:client equivalent ---
console.log('Generating client...');
execSync('npx orval', { stdio: 'inherit' });

// --- Compile TypeScript ---
console.log('Compiling TypeScript...');
execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' });

console.log('All generations completed successfully!');