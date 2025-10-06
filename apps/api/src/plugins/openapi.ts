import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

// Load OpenAPI spec
const openapiPath = join(process.cwd(), '..', '..', 'packages', 'contracts', 'openapi.yaml');
const openapiSchema = yaml.load(readFileSync(openapiPath, 'utf8'));

/**
 * OpenAPI validation plugin for Fastify
 * Validates that all endpoints defined in the OpenAPI spec are implemented
 * and optionally validates requests/responses against the schema
 */
export async function openapiValidation(app: FastifyInstance): Promise<void> {
  app.log.info("OpenAPI validation plugin loaded");

  // Validate endpoint coverage on startup
  await validateEndpointCoverage(app);

  // Add request/response validation hooks
  app.addHook('preHandler', async (request, reply) => {
    // Skip validation for health checks and documentation
    if (request.url.startsWith('/health') || request.url.startsWith('/documentation')) {
      return;
    }

    await validateRequest(request);
  });

  app.addHook('preSerialization', async (request, reply, payload) => {
    // Skip validation for health checks and documentation
    if (request.url.startsWith('/health') || request.url.startsWith('/documentation')) {
      return payload;
    }

    await validateResponse(request, payload);
    return payload;
  });

  app.log.info("OpenAPI validation initialized");
}

/**
 * Validates that all endpoints defined in the OpenAPI spec are implemented as routes
 */
async function validateEndpointCoverage(app: FastifyInstance): Promise<void> {
  const spec = openapiSchema as any;
  const paths = spec.paths || {};
  const servers = spec.servers || [];

  // Get the base path from the first server URL
  const baseUrl = servers[0]?.url || '';
  const basePath = baseUrl.replace(/^https?:\/\/[^\/]+/, ''); // Remove protocol and host, keep path

  // Dashboard routes that don't use the basePath
  const dashboardGroups = ['/api-keys', '/webhooks', '/data'];

  const missingEndpoints: string[] = [];

  for (const [path, methods] of Object.entries(paths)) {
    if (typeof methods !== 'object' || methods === null) continue;

    for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
      if (method === 'parameters') continue; // Skip path-level parameters

      const httpMethod = method.toUpperCase();
      const isDashboardRoute = dashboardGroups.some(group => path.startsWith(group));
      const fullPath = isDashboardRoute ? path : basePath + path; // Don't add basePath for dashboard routes
      const routePath = fullPath; // Keep OpenAPI param format {id} as Fastify accepts it

      // Check if route exists
      const routeExists = app.hasRoute({ method: httpMethod, url: routePath });

      if (!routeExists) {
        missingEndpoints.push(`${httpMethod} ${fullPath}`);
      }
    }
  }

  if (missingEndpoints.length > 0) {
    const error = new Error(`Missing implementation for OpenAPI endpoints: ${missingEndpoints.join(', ')}`);
    app.log.error({ missingEndpoints }, 'OpenAPI endpoint coverage validation failed');
    throw error;
  }

  app.log.info(`OpenAPI endpoint coverage validation passed: ${Object.keys(paths).length} paths validated`);
}

/**
 * Validates request against OpenAPI schema
 */
async function validateRequest(request: FastifyRequest): Promise<void> {
  // TODO: Implement request validation using AJV against OpenAPI schema
  // For now, just log the request
  request.log.debug({
    method: request.method,
    url: request.url,
    hasBody: !!request.body
  }, "Request validation passed (not implemented yet)");
}

/**
 * Validates response against OpenAPI schema
 */
async function validateResponse(request: FastifyRequest, payload: any): Promise<void> {
  // TODO: Implement response validation using AJV against OpenAPI schema
  // For now, just log the response
  request.log.debug({
    method: request.method,
    url: request.url,
    statusCode: (request as any).statusCode || 200
  }, "Response validation passed (not implemented yet)");
}