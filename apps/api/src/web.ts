import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import IORedis from "ioredis";
import { Pool } from "pg";
import { auth, idempotency, rateLimit } from "./hooks";
import { registerApiKeysRoutes } from './routes/api-keys';
import { registerAuthRoutes, verifyJWT } from "./routes/auth";
import { registerDataRoutes } from './routes/data';
import { registerDedupeRoutes } from './routes/dedupe';
import { registerOrderRoutes } from './routes/orders';
import { registerRulesRoutes } from './routes/rules';
import { registerValidationRoutes } from './routes/validation';
import { registerWebhookRoutes } from './routes/webhook';

/**
 * Determines the appropriate authentication hook based on the request URL.
 * For dashboard routes, uses JWT verification; for API routes, uses API key auth.
 * Public routes are skipped.
 *
 * @param req - Fastify request object
 * @param rep - Fastify reply object
 * @param pool - PostgreSQL connection pool
 * @returns {Promise<void>} Resolves after authentication or sends error response
 */
async function authenticateRequest(req: FastifyRequest, rep: FastifyReply, pool: Pool) {
    const url = req.url;

    // Skip authentication for public endpoints: health checks, API docs, and auth routes
    if (url.startsWith("/health") || url.startsWith("/documentation") || url.startsWith("/auth")) {
        return;
    }

    // Dashboard routes require JWT authentication (user session)
    const isDashboardRoute = url.startsWith("/api-keys") || url.startsWith("/webhooks");

    // Apply JWT verification for dashboard or API key auth for public API
    if (isDashboardRoute) {
        await verifyJWT(req, rep, pool);
    } else {
        await auth(req, rep, pool);
    }
}

/**
 * Applies rate limiting and idempotency checks for non-dashboard API routes only.
 * Skips for dashboard to avoid unnecessary overhead on low-volume admin routes.
 * Calls rateLimit hook (project+IP per minute) and idempotency hook (replay if key exists).
 *
 * @param req - Fastify request object with URL and project_id (from auth).
 * @param rep - Fastify reply object for potential error responses or caching.
 * @param redis - Redis client for rate counters and idempotency storage.
 * @returns {Promise<void>} Resolves after middleware or sends 429/200 replay.
 */
async function applyRateLimitingAndIdempotency(req: FastifyRequest, rep: FastifyReply, redis: IORedis) {
    const url = req.url;
    const isDashboardRoute = url.startsWith("/api-keys") || url.startsWith("/webhooks");

    if (!isDashboardRoute) {
        await rateLimit(req, rep, redis);
        await idempotency(req, rep, redis);
    }
}

/**
 * Registers all API routes on the Fastify instance with global preHandler hooks for auth, rate limiting, and idempotency.
 * Hooks run before every route: authenticate based on path, apply middleware for API routes.
 * Imports and registers modular route handlers for auth, API keys, validation, dedupe, orders, data, webhooks, rules.
 * Ensures consistent middleware application across the API surface.
 *
 * @param app - FastifyInstance to register routes and hooks on.
 * @param pool - Shared PostgreSQL pool for all route database access.
 * @param redis - Shared Redis client for caching, rate limiting, and idempotency in routes.
 */
export function registerRoutes(app: FastifyInstance, pool: Pool, redis: IORedis) {
    // Global preHandler hook chain: authentication + rate limiting/idempotency middleware
    app.addHook("preHandler", async (req, rep) => {
        await authenticateRequest(req, rep, pool);
        await applyRateLimitingAndIdempotency(req, rep, redis);
    });

    // Register modular route groups with shared dependencies
    registerAuthRoutes(app, pool);
    registerApiKeysRoutes(app, pool);
    registerValidationRoutes(app, pool, redis);
    registerDedupeRoutes(app, pool);
    registerOrderRoutes(app, pool, redis);
    registerDataRoutes(app, pool);
    registerWebhookRoutes(app, pool);
    registerRulesRoutes(app, pool);
}